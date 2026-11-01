"""Validação obrigatória do dataset: congela legados e rejeita arquivos não catalogados."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = {"go", "python", "cpp", "rust", "javascript", "typescript", "angular", "java"}
CATEGORIES = {"algorithms", "data-structures", "concurrency", "io", "errors", "security", "testing", "web", "ui", "databases", "tooling"}
SLUG = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
CODE_EXTENSIONS = {".go", ".py", ".cpp", ".cc", ".c", ".h", ".hpp", ".rs", ".js", ".mjs", ".ts", ".tsx", ".java"}
OUTPUT = ROOT / "catalog.json"
BASELINE = ROOT / "docs" / "LEGACY_REVIEW.json"
BASE_FIELDS = {"id", "title", "description", "entrypoint", "run", "test", "tags"}
SPEC_FIELDS = {
    "purpose", "when_to_use", "when_not_to_use", "requirements", "inputs",
    "outputs", "error_handling", "limitations", "troubleshooting", "runtime",
    "usage_language", "usage_example", "validation", "files", "provenance",
}
SECTIONS = (
    "## Objetivo e comportamento", "## Quando usar", "## Quando não usar",
    "## Pré-requisitos", "## Entradas", "## Saídas", "## Exemplo de utilização",
    "## Executar ou integrar", "## Testar", "## Tratamento de erros",
    "## Limitações e riscos", "## Diagnóstico e correção",
    "## Verificação automatizada", "## Arquivos catalogados",
    "## Origem e manutenção",
)


def git_blob_sha(path: Path) -> str:
    """Confere bytes do legado sem depender de um executável git instalado."""
    raw = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def validate_current(meta: dict, directory: Path, readme: str) -> None:
    """Valida documentação, inventário e comentário identificador do código."""
    if set(meta) != BASE_FIELDS | {"schema_version", "spec"} or meta["schema_version"] != 2:
        raise ValueError("metadados v2 incompletos ou campo adicional inesperado")
    spec = meta["spec"]
    if not isinstance(spec, dict) or set(spec) != SPEC_FIELDS:
        raise ValueError("campos obrigatórios da spec não correspondem ao contrato v2")
    for field in ("purpose", "when_to_use", "when_not_to_use", "runtime", "usage_example"):
        if not isinstance(spec[field], str) or len(spec[field].strip()) < 35:
            raise ValueError(f"spec.{field} insuficiente")
    if not isinstance(spec["usage_language"], str) or not spec["usage_language"].strip():
        raise ValueError("linguagem do trecho de uso inválida")
    for field in ("requirements", "inputs", "outputs", "error_handling", "limitations"):
        values = spec[field]
        if not isinstance(values, list) or not values or any(
            not isinstance(item, str) or len(item.strip()) < 12 for item in values
        ):
            raise ValueError(f"spec.{field} precisa conter descrições específicas")
    if spec["provenance"] != "original":
        raise ValueError("origem de terceiros precisa de política de licença antes da entrada")
    items = spec["troubleshooting"]
    if not isinstance(items, list) or not items:
        raise ValueError("falta diagnóstico e correção de erro")
    for item in items:
        if not isinstance(item, dict) or set(item) != {"symptom", "cause", "fix"}:
            raise ValueError("diagnóstico precisa de symptom, cause e fix")
        if any(not isinstance(item[k], str) or len(item[k].strip()) < 30 for k in item):
            raise ValueError("diagnóstico precisa ter conteúdo útil")
    validation = spec["validation"]
    if not isinstance(validation, dict) or set(validation) != {"level", "scope", "gaps"}:
        raise ValueError("validação sem escopo, nível ou lacunas")
    if validation["level"] not in {"automated-tests", "compile-only"}:
        raise ValueError("nível de teste inválido")
    for field in ("scope", "gaps"):
        if not isinstance(validation[field], str) or len(validation[field].strip()) < 35:
            raise ValueError(f"validação.{field} insuficiente")
    files = spec["files"]
    if not isinstance(files, list) or not files:
        raise ValueError("inventário vazio")
    declared = set()
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "role"}:
            raise ValueError("cada arquivo exige path e role")
        path = item["path"]
        if not isinstance(path, str) or not path or Path(path).is_absolute() or ".." in Path(path).parts:
            raise ValueError("caminho no inventário inválido")
        if item["role"] not in {"source", "test", "config"} or path in declared:
            raise ValueError("papel inválido ou arquivo repetido")
        declared.add(path)
    actual = set()
    for item in directory.rglob("*"):
        if item.is_symlink():
            raise ValueError("links simbólicos proibidos no exemplo")
        if item.is_file() and item.name not in {"README.md", "example.json"}:
            actual.add(item.relative_to(directory).as_posix())
    if actual != declared or meta["entrypoint"] not in declared:
        raise ValueError("arquivo não catalogado, inventário incompleto ou entrypoint ausente")
    if len(readme.strip()) < 1100 or any(s not in readme for s in SECTIONS):
        raise ValueError("README sem especificação e seções obrigatórias")
    entry = directory / meta["entrypoint"]
    if f"Data Library ID: {meta['id']}" not in entry.read_text(encoding="utf-8")[:800]:
        raise ValueError("código-fonte sem explicação e ID no cabeçalho")


def validate_legacy(meta: dict, directory: Path, frozen: dict[str, str]) -> None:
    """Não permite que um exemplo antigo mude sem migrar para spec v2."""
    if set(meta) != BASE_FIELDS:
        raise ValueError("legado alterado: migrar para contrato v2")
    actual = {}
    for item in directory.rglob("*"):
        if item.is_symlink():
            raise ValueError("symlink proibido no legado")
        if item.is_file():
            actual[item.relative_to(directory).as_posix()] = git_blob_sha(item)
    if actual != frozen:
        raise ValueError("legado modificado ou arquivo novo: migrar para spec v2 antes do commit")


def build() -> dict:
    """Reconstrói o índice com status real, detectando código solto."""
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    frozen = {item["id"]: item["frozen_files"] for item in baseline["examples"]}
    if len(frozen) != len(baseline["examples"]):
        raise ValueError("IDs repetidos no congelamento do legado")
    indexed_dirs = set()
    found_legacy = set()
    entries = []
    seen = set()
    for language in sorted(LANGUAGES):
        folder = ROOT / language
        if not folder.is_dir():
            raise ValueError(f"pasta da linguagem ausente: {language}")
        for metadata_path in sorted(folder.rglob("example.json")):
            directory = metadata_path.parent
            parts = directory.relative_to(ROOT).parts
            if len(parts) != 3 or parts[0] != language:
                raise ValueError(f"pasta inválida: {metadata_path}")
            _, category, slug = parts
            if category not in CATEGORIES or not SLUG.fullmatch(slug):
                raise ValueError(f"categoria ou slug inválido: {metadata_path}")
            meta = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not isinstance(meta, dict):
                raise TypeError("metadados não são objeto")
            ident = f"{language}.{category}.{slug}"
            if ident in seen or meta.get("id") != ident:
                raise ValueError(f"ID duplicado/incorreto: {ident}")
            seen.add(ident)
            for field in ("title", "description", "run", "test", "entrypoint"):
                if not isinstance(meta.get(field), str) or not meta[field].strip():
                    raise ValueError(f"{ident}: {field} vazio")
            if not isinstance(meta.get("tags"), list) or not meta["tags"] or any(
                not isinstance(tag, str) or not SLUG.fullmatch(tag) for tag in meta["tags"]
            ):
                raise ValueError(f"{ident}: tags inválidas")
            readme_file = directory / "README.md"
            if not readme_file.is_file():
                raise ValueError(f"{ident}: README ausente")
            if ident in frozen:
                validate_legacy(meta, directory, frozen[ident])
                status = "legacy_pending_review"
                found_legacy.add(ident)
            else:
                validate_current(meta, directory, readme_file.read_text(encoding="utf-8"))
                status = "documented"
            entry = {
                "id": ident, "language": language, "category": category,
                "title": meta["title"], "description": meta["description"],
                "path": directory.relative_to(ROOT).as_posix(),
                "entrypoint": meta["entrypoint"], "run": meta["run"],
                "test": meta["test"], "tags": meta["tags"], "catalog_status": status,
            }
            if status == "documented":
                entry["spec"] = meta["spec"]
            entries.append(entry)
            indexed_dirs.add(directory)
        for item in folder.rglob("*"):
            if (item.is_file() and item.suffix in CODE_EXTENSIONS
                    and not any(item.is_relative_to(d) for d in indexed_dirs)):
                raise ValueError(f"código sem registro: {item.relative_to(ROOT)}")
    if found_legacy != set(frozen):
        raise ValueError("congelamento inconsistente: ID legado ausente ou promovido incorretamente")
    entries.sort(key=lambda e: e["id"])
    documented = sum(e["catalog_status"] == "documented" for e in entries)
    return {
        "schema_version": 2, "count": len(entries),
        "documented_count": documented, "pending_review_count": len(entries) - documented,
        "examples": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        index = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
        if args.write:
            OUTPUT.write_text(index, encoding="utf-8")
            print(f"Catálogo atualizado: {index.count(chr(10))} linhas")
        elif not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != index:
            print("Catálogo divergente: execute python scripts/catalog.py --write", file=sys.stderr)
            return 1
        else:
            print("Catálogo íntegro.")
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        print(f"Validação falhou: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
