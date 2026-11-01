"""Executa parsers nativos por linguagem e publica diagnósticos no GitHub Actions.

Nenhum exemplo é executado por este orquestrador; testes funcionais são outra etapa.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import shlex
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ("python", "go", "cpp", "rust", "javascript", "typescript", "angular", "java")


@dataclass(frozen=True)
class ParserCheck:
    label: str
    tool: str
    cwd: Path
    command: tuple[str, ...] = ()
    file: Path | None = None


def files_in(folder: Path, pattern: str) -> list[Path]:
    """Seleciona arquivos sem seguir symlinks e com ordenação determinística."""
    return sorted(path for path in folder.rglob(pattern) if path.is_file() and not path.is_symlink())


def checks_for(language: str, root: Path = ROOT) -> list[ParserCheck]:
    """Mapeia cada linguagem para sua ferramenta nativa de parse/compilação."""
    if language == "python":
        files = [
            file for folder in ("python", "scripts", "tests")
            for file in files_in(root / folder, "*.py")
        ]
        return [
            ParserCheck(file.relative_to(root).as_posix(), "ast.parse", root, file=file)
            for file in sorted(files)
        ]
    if language == "go":
        return [
            ParserCheck(file.relative_to(root).as_posix(), "gofmt parser", root,
                        ("gofmt", "-e", file.relative_to(root).as_posix()), file)
            for file in files_in(root / "go", "*.go")
        ]
    if language == "cpp":
        files = [
            file for suffix in ("*.cpp", "*.cc", "*.c")
            for file in files_in(root / "cpp", suffix)
        ]
        return [
            ParserCheck(file.relative_to(root).as_posix(), "G++ C++20 syntax", root,
                        ("g++", "-std=c++20", "-fsyntax-only", "-Wall", "-Wextra",
                         "-Wpedantic", "-Werror", file.relative_to(root).as_posix()), file)
            for file in sorted(files)
        ]
    if language == "rust":
        return [
            ParserCheck("workspace Rust", "cargo check", root / "rust",
                        ("cargo", "check", "--offline", "--workspace", "--all-targets"))
        ]
    if language == "javascript":
        return [
            ParserCheck(file.relative_to(root).as_posix(), "Node --check", root,
                        ("node", "--check", file.relative_to(root).as_posix()), file)
            for file in files_in(root / "javascript", "*.mjs")
        ]
    if language == "typescript":
        return [
            ParserCheck("tsconfig.json", "TypeScript compiler", root,
                        ("tsc", "--noEmit", "--pretty", "false", "-p", "typescript/tsconfig.json")),
            ParserCheck("tsconfig.strict.json", "TypeScript compiler", root,
                        ("tsc", "--noEmit", "--pretty", "false", "-p",
                         "typescript/security/runtime-assertions/tsconfig.strict.json")),
        ]
    if language == "angular":
        return [
            ParserCheck("Angular strictTemplates", "Angular compiler", root / "angular",
                        ("./node_modules/.bin/ngc", "-p", "tsconfig.json"))
        ]
    if language == "java":
        return [
            ParserCheck(file.relative_to(root).as_posix(), "javac Java 21", root,
                        ("javac", "-encoding", "UTF-8", "-Xlint:all", "-Werror",
                         file.relative_to(root).as_posix()), file)
            for file in files_in(root / "java", "*.java")
        ]
    raise ValueError(f"Linguagem não suportada: {language}")


def parse_python(path: Path) -> tuple[bool, str, int | None]:
    """Analisa uma AST Python sem importar ou executar o arquivo."""
    try:
        ast.parse(path.read_text(encoding="utf-8"), filename=path.as_posix())
    except SyntaxError as exc:
        return False, f"{exc.msg} (linha {exc.lineno}, coluna {exc.offset})", exc.lineno
    except (OSError, UnicodeError, ValueError) as exc:
        return False, str(exc), None
    return True, "", None


def run_check(check: ParserCheck) -> tuple[bool, str, int | None]:
    if check.tool == "ast.parse":
        assert check.file is not None
        return parse_python(check.file)
    try:
        if check.tool == "javac Java 21":
            # Isolamento: exemplos Main.java têm nome de classe repetido.
            with tempfile.TemporaryDirectory(prefix="dl-javac-") as folder:
                command = (*check.command[:-1], "-d", folder, check.command[-1])
                result = subprocess.run(
                    command, cwd=check.cwd, capture_output=True, text=True,
                    encoding="utf-8", errors="replace", timeout=240, check=False,
                )
        else:
            result = subprocess.run(
                check.command, cwd=check.cwd, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=240, check=False,
            )
    except subprocess.TimeoutExpired:
        return False, "O parser excedeu 240 segundos de execução.", None
    except OSError as exc:
        return False, f"Não foi possível iniciar {check.tool}: {exc}", None
    if result.returncode:
        return False, (result.stderr or result.stdout or
                       f"Processo retornou código {result.returncode}").strip()[:16000], None
    return True, "", None


def annotation_escape(value: str) -> str:
    """Escapa caracteres especiais dos comandos de anotação do GitHub Actions."""
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def write_summary(language: str, passed: int, total: int) -> None:
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    status = "APROVADO" if passed == total else "REPROVADO"
    with Path(summary).open("a", encoding="utf-8") as stream:
        stream.write(f"\n### Parser: {language} — {status}\n\n")
        stream.write(f"- Arquivos/configurações analisados: {total}\n")
        stream.write(f"- Aprovações: {passed}; falhas: {total - passed}\n")
        stream.write("- Parse não substitui testes funcionais ou revisão de segurança.\n")


def main(argv: list[str] | None = None) -> int:
    cli = argparse.ArgumentParser(description="Parsers nativos por linguagem para CI.")
    cli.add_argument("--language", choices=LANGUAGES, required=True)
    cli.add_argument("--json-report", type=Path, help="Saída JSON opcional para ferramentas.")
    args = cli.parse_args(argv)

    checks = checks_for(args.language)
    results: list[dict[str, object]] = []
    if not checks:
        print(f"::error title=Parser sem arquivos::{args.language} sem arquivos/configurações", flush=True)
    for check in checks:
        print(f"::group::Parser {args.language}: {check.label}", flush=True)
        print(f"$ {shlex.join(check.command)}" if check.command
              else f"$ ast.parse {check.label}", flush=True)
        ok, detail, line = run_check(check)
        if ok:
            print(f"PASS | {check.tool} | {check.label}", flush=True)
        else:
            print(f"FAIL | {check.tool} | {check.label}\n{detail}", flush=True)
            target = f"file={check.file.relative_to(ROOT).as_posix()}," if (
                check.file is not None and check.file.is_relative_to(ROOT)
            ) else ""
            if line is not None:
                target += f"line={line},"
            title = annotation_escape(f"Parser {args.language}")
            message = annotation_escape(f"{check.label}: {detail[:1200]}")
            print(f"::error {target}title={title}::{message}", flush=True)
        print("::endgroup::", flush=True)
        results.append({
            "language": args.language, "file": check.label, "parser": check.tool,
            "status": "pass" if ok else "fail", "diagnostic": detail,
        })
    passed = sum(row["status"] == "pass" for row in results)
    write_summary(args.language, passed, len(checks))
    if args.json_report is not None:
        args.json_report.parent.mkdir(parents=True, exist_ok=True)
        args.json_report.write_text(
            json.dumps({"language": args.language, "checks": results,
                        "passed": passed, "total": len(checks)},
                       ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(f"PARSER RESULT | {args.language} | {passed}/{len(checks)} aprovados", flush=True)
    return 0 if checks and passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
