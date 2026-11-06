// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "html5",
  "family": "standard",
  "required_packages": [],
  "required_files": [],
  "extensions": [
    ".html",
    ".htm"
  ],
  "gates": [
    {
      "id": "html5-syntax-0",
      "tool": "html-validate",
      "phase": "syntax"
    },
    {
      "id": "html5-browser-1",
      "tool": "playwright",
      "phase": "browser"
    }
  ]
});
