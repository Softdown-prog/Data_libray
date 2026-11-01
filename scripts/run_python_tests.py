#!/usr/bin/env python3
"""Executa cada arquivo test_*.py isoladamente, sem depender de __init__.py."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
tests = sorted((ROOT / "python").rglob("test_*.py"))
if not tests:
    sys.exit("Nenhum teste Python encontrado")
for test in tests:
    print(f"Teste: {test.relative_to(ROOT)}", flush=True)
    result = subprocess.run([sys.executable, str(test)], cwd=test.parent, check=False)
    if result.returncode != 0:
        sys.exit(result.returncode)
print(f"{len(tests)} arquivo(s) de teste Python passaram.")
