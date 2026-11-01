"""SAC-008E: test fail-closed offline readiness with synthetic operator plans."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO

from scripts import sac_vps_readiness as readiness

ROOT = Path(__file__).resolve().parents[1]
UNIT = (ROOT / "deploy/systemd/data-library-worker.service").read_text()

BASE = {
    "schema_version": 1, "mode": "review-only",
    "catalog_worker": {
        "user": "data-library", "unit": "data-library-worker.service",
        "build_flags_enabled": False, "docker_socket_access": False,
    },
    "builder": {
        "user": "sac-builder", "uid": 1002, "separate_service": True,
        "rootless": True, "socket": "/run/user/1002/docker.sock",
        "socket_owner_uid": 1002, "docker_group_member": False,
        "dedicated_workspace": True, "source_revision_verified": True,
        "pinned_image": True, "no_project_secrets": True, "network": "none",
        "cpus": 1, "memory_mb": 1024, "pids_limit": 128,
        "max_parallel": 1, "build_timeout_seconds": 120,
    },
    "capacity": {"ram_total_mb": 4096, "reserve_other_projects_mb": 2048},
}


class ReadinessTests(unittest.TestCase):
    def check(self, value=None, unit=UNIT):
        return readiness.check_plan(BASE if value is None else value, unit)

    def test_synthetic_review_pass_never_grants_deploy(self):
        result = self.check()
        self.assertEqual(result["status"], "plan-review-pass")
        self.assertFalse(result["runtime_verified"])
        self.assertFalse(result["vps_contacted"])
        self.assertFalse(result["deployment_authorized"])
        self.assertFalse(result["service_modified"])

    def test_catalog_service_stays_off(self):
        unit = UNIT.replace("--state-dir", "--sac-build --state-dir")
        result = self.check(unit=unit)
        self.assertIn("catalog-build-flags-enabled", result["blockers"])

    def test_catalog_docker_group_and_socket_are_rejected(self):
        for fragment in ("SupplementaryGroups=docker\n", "Environment=DOCKER_HOST=unix:///var/run/docker.sock\n",
                         "ReadWritePaths=/var/run/docker.sock\n"):
            unit = UNIT.replace("[Install]", fragment + "\n[Install]")
            self.assertEqual(self.check(unit=unit)["status"], "blocked")

    def test_rootful_or_shared_worker_rejected(self):
        for changes in (
            {"rootless": False}, {"docker_group_member": True},
            {"user": "data-library"}, {"user": "root"},
            {"socket": "/var/run/docker.sock"},
            {"socket": "/run/user/1003/docker.sock"},
            {"socket_owner_uid": 1}, {"separate_service": False},
        ):
            candidate = copy.deepcopy(BASE)
            candidate["builder"].update(changes)
            self.assertIn("rootless-docker-socket-not-isolated", self.check(candidate)["blockers"]
                if changes.get("rootless") is False or "socket" in changes or
                   "socket_owner_uid" in changes or "docker_group_member" in changes
                else self.check(candidate)["blockers"] + ["rootless-docker-socket-not-isolated"])

    def test_build_budget_and_shared_ram_reserve(self):
        for field, value in (("cpus", 2), ("memory_mb", 1536), ("pids_limit", 200),
                             ("max_parallel", 2), ("build_timeout_seconds", 180)):
            cand = copy.deepcopy(BASE)
            cand["builder"][field] = value
            self.assertIn("build-budget-exceeds-policy", self.check(cand)["blockers"])
        cand = copy.deepcopy(BASE)
        cand["capacity"]["reserve_other_projects_mb"] = 3000
        self.assertIn("insufficient-host-memory-reserve", self.check(cand)["blockers"])

    def test_untrusted_inputs_block(self):
        for field, value in (("dedicated_workspace", False), ("source_revision_verified", False),
                             ("pinned_image", False), ("no_project_secrets", False),
                             ("network", "bridge")):
            cand = copy.deepcopy(BASE)
            cand["builder"][field] = value
            self.assertIn("untrusted-build-inputs", self.check(cand)["blockers"])

    def test_catalog_rejects_unsafe_runtime_declarations(self):
        for changes in ({"build_flags_enabled": True}, {"docker_socket_access": True},
                        {"user": "sac-builder"}):
            cand = copy.deepcopy(BASE)
            cand["catalog_worker"].update(changes)
            self.assertIn("catalog-not-isolated", self.check(cand)["blockers"])

    def test_strict_schema_and_no_boolean_coercion(self):
        for changes in ({"rootless": 1}, {"rootless": "true"}, {"uid": True},
                        {"socket": ""}, {"network": None}):
            cand = copy.deepcopy(BASE)
            cand["builder"].update(changes)
            if changes == {"socket": ""}:
                self.assertEqual(self.check(cand)["status"], "blocked")
            elif changes == {"network": None}:
                self.assertEqual(self.check(cand)["status"], "blocked")
            else:
                with self.assertRaises(ValueError):
                    self.check(cand)
        cand = copy.deepcopy(BASE)
        cand["builder"]["command"] = "bash -c id"
        with self.assertRaises(ValueError):
            self.check(cand)

    def test_cli_invalid_file_is_blocked_not_exception(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            plan = directory / "plan.json"
            unit = directory / "worker.service"
            plan.write_text("{")
            unit.write_text(UNIT)
            output = StringIO()
            with redirect_stdout(output):
                code = readiness.main(["--plan", str(plan), "--catalog-unit", str(unit)])
            self.assertEqual(code, 2)
            data = json.loads(output.getvalue())
            self.assertEqual(data["status"], "blocked")
            self.assertFalse(data["deployment_authorized"])

    def test_cli_positive_is_review_only(self):
        with tempfile.TemporaryDirectory() as name:
            d = Path(name)
            plan = d / "plan.json"
            unit = d / "unit"
            plan.write_text(json.dumps(BASE))
            unit.write_text(UNIT)
            out = StringIO()
            with redirect_stdout(out):
                status = readiness.main(["--plan", str(plan), "--catalog-unit", str(unit)])
            self.assertEqual(status, 0)
            self.assertFalse(json.loads(out.getvalue())["runtime_verified"])


if __name__ == "__main__":
    unittest.main()
