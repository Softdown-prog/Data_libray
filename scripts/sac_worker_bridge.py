"""SAC-007: offline attestation handoff to a multi-project supervisor.

No execution of user-supplied code, commands, browser, Docker or network requests.
The supervisor is not enabled by importing this module.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

SCHEMA = 1
DOMAIN = b"softdown-sac-worker-bridge-v1\x00"
IDENTITY = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
TASK_FIELDS = frozenset({
    "schema_version", "project_id", "profile_id", "source_sha",
    "profile_digest", "artifact_digest", "guardian_digest",
})
BINDING_FIELDS = frozenset({
    "source_sha_claim", "profile_digest", "artifact_digest", "guardian_digest",
})
EVIDENCE_FIELDS = frozenset({
    "schema_version", "status", "static_pipeline_pass", "browser_pass",
    "deployment_authorized", "binding", "browser",
})


def _record(value: Any, keys: frozenset[str]) -> dict[str, Any]:
    if type(value) is not dict or value.keys() != keys:
        raise ValueError("invalid-record-fields")
    return value


def _identifier(value: Any) -> bool:
    return type(value) is str and IDENTITY.fullmatch(value) is not None


def _digest(value: Any, pattern: re.Pattern[str] = HASH) -> bool:
    return type(value) is str and pattern.fullmatch(value) is not None


def _canon(data: Any) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("ascii")


def validate_task(task: Any) -> dict[str, Any]:
    t = _record(task, TASK_FIELDS)
    if (type(t["schema_version"]) is not int or t["schema_version"] != SCHEMA
            or not _identifier(t["project_id"]) or not _identifier(t["profile_id"])
            or not _digest(t["source_sha"], COMMIT)
            or any(not _digest(t[k]) for k in (
                "profile_digest", "artifact_digest", "guardian_digest"
            ))):
        raise ValueError("invalid-task")
    return t


def validate_policy(policy: Any) -> dict[str, dict[str, Any]]:
    obj = _record(policy, frozenset({"schema_version", "projects"}))
    projects = obj["projects"]
    if (type(obj["schema_version"]) is not int or obj["schema_version"] != SCHEMA
            or type(projects) is not list or not 1 <= len(projects) <= 256):
        raise ValueError("invalid-policy")
    allowed: dict[str, dict[str, Any]] = {}
    for entry in projects:
        p = _record(entry, frozenset({"project_id", "profile_id", "browser_required"}))
        if (not _identifier(p["project_id"]) or not _identifier(p["profile_id"])
                or type(p["browser_required"]) is not bool
                or p["project_id"] in allowed):
            raise ValueError("invalid-policy-project")
        allowed[p["project_id"]] = p
    return allowed


def validate_evidence(evidence: Any) -> dict[str, Any]:
    e = _record(evidence, EVIDENCE_FIELDS)
    b = _record(e["binding"], BINDING_FIELDS)
    browser = _record(e["browser"], frozenset({"status", "executed"}))
    statuses = {"pass", "fail", "unverified", "infra-error", "not-applicable"}
    if (type(e["schema_version"]) is not int or e["schema_version"] != SCHEMA
            or e["status"] not in statuses or browser["status"] not in statuses
            or any(type(e[k]) is not bool for k in (
                "static_pipeline_pass", "browser_pass", "deployment_authorized"
            ))
            or type(browser["executed"]) is not bool
            or e["deployment_authorized"] is not False
            or not _digest(b["source_sha_claim"], COMMIT)
            or any(not _digest(b[k]) for k in (
                "profile_digest", "artifact_digest", "guardian_digest"
            ))):
        raise ValueError("invalid-evidence")
    if e["browser_pass"] != (browser["status"] == "pass" and browser["executed"]):
        raise ValueError("inconsistent-browser")
    if (e["browser_pass"] and not e["static_pipeline_pass"]
            or e["status"] == "pass" and not (
                e["static_pipeline_pass"] and e["browser_pass"]
            )):
        raise ValueError("inconsistent-coverage")
    return e


def _body(task: dict[str, Any], evidence: dict[str, Any]) -> dict[str, Any]:
    return {"schema_version": SCHEMA, "task": task, "evidence": evidence}


def sign_submission(task: Any, evidence: Any, key: bytes) -> dict[str, Any]:
    """Only a trusted CI reporter holding an isolated signing key may call this."""
    t, e = validate_task(task), validate_evidence(evidence)
    if type(key) is not bytes or len(key) < 32:
        raise ValueError("invalid-signing-key")
    payload = _body(t, e)
    signature = hmac.new(key, DOMAIN + _canon(payload), hashlib.sha256).hexdigest()
    return {**payload, "signature": signature}


def task_key(task: Any) -> str:
    return hashlib.sha256(DOMAIN + _canon(validate_task(task))).hexdigest()


def _verdict(task: Any, state: str, code: str) -> dict[str, Any]:
    t = validate_task(task)
    return {
        "schema_version": SCHEMA, "project_id": t["project_id"],
        "profile_id": t["profile_id"], "source_sha": t["source_sha"],
        "task_digest": task_key(t), "status": state, "code": code,
        "static_pipeline_pass": False, "browser_pass": False,
        "deployment_authorized": False,
    }


def verify_submission(policy: Any, task: Any, submission: Any, key: bytes) -> dict[str, Any]:
    """Fail closed; a signed CI declaration is not independent proof of deployment."""
    t = validate_task(task)
    result = _verdict(t, "unverified", "evidence-not-verified")
    allowed = validate_policy(policy)
    project = allowed.get(t["project_id"])
    if project is None or project["profile_id"] != t["profile_id"]:
        result["code"] = "project-not-allowlisted"
        return result
    if type(key) is not bytes or len(key) < 32:
        result["code"] = "trust-key-invalid"
        return result
    try:
        envelope = _record(submission, frozenset({
            "schema_version", "task", "evidence", "signature",
        }))
        if envelope["schema_version"] != SCHEMA or envelope["task"] != t:
            result["code"] = "task-binding-mismatch"
            return result
        signature = envelope["signature"]
        if not _digest(signature):
            result["code"] = "signature-invalid"
            return result
        expected = hmac.new(key, DOMAIN + _canon(_body(t, envelope["evidence"])),
                            hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            result["code"] = "signature-invalid"
            return result
        e = validate_evidence(envelope["evidence"])
    except (ValueError, TypeError, KeyError, OverflowError):
        result["code"] = "evidence-invalid"
        return result
    b = e["binding"]
    if any(b[field] != t[corresponding] for field, corresponding in (
        ("source_sha_claim", "source_sha"),
        ("profile_digest", "profile_digest"),
        ("artifact_digest", "artifact_digest"),
        ("guardian_digest", "guardian_digest"),
    )):
        result["code"] = "evidence-binding-mismatch"
        return result
    result["static_pipeline_pass"] = e["static_pipeline_pass"]
    result["browser_pass"] = e["browser_pass"]
    if e["status"] == "infra-error" or e["browser"]["status"] == "infra-error":
        result.update(status="unverified", code="ci-infrastructure-error")
    elif not e["static_pipeline_pass"] or e["status"] == "fail":
        result.update(status="blocked", code="sac-check-failed")
    elif e["browser_pass"] and e["status"] == "pass":
        result.update(status="verified", code="sac-static-and-browser-pass")
    elif project["browser_required"]:
        result.update(status="unverified", code="browser-required-unverified")
    else:
        result.update(status="static-only", code="browser-not-verified")
    return result


def persist_verdict(state_dir: Path, verdict: Any) -> Path:
    """Idempotent, atomic local storage. The state dir is owned by the trusted host."""
    v = _record(verdict, frozenset({
        "schema_version", "project_id", "profile_id", "source_sha",
        "task_digest", "status", "code", "static_pipeline_pass",
        "browser_pass", "deployment_authorized",
    }))
    if not _digest(v["task_digest"]) or not _identifier(v["project_id"]):
        raise ValueError("invalid-verdict")
    state_dir.mkdir(parents=True, exist_ok=True)
    target = state_dir / (v["task_digest"] + ".json")
    encoded = _canon(v) + b"\n"
    if target.exists() or target.is_symlink():
        if target.is_symlink() or target.read_bytes() != encoded:
            raise ValueError("conflicting-task-result")
        return target
    filename = None
    try:
        with tempfile.NamedTemporaryFile(dir=state_dir, prefix=".sac-", delete=False) as handle:
            filename = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        # A separate supervisor lock is required if multiple writers share state_dir.
        if target.exists():
            if target.read_bytes() != encoded:
                raise ValueError("conflicting-task-result")
        else:
            os.replace(filename, target)
            filename = None
    finally:
        if filename is not None:
            filename.unlink(missing_ok=True)
    return target


def _load_json(path: Path) -> Any:
    data = path.read_bytes()
    if len(data) > 65536:
        raise ValueError("json-size-limit")
    return json.loads(data)


def main(argv: list[str] | None = None) -> int:
    cli = argparse.ArgumentParser(description="Importar atestado SAC offline; sem execução de comandos.")
    cli.add_argument("--policy", type=Path, required=True)
    cli.add_argument("--task", type=Path, required=True)
    cli.add_argument("--submission", type=Path, required=True)
    cli.add_argument("--trust-key", type=Path, required=True)
    cli.add_argument("--state-dir", type=Path)
    args = cli.parse_args(argv)
    try:
        task = validate_task(_load_json(args.task))
        verdict = verify_submission(_load_json(args.policy), task,
                                    _load_json(args.submission), args.trust_key.read_bytes())
        if args.state_dir:
            persist_verdict(args.state_dir, verdict)
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        print(json.dumps({"schema_version": SCHEMA, "status": "unverified",
                          "code": "invalid-local-input", "deployment_authorized": False}))
        return 2
    print(json.dumps(verdict, sort_keys=True))
    return 0 if verdict["status"] == "verified" else 1


if __name__ == "__main__":
    sys.exit(main())
