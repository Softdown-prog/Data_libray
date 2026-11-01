"""Contrato mínimo para mineração reproduzível de incidentes Angular."""
import copy
import json
import unittest

from scripts.validate_angular_incidents import DEFAULT, validate


class AngularIncidentCorpusTests(unittest.TestCase):
    def setUp(self):
        self.original = json.loads(DEFAULT.read_text(encoding="utf-8"))

    def test_corpus_has_valid_structured_evidence(self):
        self.assertGreaterEqual(validate(self.original), 8)

    def test_rejects_duplicated_ids(self):
        data = copy.deepcopy(self.original)
        data["incidents"].append(copy.deepcopy(data["incidents"][0]))
        with self.assertRaisesRegex(ValueError, "duplicado"):
            validate(data)

    def test_conversation_is_not_automatically_certified_as_reproduced(self):
        data = copy.deepcopy(self.original)
        item = next(c for c in data["incidents"] if c["evidence_level"] == "conversation_report")
        item["reproduction"] = "existing_browser_suite"
        with self.assertRaisesRegex(ValueError, "relato sem prova"):
            validate(data)

    def test_rejects_external_or_tokenized_evidence_urls(self):
        for url in ["https://evil.example/case", "https://github.com/Softdown-prog/Painel?token=x"]:
            with self.subTest(url=url):
                data = copy.deepcopy(self.original)
                data["incidents"][0]["sources"][0] = url
                with self.assertRaisesRegex(ValueError, "evidência|tokens"):
                    validate(data)


if __name__ == "__main__":
    unittest.main()
