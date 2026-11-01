"""SAC-008E: offline, read-only pre-homologation plan validator.

This deliberately does NOT connect to Docker, Actions, SSH or the VPS.
A passing plan is not proof of host state or permission to deploy.
"""
from __future__ import annotations

import argparse
import configparser
import json
import re
from pathlib import Path
from typing import Any

REQUIRED_TOP = {"schema_version", "mode", "catalog_worker", "builder", "capacity"}
CATALOG = {"user", "unit", "build_flags_enabled", "docker_socket_access"}
BUILDER = {
    "user", "uid", "separate_service", "rootless", "socket",
    "socket_owner_uid", "docker_group_member", "dedicated_workspace",
    "source_revision_verified", "pinned_image", "no_project_secrets",
    "network", "cpus", "memory_mb", "pids_limit", "max_parallel",
    "build_timeout_seconds",
}
CAPACITY = {"ram_total_mb", "reserve_other_projects_mb"}
USER = re.compile(r"[a-z_][a-z0-9_-]{0,31}\Z")
ROOTLESS_SOCKET = re.compile(r"/run/user/([1-9][0-9]{0,9})/docker\.sock\Z")


def _exact(value: Any, fields: set[str]) -> dict:
    if type(value) is not dict or set(value) != fields:
        raise ValueError("invalid-plan-contract")
    return value


def _safe_int(value: Any, minimum: int, maximum: int) -> bool:
    return type(value) is int and minimum <= value <= maximum


def inspect_unit(unit_text: str) -> list[str]:
    """Check that the legacy library worker is still a non-Docker catalog service."""
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.optionxform = str
    try:
        parser.read_string(unit_text)
    except configparser.Error as error:
        raise ValueError("invalid-systemd-unit") from error
    if not parser.has_section("Service"):
        raise ValueError("invalid-systemd-unit")
    svc = parser["Service"]
    blocked = []
    if svc.get("User") != "data-library" or svc.get("Group") != "data-library":
        blocked.append("catalog-identity-changed")
    start = svc.get("ExecStart", "")
    if not start or "scripts/vps_daemon.py" not in start or any(
        flag in start for flag in ("--sac-build", "--sac-audit", "--sac-inbox")
    ):
        blocked.append("catalog-build-flags-enabled")
    required = {
        "NoNewPrivileges": "yes", "PrivateDevices": "yes",
        "ProtectSystem": "strict", "IPAddressDeny": "any",
    }
    if any(svc.get(key, "").lower() != val for key, val in required.items()):
        blocked.append("catalog-systemd-hardening-changed")
    extra = " ".join(svc.get(k, "") for k in (
        "SupplementaryGroups", "Environment", "EnvironmentFile",
        "BindPaths", "BindReadOnlyPaths", "ReadWritePaths", "ExecStart",
    )).lower()
    if ("docker.sock" in extra or "docker_host" in extra or
            "docker" in svc.get("SupplementaryGroups", "").split() or
            "/run/user/" in extra):
        blocked.append("catalog-docker-access-configured")
    return blocked


def check_plan(plan: Any, unit_text: str) -> dict[str, Any]:
    """Review declared controls; do not attest real deployment conditions."""
    obj = _exact(plan, REQUIRED_TOP)
    catalog = _exact(obj["catalog_worker"], CATALOG)
    builder = _exact(obj["builder"], BUILDER)
    capacity = _exact(obj["capacity"], CAPACITY)
    if obj["schema_version"] != 1 or type(obj["schema_version"]) is not int or obj["mode"] != "review-only":
        raise ValueError("invalid-plan-contract")
    for value in (catalog["build_flags_enabled"], catalog["docker_socket_access"],
                  builder["separate_service"], builder["rootless"], builder["docker_group_member"],
                  builder["dedicated_workspace"], builder["source_revision_verified"],
                  builder["pinned_image"], builder["no_project_secrets"]):
        if type(value) is not bool:
            raise ValueError("invalid-plan-boolean")
    if (type(catalog["user"]) is not str or not USER.fullmatch(catalog["user"]) or
            type(builder["user"]) is not str or not USER.fullmatch(builder["user"]) or
            catalog["unit"] != "data-library-worker.service"):
        raise ValueError("invalid-plan-identity")
    for key, lo, hi in (
        ("uid", 1, 1000000000), ("cpus", 1, 16), ("memory_mb", 128, 32768),
        ("pids_limit", 16, 4096), ("max_parallel", 1, 16),
        ("build_timeout_seconds", 10, 600),
    ):
        if not _safe_int(builder[key], lo, hi):
            raise ValueError("invalid-plan-resource")
    for key, lo, hi in (("ram_total_mb", 512, 1048576),
                         ("reserve_other_projects_mb", 0, 1048576)):
        if not _safe_int(capacity[key], lo, hi):
            raise ValueError("invalid-plan-resource")
    if type(builder["socket"]) is not str or type(builder["socket_owner_uid"]) is not int:
        raise ValueError("invalid-plan-socket")
    issues = inspect_unit(unit_text)
    if catalog["user"] != "data-library" or catalog["build_flags_enabled"] or catalog["docker_socket_access"]:
        issues.append("catalog-not-isolated")
    if not builder["separate_service"] or builder["user"] in ("root", catalog["user"]):
        issues.append("builder-service-not-independent")
    socket_match = ROOTLESS_SOCKET.fullmatch(builder["socket"])
    if (not builder["rootless"] or builder["docker_group_member"] or
            builder["socket_owner_uid"] != builder["uid"] or
            socket_match is None or int(socket_match.group(1)) != builder["uid"]):
        issues.append("rootless-docker-socket-not-isolated")
    if (not builder["dedicated_workspace"] or not builder["source_revision_verified"] or
            not builder["pinned_image"] or not builder["no_project_secrets"] or
            builder["network"] != "none"):
        issues.append("untrusted-build-inputs")
    if (builder["cpus"] > 1 or builder["memory_mb"] > 1024 or
            builder["pids_limit"] > 128 or builder["max_parallel"] != 1 or
            builder["build_timeout_seconds"] > 120):
        issues.append("build-budget-exceeds-policy")
    if (capacity["ram_total_mb"] - capacity["reserve_other_projects_mb"] <
            builder["memory_mb"] + 384):
        issues.append("insufficient-host-memory-reserve")
    return {
        "schema_version": 1,
        "phase": "pre-homologation",
        "status": "plan-review-pass" if not issues else "blocked",
        "blockers": sorted(set(issues)),
        "vps_contacted": False,
        "runtime_verified": False,
        "service_modified": False,
        "deployment_authorized": False,
    }


def main(argv: list[str] | None = None) -> int:
    cli = argparse.ArgumentParser(description="Read-only SAC VPS readiness plan validation")
    cli.add_argument("--plan", type=Path, required=True)
    cli.add_argument("--catalog-unit", type=Path, required=True)
    args = cli.parse_args(argv)
    try:
        data = args.plan.read_bytes()
        unit = args.catalog_unit.read_bytes()
        if len(data) > 32768 or len(unit) > 16384:
            raise ValueError("oversize-plan")
        result = check_plan(json.loads(data), unit.decode("utf-8"))
    except (ValueError, OSError, TypeError, KeyError, UnicodeError, json.JSONDecodeError):
        result = {
            "schema_version": 1, "phase": "pre-homologation",
            "status": "blocked", "blockers": ["invalid-input"],
            "vps_contacted": False, "runtime_verified": False,
            "service_modified": False, "deployment_authorized": False,
        }
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "plan-review-pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
