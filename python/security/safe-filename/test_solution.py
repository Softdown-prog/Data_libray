import unittest

from solution import validate_filename


class TestFilename(unittest.TestCase):
    def test_valid(self) -> None:
        self.assertEqual(validate_filename("relatorio-2026.json"), "relatorio-2026.json")

    def test_invalid(self) -> None:
        for value in ("../secrets", "..", "", "folder/file", "folder\\file", "a" * 65):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_filename(value)


if __name__ == "__main__":
    unittest.main()
