// ABOUTME: Vitest configuration for telemetry-agent test suite.
// ABOUTME: Configures TypeScript-native test runner with src/__tests__/ as test root.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globals: false,
  },
});
