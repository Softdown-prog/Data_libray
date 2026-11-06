// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "cpp20",
  "family": "language",
  "required_packages": [],
  "required_files": [],
  "extensions": [
    ".cpp",
    ".cc",
    ".cxx"
  ],
  "gates": [
    {
      "id": "cpp20-syntax-0",
      "tool": "g++",
      "phase": "syntax"
    },
    {
      "id": "cpp20-test-1",
      "tool": "g++",
      "phase": "test"
    }
  ]
});
