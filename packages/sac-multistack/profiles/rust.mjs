// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "rust",
  "family": "language",
  "required_packages": [],
  "required_files": [
    "Cargo.toml"
  ],
  "extensions": [
    ".rs"
  ],
  "gates": [
    {
      "id": "rust-typecheck-0",
      "tool": "cargo",
      "phase": "typecheck"
    },
    {
      "id": "rust-lint-1",
      "tool": "cargo-clippy",
      "phase": "lint"
    },
    {
      "id": "rust-test-2",
      "tool": "cargo",
      "phase": "test"
    }
  ]
});
