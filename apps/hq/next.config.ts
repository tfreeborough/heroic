import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source, not builds — Next compiles
  // them in. The sim pulls core + achievements along.
  transpilePackages: [
    "@heroic/blood-in-the-sand-persistence",
    "@heroic/blood-in-the-sand-sim",
    "@heroic/achievements",
    "@heroic/core",
  ],
  // libsql carries a native binding — it must be required at runtime, never
  // bundled.
  serverExternalPackages: ["@libsql/client"],
};

export default config;
