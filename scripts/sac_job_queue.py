"""SAC-008B: durable, non-executing inbox for authenticated GitHub Actions requests.

A request is only a request. Neither ingestion nor acknowledgement executes a
compiler or checks out a repository. Execution requires a separately approved
project-specific sandbox runner in a later milestone.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import tempfile

SCHEMA = 1
REQUEST_KEYS = frozenset(("schema_version", "job_id", "project_id", "profile_id", "source_sha", "kind"))
PROJECT_KEYS = frozenset(("project_id", "profile_id"))
JOB_ID = re.compile(r"gha-[0-9]{1,15}-[1-9][0-9]{0,3}\Z")
SLUG = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
MAX_RECORD = 2048
MAX_SCAN = 64


def _exact(value, keys):
    if type(value) is not dict or value.keys() != keys:
        raise ValueError("invalid-keys")
    return value


def validate_request(value):
    obj = _exact(value, REQUEST_KEYS)
    if (type(obj["schema_version"]) is not int or obj["schema_version"] != SCHEMA
            or type(obj["job_id"]) is not str or JOB_ID.fullmatch(obj["job_id"]) is None
            or type(obj["project_id"]) is not str or SLUG.fullmatch(obj["project_id"]) is None
            or type(obj["profile_id"]) is not str or SLUG.fullmatch(obj["profile_id"]) is None
            or type(obj["source_sha"]) is not str or SHA.fullmatch(obj["source_sha"]) is None
            or obj["kind"] != "angular-validate"):
        raise ValueError("invalid-request")
    return obj


def validate_policy(value):
    policy = _exact(value, frozenset(("schema_version", "projects")))
    if (type(policy["schema_version"]) is not int or policy["schema_version"] != SCHEMA
            or type(policy["projects"]) is not list or len(policy["projects"]) > 128):
        raise ValueError("invalid-project-policy")
    accepted = set()
    for entry in policy["projects"]:
        project = _exact(entry, PROJECT_KEYS)
        pair = (project["project_id"], project["profile_id"])
        if not all(type(x) is str and SLUG.fullmatch(x) for x in pair) or pair in accepted:
            raise ValueError("invalid-project-policy")
        accepted.add(pair)
    return accepted


def _data(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")


def _directory(path):
    if path.is_symlink() or not path.is_dir():
        raise ValueError("untrusted-directory")
    return path


def _read(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
        raise ValueError("unsafe-file")
    with path.open("rb") as handle:
        raw = handle.read(MAX_RECORD + 1)
    if len(raw) > MAX_RECORD:
        raise ValueError("oversize-record")
    return json.loads(raw)


def _create_once(directory, filename, value):
    """Write a fully formed record, publish with hardlink/exclusive create.

    Refuse overwrites and symlinks. Directory is owned by the trusted host.
    """
    _directory(directory)
    payload = _data(value)
    if len(payload) > MAX_RECORD:
        raise ValueError("oversize-record")
    destination = directory / filename
    if destination.exists() or destination.is_symlink():
        if _read(destination) != value:
            raise ValueError("conflicting-record")
        return destination
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".sac-inbox-", delete=False) as output:
            temp = Path(output.name)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temp, 0o600)
        try:
            os.link(temp, destination, follow_symlinks=False)
        except FileExistsError:
            if _read(destination) != value:
                raise ValueError("conflicting-record")
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)
    return destination


def enqueue(state_dir, request, policy):
    """For host-side test/staging only; production writing belongs to vpsops."""
    request = validate_request(request)
    if (request["project_id"], request["profile_id"]) not in validate_policy(policy):
        raise PermissionError("project-profile-not-authorized")
    inbox = Path(state_dir) / "sac-inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    return _create_once(inbox, request["job_id"] + ".json", request)


def receive_pending(state_dir, policy, *, limit=MAX_SCAN):
    """Called by the existing One Worker, opt-in, without executing code."""
    if type(limit) is not int or not 1 <= limit <= MAX_SCAN:
        raise ValueError("invalid-limit")
    allowed = validate_policy(policy)
    state = Path(state_dir)
    inbox = state / "sac-inbox"
    if not inbox.exists():
        return {"received": 0, "rejected": 0, "execution": "disabled"}
    _directory(inbox)
    received = rejected = 0
    jobs = state / "sac-jobs"
    jobs.mkdir(parents=True, exist_ok=True)
    _directory(jobs)
    # Prefix/filename whitelist prevents traversal and arbitrary filesystem access.
    filenames = sorted(p.name for p in inbox.iterdir() if p.name.startswith("gha-"))[:limit]
    for filename in filenames:
        if not filename.endswith(".json") or JOB_ID.fullmatch(filename[:-5]) is None:
            rejected += 1
            continue
        try:
            request = validate_request(_read(inbox / filename))
            if request["job_id"] + ".json" != filename:
                raise ValueError("job-filename-mismatch")
            if (request["project_id"], request["profile_id"]) not in allowed:
                raise PermissionError("project-profile-not-authorized")
            receipt = {
                "schema_version": SCHEMA, "job_id": request["job_id"],
                "project_id": request["project_id"], "profile_id": request["profile_id"],
                "source_sha": request["source_sha"], "status": "received",
                "execution": "disabled", "static_pipeline_pass": False,
                "browser_pass": False, "deployment_authorized": False,
            }
            _create_once(jobs, filename, receipt)
            received += 1
        except (ValueError, PermissionError, OSError, TypeError, json.JSONDecodeError):
            rejected += 1
    return {"received": received, "rejected": rejected, "execution": "disabled"}
