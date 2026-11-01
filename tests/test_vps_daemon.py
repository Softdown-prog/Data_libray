"""Supervisor VPS: processamento, retomada e ausência de loop redundante."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import vps_daemon


class TestVpsDaemon(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = {"examples": []}
        self.config = vps_daemon.Settings(recheck_seconds=3600)

    def test_process_idle_then_recheck(self) -> None:
        with tempfile.TemporaryDirectory() as folder, patch.object(
            vps_daemon.batch_worker, "run_batch",
            return_value={"counts": {"pass": 2, "fail": 0}, "total_queued": 2},
        ) as worker:
            state = Path(folder)
            first = vps_daemon.run_cycle(catalog=self.catalog, revision="a" * 40,
                                          config=self.config, state_dir=state, now=100)
            idle = vps_daemon.run_cycle(catalog=self.catalog, revision="a" * 40,
                                         config=self.config, state_dir=state, now=200)
            later = vps_daemon.run_cycle(catalog=self.catalog, revision="a" * 40,
                                          config=self.config, state_dir=state, now=3800)
            self.assertEqual((first["action"], idle["action"], later["action"]),
                             ("processed", "idle", "processed"))
            self.assertEqual(worker.call_count, 2)

    def test_resume_and_new_revision(self) -> None:
        with tempfile.TemporaryDirectory() as folder, patch.object(
            vps_daemon.batch_worker, "run_batch",
            return_value={"counts": {"pass": 1, "fail": 0}, "total_queued": 1},
        ) as worker:
            state = Path(folder)
            sha = "a" * 40
            sig = vps_daemon.fingerprint(self.catalog, sha, self.config)
            run_id = "123-" + sig[:16]
            vps_daemon.batch_worker.write_json(state / "checkpoint.json", {
                "schema_version": 1, "signature": sig, "revision": sha, "run_id": run_id,
                "started_at": 123, "finished_at": None, "counts": None,
            })
            vps_daemon.batch_worker.write_json(state / "runs" / run_id / "queue.json",
                                               {"tasks": []})
            vps_daemon.run_cycle(catalog=self.catalog, revision=sha, config=self.config,
                                 state_dir=state, now=200)
            self.assertTrue(worker.call_args.kwargs["resume"])
            vps_daemon.run_cycle(catalog=self.catalog, revision="b" * 40,
                                 config=self.config, state_dir=state, now=201)
            self.assertFalse(worker.call_args.kwargs["resume"])
            self.assertEqual(worker.call_count, 2)

    def test_reject_corrupt_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "checkpoint.json").write_text('{"schema_version":0}', encoding="utf-8")
            with self.assertRaises(ValueError):
                vps_daemon.run_cycle(catalog=self.catalog, revision="a" * 40,
                                     config=self.config, state_dir=root, now=200)


if __name__ == "__main__":
    unittest.main()
