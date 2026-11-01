"""Garante a seleção dos oito parsers e que Python AST não executa código."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.parser_audit import LANGUAGES, annotation_escape, checks_for, parse_python


class ParserAuditTests(unittest.TestCase):
    def test_all_languages_have_checks(self) -> None:
        for language in LANGUAGES:
            with self.subTest(language=language):
                checks = checks_for(language)
                self.assertTrue(checks)
                self.assertTrue(all(check.tool and check.label for check in checks))
        self.assertEqual(len(LANGUAGES), 8)

    def test_ast_does_not_execute_python(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "unexpected.txt"
            source = root / "valid.py"
            source.write_text(
                "from pathlib import Path\n"
                f"Path({str(marker)!r}).write_text('executed')\n",
                encoding="utf-8",
            )
            passed, diagnostic, line = parse_python(source)
            self.assertTrue(passed)
            self.assertFalse(diagnostic)
            self.assertIsNone(line)
            self.assertFalse(marker.exists())

    def test_syntax_error_has_line_number(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "bad.py"
            source.write_text("x = 1\nif True print('bad')\n", encoding="utf-8")
            passed, diagnostic, line = parse_python(source)
            self.assertFalse(passed)
            self.assertTrue(diagnostic)
            self.assertEqual(line, 2)

    def test_unknown_language_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            checks_for("php")

    def test_annotation_escaping(self) -> None:
        self.assertEqual(annotation_escape("a%b\nc\r"), "a%25b%0Ac%0D")


if __name__ == "__main__":
    unittest.main()
