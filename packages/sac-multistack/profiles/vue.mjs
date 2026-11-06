// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "vue",
  "family": "framework",
  "required_packages": [
    "vue"
  ],
  "required_files": [
    "package.json"
  ],
  "extensions": [
    ".vue",
    ".ts",
    ".tsx",
    ".js"
  ],
  "gates": [
    {
      "id": "vue-typecheck-0",
      "tool": "vue-tsc",
      "phase": "typecheck"
    },
    {
      "id": "vue-build-1",
      "tool": "vite",
      "phase": "build"
    },
    {
      "id": "vue-browser-2",
      "tool": "playwright",
      "phase": "browser"
    }
  ]
});
