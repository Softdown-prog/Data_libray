"""Static fail-closed guardrails for the dedicated Docker CI runner workflow."""
from pathlib import Path
import re
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/validate-library.yml"
JOBS = ("catalog", "go", "python", "cpp", "rust", "javascript",
        "typescript", "angular", "java")
RUNNER = "runs-on: [self-hosted, linux, x64, data-library-docker]"
OPTIONS = "options: --cpus=2 --memory=2g --pids-limit=256 --security-opt=no-new-privileges"


class TestDockerRunnerContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text(encoding="utf-8")
        cls.header, cls.jobs = cls.source.split("\njobs:\n", 1)

    def test_only_reviewed_main_push_or_manual_dispatch(self):
        self.assertIn('branches: [main]', self.header)
        self.assertIn("workflow_dispatch:", self.header)
        self.assertNotIn("pull_request:", self.header)
        self.assertNotIn("feat/**", self.header)
        self.assertNotIn("fix/**", self.header)

    def test_each_language_uses_dedicated_labeled_runner_and_docker(self):
        names = re.findall(r"(?m)^  ([a-z]+):$", self.jobs)
        self.assertCountEqual(names, JOBS)
        for index, name in enumerate(names):
            section = self.jobs.split(f"  {name}:\n", 1)[1]
            next_job = re.search(r"(?m)^  [a-z]+:$", section)
            if next_job:
                section = section[:next_job.start()]
            with self.subTest(job=name):
                self.assertIn(RUNNER, section)
                self.assertIn("container:\n", section)
                self.assertRegex(section, r"(?m)^      image: [a-z]")
                self.assertIn(OPTIONS, section)
                self.assertIn("actions/checkout@", section)

    def test_no_privileged_docker_socket_or_docker_group(self):
        self.assertNotIn("/var/run/docker.sock", self.jobs)
        self.assertNotIn("--privileged", self.jobs)
        self.assertNotIn("--group-add docker", self.jobs)
        self.assertNotIn("docker://", self.jobs)


if __name__ == "__main__":
    unittest.main()
