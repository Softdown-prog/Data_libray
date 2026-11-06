// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "css",
  "family": "standard",
  "required_packages": [],
  "required_files": [],
  "extensions": [
    ".css"
  ],
  "gates": [
    {
      "id": "css-syntax-0",
      "tool": "stylelint",
      "phase": "syntax"
    },
    {
      "id": "css-browser-1",
      "tool": "playwright",
      "phase": "browser"
    }
  ]
});
