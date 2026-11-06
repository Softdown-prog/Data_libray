// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "react",
  "family": "framework",
  "required_packages": [
    "react",
    "react-dom"
  ],
  "required_files": [
    "package.json"
  ],
  "extensions": [
    ".jsx",
    ".tsx",
    ".js",
    ".ts"
  ],
  "gates": [
    {
      "id": "react-typecheck-0",
      "tool": "tsc",
      "phase": "typecheck"
    },
    {
      "id": "react-build-1",
      "tool": "project-bundler",
      "phase": "build"
    },
    {
      "id": "react-browser-2",
      "tool": "playwright",
      "phase": "browser"
    }
  ]
});
