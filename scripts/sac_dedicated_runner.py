"""SAC-008F: independent, opt-in one-shot builder; never starts the catalog worker.

The local queue must be explicitly provisioned and owned by sac-builder.
Not installed or enabled by this repository.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import stat
from pathlib import Path

if __package__:
    from . import sac_execution, sac_job_queue, sac_rootless_runtime
else:
    import sac_execution
    import sac_job_queue
    import sac_rootless_runtime


def _private_directory(path: Path) -> None:
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_gid != os.getegid() or stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError("builder-state-not-private")


def _trusted_policy(path: Path) -> dict:
    meta = path.lstat()
    if (not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or
            stat.S_IMODE(meta.st_mode) & 0o022 or meta.st_size > 32768):
        raise ValueError("builder-policy-not-root-owned")
    with path.open("rb") as handle:
        return json.loads(handle.read(32769))


def run_once(*, state_dir: Path, projects: dict, auditors: dict,
             docker_host: str, node: str) -> dict:
    if type(docker_host) is not str or sac_rootless_runtime.SOCKET.fullmatch(
            docker_host.removeprefix("unix://")) is None or not docker_host.startswith("unix://"):
        raise ValueError("invalid-rootless-docker-endpoint")
    if node != "/usr/bin/node":
        raise ValueError("unapproved-node-executable")
    _private_directory(state_dir)
    # The Node/Docker staging directory must be private and visible to the
    # separate rootless daemon. ProtectSystem=strict denies arbitrary /tmp writes.
    _private_directory(Path("/var/lib/sac-builder/tmp"))
    # Isolated queue: no access to /var/lib/data-library-worker/state.
    if state_dir != Path("/var/lib/sac-builder/state"):
        raise ValueError("shared-or-unknown-state")
    with (state_dir / "worker.lock").open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        received = sac_job_queue.receive_pending(state_dir, projects, limit=16)
        executed = sac_execution.execute_received(
            state_dir, projects, auditors, limit=1,
            executor=node, enable_build=True, docker_host=docker_host, timeout=175,
        )
    return {"received": received["received"], "rejected": received["rejected"],
            "audited": executed["processed"], "skipped": executed["skipped"],
            "deployment_authorized": False}


def main(argv: list[str] | None = None) -> int:
    cli = argparse.ArgumentParser(description="Dedicated SAC rootless builder (no API)")
    cli.add_argument("--execute", action="store_true", help="Run at most one authorized job")
    cli.add_argument("--state-dir", type=Path, default=Path("/var/lib/sac-builder/state"))
    cli.add_argument("--projects", type=Path, default=Path("/etc/sac-builder/projects.json"))
    cli.add_argument("--auditors", type=Path, default=Path("/etc/sac-builder/auditors.json"))
    cli.add_argument("--node", default="/usr/bin/node")
    args = cli.parse_args(argv)
    runtime = sac_rootless_runtime.collect()
    if not runtime["ready"]:
        print(json.dumps({"status": "blocked", "blockers": runtime["blockers"],
                          "deployment_authorized": False}, sort_keys=True))
        return 2
    if not args.execute:
        print(json.dumps({"status": "rootless-local-probe-pass", "runtime_verified": True,
                          "deployment_authorized": False}, sort_keys=True))
        return 0
    try:
        result = run_once(
            state_dir=args.state_dir, projects=_trusted_policy(args.projects),
            auditors=_trusted_policy(args.auditors),
            docker_host=runtime["docker_host"], node=args.node,
        )
        print(json.dumps({"status": "executed-cycle", **result}, sort_keys=True))
        return 0
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        print(json.dumps({"status": "blocked", "blockers": ["builder-cycle-rejected"],
                          "deployment_authorized": False}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
