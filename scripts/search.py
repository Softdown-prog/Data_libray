"""Busca determinística no catálogo; não exige rede ou serviços externos."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("terms", nargs="*")
    parser.add_argument("--language")
    parser.add_argument("--category")
    args = parser.parse_args()
    data = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    results = []
    for example in data["examples"]:
        if args.language and example["language"] != args.language:
            continue
        if args.category and example["category"] != args.category:
            continue
        haystack = " ".join(
            [example["id"], example["title"], example["description"], *example["tags"]]
        ).lower()
        if all(term.lower() in haystack for term in args.terms):
            results.append(example)
    for item in results:
        print(f'{item["id"]}: {item["title"]} — {item["path"]}')
    print(f"{len(results)} resultado(s)")


if __name__ == "__main__":
    main()
