// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "astro",
  "family": "framework",
  "required_packages": [
    "astro"
  ],
  "required_files": [
    "package.json"
  ],
  "extensions": [
    ".astro",
    ".ts",
    ".tsx",
    ".js"
  ],
  "gates": [
    {
      "id": "astro-typecheck-0",
      "tool": "astro",
      "phase": "typecheck"
    },
    {
      "id": "astro-build-1",
      "tool": "astro",
      "phase": "build"
    },
    {
      "id": "astro-browser-2",
      "tool": "playwright",
      "phase": "browser"
    }
  ]
});
