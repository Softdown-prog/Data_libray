"""SAC-008F: local rootless Docker gate for a dedicated builder identity.

Probes only the user's own AF_UNIX socket; does not install or change anything.
This is runtime evidence from the host where executed, not a remote attestation.
"""
from __future__ import annotations

import grp
import json
import os
import pwd
import re
import stat
import subprocess
from pathlib import Path

SOCKET = re.compile(r"/run/user/([1-9][0-9]{0,9})/docker\.sock\Z")


def evaluate(facts: dict) -> dict:
    """Pure review of measured metadata; synthetic tests never open a socket."""
    if type(facts) is not dict:
        raise ValueError("invalid-runtime-evidence")
    expected = {
        "uid", "gid", "username", "primary_group", "supplementary_groups",
        "runtime_dir_owner", "runtime_dir_mode", "runtime_dir_is_dir",
        "socket_owner", "socket_group", "socket_mode", "socket_is_socket",
        "docker_security",
    }
    if set(facts) != expected:
        raise ValueError("invalid-runtime-evidence")
    uid, gid = facts["uid"], facts["gid"]
    if type(uid) is not int or type(gid) is not int:
        raise ValueError("invalid-runtime-identity")
    blockers = []
    if uid < 1 or gid < 1 or facts["username"] != "sac-builder" or facts["primary_group"] != "sac-builder":
        blockers.append("builder-identity-not-isolated")
    if (type(facts["supplementary_groups"]) is not list or
            any(type(g) is not str for g in facts["supplementary_groups"]) or
            {"docker", "sudo"} & set(facts["supplementary_groups"])):
        blockers.append("privileged-group-membership")
    if (facts["runtime_dir_is_dir"] is not True or
            facts["runtime_dir_owner"] != uid or
            type(facts["runtime_dir_mode"]) is not int or
            facts["runtime_dir_mode"] & 0o022):
        blockers.append("runtime-dir-not-private")
    if (facts["socket_is_socket"] is not True or facts["socket_owner"] != uid or
            facts["socket_group"] != gid or
            type(facts["socket_mode"]) is not int or
            facts["socket_mode"] & 0o007):
        blockers.append("rootless-socket-not-owned")
    options = facts["docker_security"]
    if (type(options) is not list or
            any(type(o) is not str for o in options) or
            not any(o == "name=rootless" or o == "rootless" for o in options)):
        blockers.append("docker-rootless-not-confirmed")
    return {"ready": not blockers, "blockers": sorted(set(blockers)),
            "runtime_verified": not blockers, "deployment_authorized": False}


def collect(*, docker="/usr/bin/docker") -> dict:
    """Fail closed before Docker info when identity/socket metadata is unsafe."""
    try:
        uid, gid = os.geteuid(), os.getegid()
        owner = pwd.getpwuid(uid)
        primary = grp.getgrgid(gid).gr_name
        groups = [grp.getgrgid(g).gr_name for g in os.getgroups()]
        runtime = Path(f"/run/user/{uid}")
        socket = runtime / "docker.sock"
        runtime_info = runtime.lstat()
        sock_info = socket.lstat()
        metadata = {
            "uid": uid, "gid": gid, "username": owner.pw_name,
            "primary_group": primary, "supplementary_groups": groups,
            "runtime_dir_owner": runtime_info.st_uid,
            "runtime_dir_mode": stat.S_IMODE(runtime_info.st_mode),
            "runtime_dir_is_dir": stat.S_ISDIR(runtime_info.st_mode),
            "socket_owner": sock_info.st_uid, "socket_group": sock_info.st_gid,
            "socket_mode": stat.S_IMODE(sock_info.st_mode),
            "socket_is_socket": stat.S_ISSOCK(sock_info.st_mode),
            "docker_security": [],
        }
        preliminary = evaluate(metadata)
        # rootless-security-not-confirmed must be the sole possible missing gate
        if any(b != "docker-rootless-not-confirmed" for b in preliminary["blockers"]):
            return {"ready": False, "blockers": preliminary["blockers"],
                    "runtime_verified": False, "deployment_authorized": False}
        if docker != "/usr/bin/docker" or not SOCKET.fullmatch(str(socket)):
            raise ValueError("docker-client-or-socket-invalid")
        host = "unix://" + str(socket)
        process = subprocess.run(
            [docker, "--host", host, "info", "--format", "{{json .SecurityOptions}}"],
            capture_output=True, text=True, check=False, timeout=8,
            env={"PATH": "/usr/bin:/bin", "HOME": owner.pw_dir, "DOCKER_HOST": host},
        )
        if process.returncode != 0 or len(process.stdout) > 4096:
            raise ValueError("docker-rootless-probe-failed")
        metadata["docker_security"] = json.loads(process.stdout)
        result = evaluate(metadata)
        result["docker_host"] = host if result["ready"] else None
        return result
    except (OSError, KeyError, ValueError, TypeError, subprocess.TimeoutExpired):
        return {"ready": False, "blockers": ["rootless-runtime-unavailable"],
                "runtime_verified": False, "deployment_authorized": False}
