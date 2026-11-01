"""Agendador 24/7 local: não utiliza GitHub Actions nem recebe shell via JSON."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if __package__:
    from . import batch_worker
else:
    import batch_worker

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    status: str = "all"
    language: str = "all"
    max_items: int = 1000
    mode: str = "both"
    recheck_seconds: int = 86400


def revision_of(root: Path = ROOT) -> str:
    """Consulta somente o checkout já instalado, sem operação de rede."""
    command = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"], cwd=root,
        capture_output=True, text=True, check=False, timeout=15,
    )
    sha = command.stdout.strip()
    if command.returncode != 0 or len(sha) != 40:
        raise ValueError("checkout Git inválido; instalar via git clone primeiro")
    return sha


def fingerprint(catalog: dict[str, Any], revision: str, config: Settings) -> str:
    payload = {"revision": revision, "catalog": catalog, "status": config.status,
               "language": config.language, "max_items": config.max_items, "mode": config.mode}
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def run_cycle(
    *, catalog: dict[str, Any], revision: str, config: Settings,
    state_dir: Path, now: float | None = None,
) -> dict[str, Any]:
    """Executa uma fila, retoma uma interrompida e descansa após concluí-la."""
    if config.recheck_seconds < 60:
        raise ValueError("intervalo de nova validação deve ser >= 60s")
    state_dir.mkdir(parents=True, exist_ok=True)
    moment = time.time() if now is None else now
    signature = fingerprint(catalog, revision, config)
    checkpoint = state_dir / "checkpoint.json"
    old = None
    if checkpoint.is_file():
        old = json.loads(checkpoint.read_text(encoding="utf-8"))
        if not isinstance(old, dict) or old.get("schema_version") != 1:
            raise ValueError("checkpoint inválido; investigar antes de reiniciar")
    if old and old.get("signature") == signature and old.get("finished_at") is not None:
        if moment - float(old["finished_at"]) < config.recheck_seconds:
            return {"action": "idle", "checkpoint": old}
    if old and old.get("signature") == signature and old.get("finished_at") is None:
        run_id = old["run_id"]
        if not isinstance(run_id, str) or not run_id.replace("-", "").isalnum():
            raise ValueError("identificador persistido inválido")
        output = state_dir / "runs" / run_id
        resume = (output / "queue.json").is_file()
    else:
        run_id = f"{int(moment)}-{signature[:16]}"
        output = state_dir / "runs" / run_id
        if output.exists():
            raise ValueError("lote existente sem checkpoint compatível")
        old = {"schema_version": 1, "signature": signature, "revision": revision,
               "run_id": run_id, "started_at": moment, "finished_at": None,
               "counts": None}
        batch_worker.write_json(checkpoint, old)
        resume = False
    previous_sha = os.environ.get("GITHUB_SHA")
    os.environ["GITHUB_SHA"] = revision
    try:
        report = batch_worker.run_batch(
            catalog, status=config.status, language=config.language,
            max_items=config.max_items, mode=config.mode, output=output, resume=resume,
        )
    finally:
        if previous_sha is None:
            os.environ.pop("GITHUB_SHA", None)
        else:
            os.environ["GITHUB_SHA"] = previous_sha
    completed = {**old, "finished_at": moment, "counts": report["counts"],
                 "total_queued": report["total_queued"]}
    batch_worker.write_json(checkpoint, completed)
    return {"action": "processed", "checkpoint": completed}


def main(argv: list[str] | None = None) -> int:
    cli = argparse.ArgumentParser(description="Worker VPS permanente sem GitHub Actions.")
    cli.add_argument("--state-dir", type=Path, required=True)
    cli.add_argument("--status", choices=("all", "documented", "legacy_pending_review"),
                     default="all")
    cli.add_argument("--language", choices=("all", *batch_worker.LANGUAGES), default="all")
    cli.add_argument("--max-items", type=int, default=1000)
    cli.add_argument("--mode", choices=("parse", "both"), default="both")
    cli.add_argument("--poll-seconds", type=int, default=60)
    cli.add_argument("--recheck-seconds", type=int, default=86400)
    cli.add_argument("--once", action="store_true")
    args = cli.parse_args(argv)
    if not 1 <= args.max_items <= 1000 or args.poll_seconds < 10:
        cli.error("max-items: 1..1000; poll-seconds: >= 10")
    config = Settings(args.status, args.language, args.max_items, args.mode,
                      args.recheck_seconds)
    args.state_dir.mkdir(parents=True, exist_ok=True)
    # Um único processo por diretório, mesmo que o serviço reinicie.
    with (args.state_dir / "worker.lock").open("a+", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Já existe um worker executando neste diretório.", flush=True)
            return 2
        last_heartbeat = 0.0
        while True:
            try:
                catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
                outcome = run_cycle(
                    catalog=catalog, revision=revision_of(), config=config,
                    state_dir=args.state_dir,
                )
                if outcome["action"] == "processed":
                    state = outcome["checkpoint"]
                    print(f"LOTE CONCLUÍDO {state['run_id']}: {state['counts']}", flush=True)
                elif time.time() - last_heartbeat > 3600:
                    print("HEARTBEAT: worker online; fila sem novos itens.", flush=True)
                    last_heartbeat = time.time()
            except (OSError, ValueError, KeyError, TypeError,
                    json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
                print(f"ERRO DO SUPERVISOR: {exc}", file=sys.stderr, flush=True)
                if args.once:
                    return 2
            if args.once:
                return 0
            time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
