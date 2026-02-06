// ABOUTME: Tests for PR creation — manifest building and markdown description generation.
// ABOUTME: Validates summary stats, table formatting, and edge cases like all failures.

import { describe, it, expect } from "vitest";

import { buildResultManifest, buildPrDescription } from "../pr.js";
import type { FileResult } from "../results.js";
import type { EndOfRunResult } from "../coordinator.js";

const SUCCESS_RESULT: FileResult = {
  path: "src/services/user.ts",
  status: "success",
  spans_added: 2,
  libraries_needed: [
    { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
  ],
  schema_extensions: ["registry.get_users"],
  attributes_created: 1,
  validation_retries: 0,
};

const FAILURE_RESULT: FileResult = {
  path: "src/services/order.ts",
  status: "failed",
  reason: "Agent failed to instrument",
};

const END_OF_RUN: EndOfRunResult = {
  testsRan: true,
  testsPassed: true,
  testOutput: "All tests passed",
  skipped: false,
  skipReason: null,
};

describe("buildResultManifest", () => {
  it("produces valid JSON", () => {
    const manifest = buildResultManifest([SUCCESS_RESULT, FAILURE_RESULT], END_OF_RUN);
    const parsed = JSON.parse(manifest);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.endOfRun).toBeDefined();
  });
});

describe("buildPrDescription", () => {
  it("generates markdown table", () => {
    const description = buildPrDescription([SUCCESS_RESULT, FAILURE_RESULT], END_OF_RUN);
    expect(description).toContain("| File |");
    expect(description).toContain("user.ts");
    expect(description).toContain("order.ts");
  });

  it("includes summary stats", () => {
    const description = buildPrDescription([SUCCESS_RESULT, FAILURE_RESULT], END_OF_RUN);
    expect(description).toContain("1 succeeded");
    expect(description).toContain("1 failed");
  });

  it("handles all-failure case", () => {
    const description = buildPrDescription([FAILURE_RESULT], null);
    expect(description).toContain("0 succeeded");
    expect(description).toContain("1 failed");
  });

  it("includes test results when available", () => {
    const description = buildPrDescription([SUCCESS_RESULT], END_OF_RUN);
    expect(description).toContain("Tests");
    expect(description).toContain("passed");
  });
});
