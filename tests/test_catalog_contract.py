"""Testes que garantem a disciplina do catálogo de código."""
import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from scripts.catalog import ROOT, build, validate_current

EXAMPLE = ROOT / "go" / "algorithms" / "binary-search"


class TestDatasetContract(unittest.TestCase):
    def setUp(self) -> None:
        self.meta = json.loads((EXAMPLE / "example.json").read_text(encoding="utf-8"))
        self.readme = (EXAMPLE / "README.md").read_text(encoding="utf-8")

    def test_pilot_is_complete(self) -> None:
        validate_current(self.meta, EXAMPLE, self.readme)

    def test_missing_spec_field_is_rejected(self) -> None:
        broken = copy.deepcopy(self.meta)
        del broken["spec"]["error_handling"]
        with self.assertRaises(ValueError):
            validate_current(broken, EXAMPLE, self.readme)

    def test_missing_documentation_section_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            validate_current(self.meta, EXAMPLE, self.readme.replace("## Quando não usar", ""))

    def test_untracked_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            copy = Path(root) / "example"
            shutil.copytree(EXAMPLE, copy)
            (copy / "uncataloged.go").write_text("package binarysearch", encoding="utf-8")
            with self.assertRaises(ValueError):
                validate_current(self.meta, copy, self.readme)

    def test_index_tracks_review_status(self) -> None:
        index = build()
        self.assertEqual(index["count"], len(index["examples"]))
        self.assertGreaterEqual(index["documented_count"], 4)
        self.assertEqual(index["pending_review_count"], 17)
        self.assertEqual(index["documented_count"] + index["pending_review_count"], index["count"])


if __name__ == "__main__":
    unittest.main()
