from __future__ import annotations

import os
import tempfile
from pathlib import Path


def atomic_write(path: Path, data: str) -> None:
    """Escreve em arquivo temporário no mesmo diretório e substitui o destino."""
    path = Path(path)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as stream:
            temporary = stream.name
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
