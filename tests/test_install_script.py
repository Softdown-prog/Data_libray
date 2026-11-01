"""O instalador deve usar a identidade proprietária do repositório Git da VPS."""
from pathlib import Path
import unittest


INSTALLER = Path(__file__).resolve().parents[1] / "deploy" / "install-vps-worker.sh"


class InstallerGitOwnershipTests(unittest.TestCase):
    def test_origin_is_checked_under_data_library_identity(self) -> None:
        script = INSTALLER.read_text(encoding="utf-8")
        self.assertIn(
            'installed_origin="$(runuser -u data-library -- env "HOME=$base" '
            'git -C "$repo" remote get-url origin)"',
            script,
        )

    def test_does_not_disable_git_safe_directory(self) -> None:
        script = INSTALLER.read_text(encoding="utf-8")
        self.assertNotIn("git config --global --add safe.directory", script)
        self.assertNotIn("safe.directory '*'", script)

    def test_clone_and_dependencies_run_as_unprivileged_user(self) -> None:
        script = INSTALLER.read_text(encoding="utf-8")
        self.assertIn("runuser -u data-library -- git clone", script)
        self.assertIn("runuser -u data-library -- env", script)


if __name__ == "__main__":
    unittest.main()
