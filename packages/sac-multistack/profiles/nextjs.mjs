// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "nextjs",
  "family": "framework",
  "required_packages": [
    "next",
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
      "id": "nextjs-typecheck-0",
      "tool": "tsc",
      "phase": "typecheck"
    },
    {
      "id": "nextjs-build-1",
      "tool": "next",
      "phase": "build"
    },
    {
      "id": "nextjs-browser-2",
      "tool": "playwright",
      "phase": "browser"
    }
  ]
});
