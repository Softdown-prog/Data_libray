"""Valida a qualidade estrutural do catálogo de incidentes Angular.
 
Não executa código recuperado, não faz rede nem atribui automaticamente provas a relatos.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / "docs" / "angular-incidents.v1.json"
STAGES = {"pre", "post", "runtime", "deploy"}
EVIDENCE = {"pr_documented", "code_and_pr", "code_and_docs", "pr_and_commit", "conversation_report"}
REPRO = {"historical_pr", "existing_static_test", "existing_regression_test", "existing_browser_suite", "needs_replay"}
FIELDS = {"id", "project", "stage", "evidence_level", "title", "problem", "sources", "candidate_check", "reproduction"}


def validate(data: object) -> int:
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ValueError("schema_version deve ser 1")
    incidents = data.get("incidents")
    if not isinstance(incidents, list) or not incidents:
        raise ValueError("incidents precisa ser uma lista não vazia")
    seen: set[str] = set()
    for i, case in enumerate(incidents, 1):
        if not isinstance(case, dict) or set(case) != FIELDS:
            raise ValueError(f"Incidente {i}: campos inválidos ou ausentes")
        ident = case["id"]
        if not isinstance(ident, str) or not re.fullmatch(r"SAC-[0-9]{3}", ident) or ident in seen:
            raise ValueError(f"Incidente {i}: identificador inválido/duplicado")
        seen.add(ident)
        if case["stage"] not in STAGES or case["evidence_level"] not in EVIDENCE or case["reproduction"] not in REPRO:
            raise ValueError(f"{ident}: classificação não reconhecida")
        for name in ("project", "title", "problem", "candidate_check"):
            minimum = 3 if name == "project" else 15
            if not isinstance(case[name], str) or len(case[name].strip()) < minimum:
                raise ValueError(f"{ident}: {name} insuficiente")
        links = case["sources"]
        if not isinstance(links, list) or not links or len(links) > 8 or len(set(links)) != len(links):
            raise ValueError(f"{ident}: links ausentes/duplicados")
        for link in links:
            if not isinstance(link, str):
                raise TypeError(f"{ident}: URL não textual")
            uri = urlparse(link)
            if uri.scheme != "https" or uri.netloc != "github.com" or not uri.path.startswith("/Softdown-prog/"):
                raise ValueError(f"{ident}: evidência fora dos repositórios autorizados")
            if uri.username or uri.password or uri.query or uri.fragment:
                raise ValueError(f"{ident}: URLs com tokens, queries ou fragmentos não são permitidas")
        if case["evidence_level"] == "conversation_report" and case["reproduction"] != "needs_replay":
            raise ValueError(f"{ident}: relato sem prova não pode ser marcado como reproduzido")
    return len(incidents)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, default=DEFAULT)
    args = parser.parse_args()
    try:
        count = validate(json.loads(args.file.read_text(encoding="utf-8")))
    except (ValueError, OSError, TypeError, json.JSONDecodeError) as exc:
        print("Catálogo de incidentes REPROVADO:", exc)
        return 1
    print(f"Catálogo de incidentes OK: {count} registros rastreáveis")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
