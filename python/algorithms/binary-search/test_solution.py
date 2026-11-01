import unittest

from solution import first_index


class TestFirstIndex(unittest.TestCase):
    def test_empty(self) -> None:
        self.assertEqual(first_index([], 1), -1)

    def test_duplicates(self) -> None:
        self.assertEqual(first_index([1, 2, 2, 2, 4], 2), 1)

    def test_missing(self) -> None:
        self.assertEqual(first_index([1, 3, 5], 4), -1)


if __name__ == "__main__":
    unittest.main()
