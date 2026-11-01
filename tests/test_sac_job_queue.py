"""SAC-008B queue contract and fail-closed acknowledgement; no VPS or network."""
import json
from pathlib import Path
import tempfile
import unittest
from scripts import sac_job_queue as q

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.policy = {"schema_version": 1, "projects": [
            {"project_id": "generic-one", "profile_id": "angular-root"},
            {"project_id": "generic-two", "profile_id": "angular-subpath"},
        ]}
        self.job = {"schema_version": 1, "job_id": "gha-123456789-1",
                    "project_id": "generic-one", "profile_id": "angular-root",
                    "source_sha": "a" * 40, "kind": "angular-validate"}

    def test_enqueue_and_worker_receive_without_execution(self):
        q.enqueue(self.root, self.job, self.policy)
        result = q.receive_pending(self.root, self.policy)
        self.assertEqual(result, {"received": 1, "rejected": 0, "execution": "disabled"})
        receipt = json.loads((self.root / "sac-jobs" / (self.job["job_id"] + ".json")).read_text())
        self.assertEqual(receipt["status"], "received")
        self.assertEqual(receipt["execution"], "disabled")
        self.assertFalse(receipt["static_pipeline_pass"])
        self.assertFalse(receipt["browser_pass"])
        self.assertFalse(receipt["deployment_authorized"])
        self.assertNotIn("command", receipt)

    def test_idempotent_replay_and_conflicting_replay(self):
        q.enqueue(self.root, self.job, self.policy)
        q.enqueue(self.root, self.job, self.policy)
        with self.assertRaises(ValueError):
            q.enqueue(self.root, {**self.job, "source_sha": "b" * 40}, self.policy)
        self.assertEqual(q.receive_pending(self.root, self.policy)["received"], 1)

    def test_no_project_is_enabled_by_default(self):
        with self.assertRaises(PermissionError):
            q.enqueue(self.root, self.job, {"schema_version": 1, "projects": []})

    def test_reject_invalid_fields_and_path_injection(self):
        bad = [
            {**self.job, "command": "bash -c id"},
            {**self.job, "kind": "shell"},
            {**self.job, "job_id": "../../etc/passwd"},
            {**self.job, "project_id": "../other"},
            {**self.job, "source_sha": "main"},
            {**self.job, "schema_version": True},
        ]
        for job in bad:
            with self.subTest(job=job), self.assertRaises(ValueError):
                q.validate_request(job)

    def test_filename_binding_and_malformed_inbox_are_rejected(self):
        d = self.root / "sac-inbox"
        d.mkdir()
        (d / "gha-999-1.json").write_text(json.dumps(self.job))
        (d / "gha-888-1.json").write_text("{not-json}")
        self.assertEqual(q.receive_pending(self.root, self.policy)["rejected"], 2)

    def test_symlink_file_refused(self):
        d = self.root / "sac-inbox"
        d.mkdir()
        outside = self.root / "private"
        outside.write_text("{}")
        (d / "gha-123-1.json").symlink_to(outside)
        self.assertEqual(q.receive_pending(self.root, self.policy)["rejected"], 1)
        self.assertEqual(outside.read_text(), "{}")

    def test_unknown_project_cannot_be_admitted_even_if_file_present(self):
        q.enqueue(self.root, self.job, self.policy)
        different = {"schema_version": 1, "projects": [
            {"project_id": "generic-two", "profile_id": "angular-subpath"}
        ]}
        self.assertEqual(q.receive_pending(self.root, different)["rejected"], 1)

    def test_existing_conflicting_receipt_never_overwritten(self):
        q.enqueue(self.root, self.job, self.policy)
        folder = self.root / "sac-jobs"
        folder.mkdir()
        p = folder / (self.job["job_id"] + ".json")
        p.write_text('{"status":"tampered"}')
        self.assertEqual(q.receive_pending(self.root, self.policy)["rejected"], 1)
        self.assertEqual(p.read_text(), '{"status":"tampered"}')

    def test_invalid_policy_duplicate_or_unbounded(self):
        with self.assertRaises(ValueError):
            q.validate_policy({"schema_version": 1, "projects": self.policy["projects"] * 2})
        with self.assertRaises(ValueError):
            q.validate_policy({"schema_version": 1, "projects": [{"project_id": "x", "profile_id": "x", "shell": "id"}]})
        with self.assertRaises(ValueError):
            q.receive_pending(self.root, self.policy, limit=1000)

    def test_no_inbox_returns_no_work(self):
        self.assertEqual(q.receive_pending(self.root, self.policy)["received"], 0)

if __name__ == "__main__":
    unittest.main()
