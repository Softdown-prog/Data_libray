// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "python",
  "family": "language",
  "required_packages": [],
  "required_files": [],
  "extensions": [
    ".py"
  ],
  "gates": [
    {
      "id": "python-syntax-0",
      "tool": "python3",
      "phase": "syntax"
    },
    {
      "id": "python-test-1",
      "tool": "pytest",
      "phase": "test"
    }
  ]
});
