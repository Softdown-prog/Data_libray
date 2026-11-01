import tempfile
import unittest
from pathlib import Path

from solution import atomic_write


class TestAtomicWrite(unittest.TestCase):
    def test_create_replace_utf8(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "data.txt"
            atomic_write(path, "primeiro")
            atomic_write(path, "olá, mundo")
            self.assertEqual(path.read_text(encoding="utf-8"), "olá, mundo")
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["data.txt"])


if __name__ == "__main__":
    unittest.main()
