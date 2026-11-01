"""SAC-008F offline tests for rootless runtime and isolated builder."""
from __future__ import annotations

import copy
import json
import os
import stat
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import sac_dedicated_runner as runner
from scripts import sac_execution
from scripts import sac_rootless_runtime as runtime

FACTS = {
    "uid": 1002, "gid": 1002, "username": "sac-builder",
    "primary_group": "sac-builder", "supplementary_groups": ["sac-builder"],
    "runtime_dir_owner": 1002, "runtime_dir_mode": 0o700, "runtime_dir_is_dir": True,
    "socket_owner": 1002, "socket_group": 1002, "socket_mode": 0o660,
    "socket_is_socket": True, "docker_security": ["name=seccomp,profile=builtin", "name=rootless"],
}


class DedicatedRuntimeTests(unittest.TestCase):
    def test_valid_facts_are_not_deploy_authorization(self):
        v = runtime.evaluate(FACTS)
        self.assertTrue(v["ready"])
        self.assertTrue(v["runtime_verified"])
        self.assertFalse(v["deployment_authorized"])

    def test_privileged_or_different_identity_fails(self):
        for key, value in (
            ("uid", 0), ("username", "data-library"), ("primary_group", "docker"),
            ("supplementary_groups", ["docker"]), ("supplementary_groups", ["sudo"]),
            ("runtime_dir_owner", 0), ("runtime_dir_is_dir", False),
            ("runtime_dir_mode", 0o777), ("socket_owner", 0),
            ("socket_group", 0), ("socket_mode", 0o666), ("socket_is_socket", False),
            ("docker_security", ["name=seccomp,profile=builtin"]),
        ):
            with self.subTest(key=key, value=value):
                invalid = copy.deepcopy(FACTS)
                invalid[key] = value
                self.assertFalse(runtime.evaluate(invalid)["ready"])

    def test_schema_strict_and_bool_uid_rejected(self):
        with self.assertRaises(ValueError):
            runtime.evaluate({**FACTS, "command": "id"})
        with self.assertRaises(ValueError):
            runtime.evaluate({**FACTS, "uid": True})

    def test_rootless_endpoint_cannot_use_rootful_socket(self):
        for host in ("unix:///var/run/docker.sock", "tcp://127.0.0.1:2375",
                     "unix:///run/user/0/docker.sock", "unix:///run/user/1002/../docker.sock"):
            with self.assertRaises(ValueError):
                runner.run_once(state_dir=Path("/nope"), projects={}, auditors={},
                                docker_host=host, node="/usr/bin/node")

    def test_executor_rejects_untrusted_docker_host_before_jobs(self):
        with self.assertRaises(ValueError):
            sac_execution.execute_received("/tmp", {}, {},
                                           docker_host="unix:///var/run/docker.sock")

    def test_dry_probe_never_reads_policies_or_executes(self):
        with patch.object(runtime, "collect", return_value={"ready": True, "blockers": [],
                    "docker_host": "unix:///run/user/1002/docker.sock"}) as gate:
            with patch.object(runner, "run_once", side_effect=AssertionError("execution")):
                self.assertEqual(runner.main([]), 0)
            gate.assert_called_once()

    def test_failed_probe_fails_closed_even_with_execute(self):
        with patch.object(runtime, "collect", return_value={"ready": False,
                "blockers": ["docker-rootless-not-confirmed"]}):
            with patch.object(runner, "run_once", side_effect=AssertionError("execution")):
                self.assertEqual(runner.main(["--execute"]), 2)

    def test_legacy_unit_unmodified_and_template_non_installable(self):
        root = Path(__file__).resolve().parents[1]
        old = (root / "deploy/systemd/data-library-worker.service").read_text()
        self.assertNotIn("--sac-build", old)
        self.assertNotIn("docker.sock", old)
        template = (root / "deploy/sac/sac-builder.service.template").read_text()
        self.assertNotIn("[Install]", template)
        self.assertIn("User=sac-builder", template)
        self.assertIn("NoNewPrivileges=yes", template)
        self.assertNotIn("/var/run/docker.sock", template)
        self.assertIn("@SAC_BUILDER_UID@", template)

    def test_trusted_policy_must_be_root_owned(self):
        class Mode:
            st_mode = stat.S_IFREG | 0o666
            st_uid = 1002
            st_size = 20
        with patch.object(Path, "lstat", return_value=Mode()):
            with self.assertRaises(ValueError):
                runner._trusted_policy(Path("/etc/sac-builder/projects.json"))


if __name__ == "__main__":
    unittest.main()
