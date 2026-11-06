// SAC opt-in multistack profile; no commands from project manifests.
export default Object.freeze({
  "schema_version": 1,
  "id": "nestjs",
  "family": "framework",
  "required_packages": [
    "@nestjs/core",
    "@nestjs/common"
  ],
  "required_files": [
    "package.json"
  ],
  "extensions": [
    ".ts",
    ".js"
  ],
  "gates": [
    {
      "id": "nestjs-typecheck-0",
      "tool": "tsc",
      "phase": "typecheck"
    },
    {
      "id": "nestjs-build-1",
      "tool": "nest",
      "phase": "build"
    },
    {
      "id": "nestjs-integration-2",
      "tool": "supertest",
      "phase": "integration"
    }
  ]
});
