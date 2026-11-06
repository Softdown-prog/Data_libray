// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "javascript",
  "family": "language",
  "required_packages": [],
  "required_files": [],
  "extensions": [
    ".js",
    ".cjs",
    ".mjs",
    ".jsx"
  ],
  "gates": [
    {
      "id": "javascript-syntax-0",
      "tool": "node",
      "phase": "syntax"
    },
    {
      "id": "javascript-test-1",
      "tool": "node",
      "phase": "test"
    }
  ]
});
