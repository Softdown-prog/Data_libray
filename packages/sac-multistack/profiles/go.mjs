// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "go",
  "family": "language",
  "required_packages": [],
  "required_files": [
    "go.mod"
  ],
  "extensions": [
    ".go"
  ],
  "gates": [
    {
      "id": "go-syntax-0",
      "tool": "gofmt",
      "phase": "syntax"
    },
    {
      "id": "go-lint-1",
      "tool": "go",
      "phase": "lint"
    },
    {
      "id": "go-test-2",
      "tool": "go",
      "phase": "test"
    }
  ]
});
