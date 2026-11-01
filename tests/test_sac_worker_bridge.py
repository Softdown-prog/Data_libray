"""Tests for SAC-007: no credentials, commands, repository or VPS required."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import sac_worker_bridge as bridge


class BridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = os.urandom(32)
        self.task = {
            "schema_version": 1, "project_id": "demo-one", "profile_id": "angular-root",
            "source_sha": "a" * 40, "profile_digest": "b" * 64,
            "artifact_digest": "c" * 64, "guardian_digest": "d" * 64,
        }
        self.policy = {"schema_version": 1, "projects": [
            {"project_id": "demo-one", "profile_id": "angular-root", "browser_required": True},
            {"project_id": "demo-two", "profile_id": "angular-subpath", "browser_required": True},
        ]}
        self.evidence = {
            "schema_version": 1, "status": "pass", "static_pipeline_pass": True,
            "browser_pass": True, "deployment_authorized": False,
            "binding": {
                "source_sha_claim": self.task["source_sha"],
                "profile_digest": self.task["profile_digest"],
                "artifact_digest": self.task["artifact_digest"],
                "guardian_digest": self.task["guardian_digest"],
            }, "browser": {"status": "pass", "executed": True},
        }

    def signed(self) -> dict:
        return bridge.sign_submission(self.task, self.evidence, self.key)

    def verify(self, submission: dict | None = None, **kw) -> dict:
        return bridge.verify_submission(kw.get("policy", self.policy),
                                        kw.get("task", self.task),
                                        self.signed() if submission is None else submission,
                                        kw.get("key", self.key))

    def test_signed_success_with_no_deployment_authority(self) -> None:
        result = self.verify()
        self.assertEqual(result["status"], "verified")
        self.assertTrue(result["static_pipeline_pass"])
        self.assertTrue(result["browser_pass"])
        self.assertFalse(result["deployment_authorized"])
        self.assertNotIn("binding", result)

    def test_signing_key_too_short_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            bridge.sign_submission(self.task, self.evidence, b"password")
        self.assertEqual(self.verify(key=b"x" * 16)["status"], "unverified")

    def test_unknown_project_and_wrong_profile_rejected(self) -> None:
        p = copy.deepcopy(self.policy)
        p["projects"] = p["projects"][1:]
        self.assertEqual(self.verify(policy=p)["code"], "project-not-allowlisted")
        p["projects"][0]["project_id"] = "demo-one"
        self.assertEqual(self.verify(policy=p)["code"], "project-not-allowlisted")

    def test_submission_reuse_for_other_commit_or_project_fails(self) -> None:
        for field, val in [("source_sha", "f" * 40), ("project_id", "demo-two"),
                           ("profile_digest", "1" * 64), ("artifact_digest", "2" * 64),
                           ("guardian_digest", "3" * 64)]:
            modified = {**self.task, field: val}
            self.assertNotEqual(self.verify(task=modified)["status"], "verified")

    def test_tamper_signed_evidence_fields_rejected(self) -> None:
        for field, value in [("status", "fail"), ("browser_pass", False),
                             ("static_pipeline_pass", False)]:
            receipt = self.signed()
            receipt["evidence"][field] = value
            self.assertEqual(self.verify(receipt)["status"], "unverified")

    def test_binding_tamper_even_when_resigned_rejected(self) -> None:
        e = copy.deepcopy(self.evidence)
        e["binding"]["artifact_digest"] = "e" * 64
        receipt = bridge.sign_submission(self.task, e, self.key)
        self.assertEqual(self.verify(receipt)["code"], "evidence-binding-mismatch")

    def test_extra_contract_fields_and_shell_values_rejected(self) -> None:
        for field in ("command", "url", "path", "docker_flags"):
            with self.assertRaises(ValueError):
                bridge.validate_task({**self.task, field: "sh -c id"})
        with self.assertRaises(ValueError):
            bridge.validate_task({**self.task, "project_id": "../escape"})
        with self.assertRaises(ValueError):
            bridge.validate_policy({**self.policy, "command": "rm -rf /"})

    def test_contradictions_rejected_before_signing(self) -> None:
        for change in (
            {"browser_pass": False},
            {"deployment_authorized": True},
            {"static_pipeline_pass": False},
        ):
            e = {**self.evidence, **change}
            with self.assertRaises(ValueError):
                bridge.sign_submission(self.task, e, self.key)

    def test_browser_failure_does_not_verify(self) -> None:
        e = copy.deepcopy(self.evidence)
        e.update(status="fail", browser_pass=False)
        e["browser"] = {"status": "fail", "executed": True}
        self.assertEqual(self.verify(bridge.sign_submission(self.task, e, self.key))["status"], "blocked")

    def test_required_browser_unverified(self) -> None:
        e = copy.deepcopy(self.evidence)
        e.update(status="unverified", browser_pass=False)
        e["browser"] = {"status": "unverified", "executed": False}
        self.assertEqual(self.verify(bridge.sign_submission(self.task, e, self.key))["code"],
                         "browser-required-unverified")

    def test_static_only_cannot_authorize_deploy(self) -> None:
        p = copy.deepcopy(self.policy)
        p["projects"][0]["browser_required"] = False
        e = copy.deepcopy(self.evidence)
        e.update(status="unverified", browser_pass=False)
        e["browser"] = {"status": "unverified", "executed": False}
        result = self.verify(bridge.sign_submission(self.task, e, self.key), policy=p)
        self.assertEqual(result["status"], "static-only")
        self.assertFalse(result["deployment_authorized"])

    def test_infra_error_never_verifies(self) -> None:
        e = copy.deepcopy(self.evidence)
        e.update(status="infra-error", browser_pass=False)
        e["browser"] = {"status": "infra-error", "executed": False}
        self.assertEqual(self.verify(bridge.sign_submission(self.task, e, self.key))["status"],
                         "unverified")

    def test_wrong_secret_and_corrupt_signature(self) -> None:
        self.assertEqual(self.verify(key=os.urandom(32))["code"], "signature-invalid")
        r = self.signed()
        r["signature"] = "z" * 64
        self.assertEqual(self.verify(r)["code"], "signature-invalid")

    def test_duplicate_policy_names_fail(self) -> None:
        p = copy.deepcopy(self.policy)
        p["projects"].append(p["projects"][0])
        with self.assertRaises(ValueError):
            bridge.validate_policy(p)

    def test_atomic_result_idempotence_and_conflict(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            state = Path(name)
            verdict = self.verify()
            first = bridge.persist_verdict(state, verdict)
            self.assertEqual(first, bridge.persist_verdict(state, verdict))
            data = json.loads(first.read_text())
            self.assertEqual(data["code"], "sac-static-and-browser-pass")
            changed = {**verdict, "code": "different"}
            with self.assertRaises(ValueError):
                bridge.persist_verdict(state, changed)
            self.assertEqual(json.loads(first.read_text()), data)
            self.assertFalse(any(p.name.startswith(".sac-") for p in state.iterdir()))

    def test_reject_symlink_target(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            state = Path(name)
            verdict = self.verify()
            target = state / (bridge.task_key(self.task) + ".json")
            outside = state / "other.json"
            outside.write_text("do-not-change")
            target.symlink_to(outside)
            with self.assertRaises(ValueError):
                bridge.persist_verdict(state, verdict)
            self.assertEqual(outside.read_text(), "do-not-change")

    def test_cli_offline_success_and_tamper(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            path = Path(name)
            files = {}
            for item, data in [("policy", self.policy), ("task", self.task),
                               ("submission", self.signed())]:
                f = path / (item + ".json")
                f.write_text(json.dumps(data))
                files[item] = f
            keyfile = path / "secret"
            keyfile.write_bytes(self.key)
            argv = ["--policy", str(files["policy"]), "--task", str(files["task"]),
                    "--submission", str(files["submission"]), "--trust-key", str(keyfile),
                    "--state-dir", str(path / "state")]
            with patch.object(bridge.sys, "argv", ["sac_worker_bridge.py", *argv]):
                with patch("builtins.print") as printed:
                    self.assertEqual(bridge.main(argv), 0)
                    self.assertIn('"status": "verified"', printed.call_args.args[0])
            files["submission"].write_text("{}")
            with patch("builtins.print"):
                self.assertEqual(bridge.main(argv), 1)

    def test_sha_digest_stability_for_same_task(self) -> None:
        digest = bridge.task_key(self.task)
        self.assertEqual(len(digest), 64)
        self.assertEqual(digest, bridge.task_key(dict(reversed(list(self.task.items())))))
        self.assertNotEqual(digest, hashlib.sha256(b"unsigned").hexdigest())


if __name__ == "__main__":
    unittest.main()
