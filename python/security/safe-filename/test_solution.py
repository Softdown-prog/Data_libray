"""Testes de política de nome para python.security.safe-filename."""

import unittest

from solution import validate_filename


class TestFilename(unittest.TestCase):
    def test_valid_ascii_names(self) -> None:
        values = (
            "a",
            "relatorio-2026.json",
            "file_name_1",
            "report.v2.final",
            "a" * 64,
            "COM10.txt",
            "auxiliary.csv",
        )
        for value in values:
            with self.subTest(value=value):
                self.assertEqual(validate_filename(value), value)

    def test_rejects_paths_and_nonportable_names(self) -> None:
        invalid = (
            "",
            ".",
            "..",
            ".hidden",
            "../secrets",
            "folder/file",
            r"folder\\file",
            "report.",
            "report..",
            "a" * 65,
            "two words.txt",
            "café.txt",
            "file:name",
            "file\nname",
            "file\x00name",
        )
        for value in invalid:
            with self.subTest(value=repr(value)), self.assertRaises(ValueError):
                validate_filename(value)

    def test_windows_reserved_device_names(self) -> None:
        reserved = (
            "CON", "con.txt", "con.file.txt",
            "PRN", "AUX.txt", "nul.JSON",
            "COM1", "com9.dat", "LPT1", "lpt9.log",
        )
        for value in reserved:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "reservado"):
                validate_filename(value)

    def test_invalid_types_raise_type_error(self) -> None:
        for value in (None, 123, b"file.txt", ["report.txt"], True):
            with self.subTest(value=value), self.assertRaises(TypeError):
                validate_filename(value)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
