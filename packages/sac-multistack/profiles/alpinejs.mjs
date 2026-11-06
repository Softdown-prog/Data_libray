// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "alpinejs",
  "family": "framework",
  "required_packages": [
    "alpinejs"
  ],
  "required_files": [
    "package.json"
  ],
  "extensions": [
    ".html",
    ".htm",
    ".js",
    ".mjs"
  ],
  "gates": [
    {
      "id": "alpinejs-syntax-0",
      "tool": "html-validate",
      "phase": "syntax"
    },
    {
      "id": "alpinejs-browser-1",
      "tool": "playwright",
      "phase": "browser"
    }
  ]
});
