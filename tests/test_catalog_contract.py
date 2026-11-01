"""Testes que garantem a disciplina do catálogo de código."""
import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from scripts.catalog import ROOT, build, source_files, validate_current, validate_root_layout

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

    def test_root_layout_rejects_uncataloged_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            validate_root_layout(folder)
            (folder / "H").write_text("n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "raiz sem registro"):
                validate_root_layout(folder)

    def test_generated_directories_are_not_catalogued_as_source(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root) / "angular"
            (folder / "node_modules" / "gensync").mkdir(parents=True)
            (folder / "node_modules" / "gensync" / "index.js").write_text("generated")
            (folder / ".angular" / "cache").mkdir(parents=True)
            (folder / ".angular" / "cache" / "output.js").write_text("generated")
            (folder / "dist").mkdir()
            (folder / "dist" / "output.js").write_text("generated")
            (folder / "web" / "actual").mkdir(parents=True)
            actual = folder / "web" / "actual" / "main.ts"
            actual.write_text("export const value = 1;", encoding="utf-8")
            self.assertEqual(source_files(folder), [actual])

    def test_regular_uncatalogued_sources_are_still_discovered(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root) / "angular"
            (folder / "web" / "untracked").mkdir(parents=True)
            source = folder / "web" / "untracked" / "main.ts"
            source.write_text("export const x = 42;", encoding="utf-8")
            self.assertIn(source, source_files(folder))

    def test_index_tracks_review_status(self) -> None:
        index = build()
        self.assertEqual(index["count"], len(index["examples"]))
        self.assertGreaterEqual(index["documented_count"], 4)
        frozen = json.loads((ROOT / "docs" / "LEGACY_REVIEW.json").read_text(encoding="utf-8"))
        self.assertEqual(index["pending_review_count"], len(frozen["examples"]))
        migrated = [entry for entry in index["examples"]
                    if entry["id"] == "python.security.safe-filename"]
        self.assertEqual(migrated[0]["catalog_status"], "documented")
        migrated_redirect = [entry for entry in index["examples"]
                             if entry["id"] == "javascript.security.safe-redirect"]
        self.assertEqual(migrated_redirect[0]["catalog_status"], "documented")
        self.assertEqual(index["documented_count"] + index["pending_review_count"], index["count"])


if __name__ == "__main__":
    unittest.main()
