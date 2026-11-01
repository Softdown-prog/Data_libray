"""Valida a taxonomia e produz um índice determinístico, sem dependências externas."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = {"go", "python", "cpp", "rust", "javascript", "typescript", "angular", "java"}
CATEGORIES = {
    "algorithms", "data-structures", "concurrency", "io", "errors",
    "security", "testing", "web", "ui", "databases", "tooling",
}
SLUG = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
OUTPUT = ROOT / "catalog.json"


def build() -> dict[str, object]:
    examples: list[dict[str, object]] = []
    seen: set[str] = set()
    errors: list[str] = []
    for language in sorted(LANGUAGES):
        folder = ROOT / language
        if not folder.is_dir():
            errors.append(f"linguagem sem pasta: {language}")
            continue
        for metadata_path in sorted(folder.rglob("example.json")):
            parts = metadata_path.parent.relative_to(ROOT).parts
            if len(parts) != 3 or parts[0] != language:
                errors.append(f"{metadata_path}: estrutura deve ter 3 níveis")
                continue
            _, category, slug = parts
            if category not in CATEGORIES or not SLUG.fullmatch(slug):
                errors.append(f"{metadata_path}: categoria ou slug inválido")
                continue
            if metadata_path.is_symlink() or any(p.is_symlink() for p in metadata_path.parents if p != ROOT):
                errors.append(f"{metadata_path}: links simbólicos não permitidos")
                continue
            try:
                meta = json.loads(metadata_path.read_text(encoding="utf-8"))
                if not isinstance(meta, dict):
                    raise TypeError("metadata deve ser objeto JSON")
                required = {"id", "title", "description", "entrypoint", "run", "test", "tags"}
                if set(meta) != required:
                    raise ValueError(f"campos devem ser exatamente {sorted(required)}")
                expected_id = f"{language}.{category}.{slug}"
                if meta["id"] != expected_id or expected_id in seen:
                    raise ValueError(f"ID inválido ou repetido: {meta['id']}")
                for key in ("title", "description", "run", "test"):
                    if not isinstance(meta[key], str) or not meta[key].strip():
                        raise ValueError(f"{key} deve ser texto não vazio")
                tags = meta["tags"]
                if (not isinstance(tags, list) or not 1 <= len(tags) <= 8
                        or any(not isinstance(tag, str) or not SLUG.fullmatch(tag) for tag in tags)
                        or len(tags) != len(set(tags))):
                    raise ValueError("tags devem ser slugs únicos (1 a 8)")
                entry = meta["entrypoint"]
                if not isinstance(entry, str) or not entry or Path(entry).is_absolute() or ".." in Path(entry).parts:
                    raise ValueError("entrypoint inseguro")
                resolved = (metadata_path.parent / entry).resolve()
                if not resolved.is_file() or not resolved.is_relative_to(metadata_path.parent.resolve()):
                    raise ValueError("entrypoint ausente ou fora do exemplo")
                readme = metadata_path.parent / "README.md"
                if not readme.is_file() or len(readme.read_text(encoding="utf-8").strip()) < 80:
                    raise ValueError("README.md ausente ou insuficiente")
                if metadata_path.stat().st_size > 16_384 or resolved.stat().st_size > 131_072:
                    raise ValueError("arquivo excede limite da biblioteca")
                seen.add(expected_id)
                examples.append({
                    "id": expected_id,
                    "language": language,
                    "category": category,
                    "title": meta["title"],
                    "description": meta["description"],
                    "path": metadata_path.parent.relative_to(ROOT).as_posix(),
                    "entrypoint": entry,
                    "run": meta["run"],
                    "test": meta["test"],
                    "tags": tags,
                })
            except (OSError, UnicodeError, ValueError, KeyError, TypeError) as exc:
                errors.append(f"{metadata_path}: {exc}")
    if errors:
        raise ValueError("\n".join(errors))
    examples.sort(key=lambda e: str(e["id"]))
    return {"schema_version": 1, "count": len(examples), "examples": examples}


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        content = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
        if args.write:
            OUTPUT.write_text(content, encoding="utf-8")
            print(f"Catálogo gerado: {OUTPUT}")
        elif not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != content:
            print("Catálogo desatualizado. Rode: python scripts/catalog.py --write", file=sys.stderr)
            return 1
        else:
            print("Catálogo consistente.")
    except ValueError as exc:
        print(f"Catálogo inválido:\n{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
