"""Worker sequencial de validação: catálogo -> JSON de tarefas -> resultados JSONL.

Sem comandos arbitrários no JSON e sem edições automáticas de código ou do catálogo.
Apenas entradas identificadas no catalog.json são aceitas, com rotinas fixas.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

if __package__:
    from .parser_audit import LANGUAGES, annotation_escape, checks_for, run_check
else:
    from parser_audit import LANGUAGES, annotation_escape, checks_for, run_check

ROOT = Path(__file__).resolve().parents[1]
MAX_TASKS = 1000


def select_tasks(
    catalog: dict[str, Any], *, status: str, language: str, max_items: int,
) -> list[dict[str, str]]:
    """Constrói a fila apenas com IDs catalogados e caminhos locais seguros."""
    if not 1 <= max_items <= MAX_TASKS:
        raise ValueError("max_items deve estar entre 1 e 1000")
    if status not in {"all", "documented", "legacy_pending_review"}:
        raise ValueError("status não permitido")
    if language != "all" and language not in LANGUAGES:
        raise ValueError("linguagem não permitida")
    tasks: list[dict[str, str]] = []
    for entry in sorted(catalog["examples"], key=lambda x: x["id"]):
        if status != "all" and entry["catalog_status"] != status:
            continue
        if language != "all" and entry["language"] != language:
            continue
        path = entry["path"]
        ident = entry["id"]
        parts = path.split("/")
        if (
            len(parts) != 3 or entry["language"] not in LANGUAGES or
            parts[0] != entry["language"] or
            ident != ".".join(parts) or
            not all(p and p not in {".", ".."} for p in parts) or
            not (ROOT / path).resolve().is_relative_to(ROOT)
        ):
            raise ValueError(f"registro inválido ou fora do repositório: {ident}")
        tasks.append({
            "example_id": ident, "language": entry["language"],
            "path": path, "catalog_status": entry["catalog_status"],
        })
    return tasks[:max_items]


def execute(command: list[str], cwd: Path, timeout: int = 120) -> tuple[bool, str]:
    """Sem shell=True; cada processo possui limite individual de tempo."""
    try:
        result = subprocess.run(
            command, cwd=cwd, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)[:3000]
    output = (result.stderr or result.stdout).strip()[:4000]
    return result.returncode == 0, output


def run_behavior(entry: dict[str, str]) -> tuple[str, str]:
    """Comandos conhecidos por linguagem, NUNCA vindos de campos run/test do JSON."""
    folder = ROOT / entry["path"]
    lang = entry["language"]
    if lang == "python":
        test = folder / "test_solution.py"
        if not test.is_file():
            return "compile-only", "Exemplo não fornece test_solution.py"
        passed, detail = execute([sys.executable, test.name], folder)
    elif lang == "javascript":
        test = folder / "index.test.mjs"
        if not test.is_file():
            return "compile-only", "Exemplo não fornece index.test.mjs"
        passed, detail = execute(["node", "--test", test.name], folder)
    elif lang == "go":
        package = "./" + "/".join(folder.relative_to(ROOT / "go").parts)
        passed, detail = execute(["go", "test", "-race", "-count=1", package], ROOT / "go")
    elif lang == "rust":
        manifest = folder / "Cargo.toml"
        if not manifest.is_file():
            return "fail", "Cargo.toml não encontrado"
        passed, detail = execute(
            ["cargo", "test", "--offline", "--manifest-path", str(manifest)],
            ROOT, timeout=180,
        )
    elif lang == "typescript":
        test = folder / "index.test.ts"
        if not test.is_file():
            return "compile-only", "Exemplo sem teste TypeScript executável"
        passed, detail = execute(["tsc", "-p", "typescript/tsconfig.json"], ROOT)
        if passed:
            compiled = ROOT / "typescript" / "dist" / folder.relative_to(ROOT / "typescript") / "index.test.js"
            if not compiled.is_file():
                return "fail", f"Teste compilado ausente: {compiled.relative_to(ROOT)}"
            passed, detail = execute(["node", "--test", str(compiled)], ROOT)
    elif lang == "angular":
        return "compile-only", "Compilação Angular verificada no parser; testes DOM/HTTP não disponíveis"
    elif lang == "cpp":
        source = folder / "main.cpp"
        if not source.is_file():
            return "fail", "main.cpp não encontrado"
        with tempfile.TemporaryDirectory(prefix="dl-worker-cpp-") as output:
            binary = str(Path(output) / "example")
            passed, detail = execute(
                ["g++", "-std=c++20", "-O1", "-g", "-Wall", "-Wextra",
                 "-Wpedantic", "-Werror", "-fsanitize=undefined",
                 "-fno-sanitize-recover=all", str(source), "-o", binary],
                ROOT, timeout=180,
            )
            if passed:
                passed, detail = execute([binary], folder)
    elif lang == "java":
        source = folder / "Main.java"
        if not source.is_file():
            return "fail", "Main.java não encontrado"
        with tempfile.TemporaryDirectory(prefix="dl-worker-java-") as output:
            passed, detail = execute(
                ["javac", "-Xlint:all", "-Werror", "-d", output, str(source)],
                ROOT,
            )
            if passed:
                passed, detail = execute(["java", "-ea", "-cp", output, "Main"], ROOT)
    else:
        raise ValueError(f"linguagem sem executor: {lang}")
    return ("pass" if passed else "fail"), detail


def validate_task(task: dict[str, str], mode: str) -> dict[str, Any]:
    """Um item, uma resposta JSON. Erros não encerram o lote."""
    folder = ROOT / task["path"]
    begin = time.monotonic()
    phases: list[dict[str, str]] = []
    selected = checks_for(task["language"])
    if task["language"] in {"python", "javascript", "go", "cpp", "java"}:
        selected = [c for c in selected if c.file is not None and c.file.is_relative_to(folder)]
    if not selected:
        phases.append({"phase": "parser", "status": "fail", "detail": "Nenhum parser encontrado"})
    else:
        for check in selected:
            ok, detail, _ = run_check(check)
            phases.append({
                "phase": "parser", "tool": check.tool, "file": check.label,
                "status": "pass" if ok else "fail", "detail": detail[:4000],
            })
            if not ok:
                break
    if mode == "both" and all(p["status"] != "fail" for p in phases):
        state, detail = run_behavior(task)
        phases.append({"phase": "test", "status": state, "detail": detail[:4000]})
    states = [p["status"] for p in phases]
    status = "fail" if "fail" in states else ("compile-only" if "compile-only" in states else "pass")
    return {
        "example_id": task["example_id"], "language": task["language"],
        "catalog_status": task["catalog_status"], "status": status,
        "phases": phases, "elapsed_seconds": round(time.monotonic() - begin, 3),
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    """Escrita atômica, para evitar JSON parcialmente escrito em reinícios."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=".worker-", delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(payload, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def run_batch(
    catalog: dict[str, Any], *, status: str, language: str, max_items: int,
    mode: str, output: Path, resume: bool = False, dry_run: bool = False,
) -> dict[str, Any]:
    if mode not in {"parse", "both"}:
        raise ValueError("modo inválido")
    tasks = select_tasks(catalog, status=status, language=language, max_items=max_items)
    queue = {
        "schema_version": 1, "source_sha": os.environ.get("GITHUB_SHA", "local"),
        "mode": mode, "status_filter": status, "language_filter": language, "tasks": tasks,
    }
    output.mkdir(parents=True, exist_ok=True)
    queue_path, lines_path = output / "queue.json", output / "results.jsonl"
    if resume:
        if not queue_path.is_file():
            raise ValueError("resume sem fila anterior")
        if json.loads(queue_path.read_text(encoding="utf-8")) != queue:
            raise ValueError("fila, filtros ou commit mudaram: não retomar com estado antigo")
    else:
        if lines_path.exists():
            raise ValueError("resultado anterior presente: use --resume ou outro --output")
        write_json(queue_path, queue)
    if dry_run:
        return {"queue": queue, "dry_run": True}
    completed: dict[str, dict[str, Any]] = {}
    if lines_path.exists():
        for line in lines_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                result = json.loads(line)
                completed[result["example_id"]] = result
        if not set(completed).issubset({t["example_id"] for t in tasks}):
            raise ValueError("resultados existentes não pertencem à fila")
    print(f"Worker iniciou {len(tasks)} itens; retomando {len(completed)}", flush=True)
    with lines_path.open("a", encoding="utf-8") as stream:
        for i, task in enumerate(tasks, 1):
            ident = task["example_id"]
            if ident in completed:
                print(f"SKIP [{i}/{len(tasks)}] {ident}: já processado", flush=True)
                continue
            print(f"::group::Worker [{i}/{len(tasks)}] {ident}", flush=True)
            try:
                result = validate_task(task, mode)
            except Exception as exc:  # noqa: BLE001 - isola qualquer falha por tarefa
                result = {
                    "example_id": ident, "language": task["language"],
                    "catalog_status": task["catalog_status"], "status": "fail",
                    "phases": [{"phase": "worker", "status": "fail", "detail": str(exc)[:4000]}],
                    "elapsed_seconds": 0,
                }
            stream.write(json.dumps(result, ensure_ascii=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())  # persistir item concluído antes do próximo
            completed[ident] = result
            print(f"RESULT {ident}: {result['status']}", flush=True)
            for phase in result["phases"]:
                print(f"  {phase['phase']}: {phase['status']} - {phase.get('detail', '')[:350]}", flush=True)
            if result["status"] == "fail":
                message = annotation_escape(f"{ident}: falhou, veja results.jsonl e logs")
                print(f"::error title=Worker de validação::{message}", flush=True)
            print("::endgroup::", flush=True)
    stats = {kind: sum(r["status"] == kind for r in completed.values())
             for kind in ("pass", "compile-only", "fail")}
    report = {
        "schema_version": 1, "source_sha": queue["source_sha"],
        "mode": mode, "total_queued": len(tasks),
        "completed": len(completed), "counts": stats,
        "next_index": len(completed), "queue_exhausted": len(completed) == len(tasks),
    }
    write_json(output / "summary.json", report)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write("\n### Worker Data Library\n\n")
            summary.write(f"Processados {len(completed)}/{len(tasks)}; OK {stats['pass']}; "
                          f"compile-only {stats['compile-only']}; falhas {stats['fail']}.\n")
            summary.write("O worker não promove exemplos a documented e não edita código.\n")
    print("WORKER SUMMARY " + json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fila sequencial com resultados JSONL.")
    parser.add_argument("--status", default="legacy_pending_review",
                        choices=("all", "documented", "legacy_pending_review"))
    parser.add_argument("--language", default="all", choices=("all", *LANGUAGES))
    parser.add_argument("--max-items", type=int, default=25)
    parser.add_argument("--mode", default="both", choices=("parse", "both"))
    parser.add_argument("--output", type=Path, default=Path(".worker-results"))
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
        report = run_batch(catalog, status=args.status, language=args.language,
                           max_items=args.max_items, mode=args.mode, output=args.output,
                           resume=args.resume, dry_run=args.dry_run)
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"::error title=Fila inválida::{annotation_escape(str(exc))}", flush=True)
        return 2
    return 1 if report.get("counts", {}).get("fail", 0) else 0


if __name__ == "__main__":
    sys.exit(main())
