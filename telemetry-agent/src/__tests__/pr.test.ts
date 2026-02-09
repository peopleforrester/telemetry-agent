// ABOUTME: Tests for PR creation — manifest building and markdown description generation.
// ABOUTME: Validates summary stats, table formatting, and edge cases like all failures.

import { describe, it, expect } from "vitest";

import {
  buildResultManifest,
  buildPrDescription,
  type TokenUsageSummary,
  type SpanDensityInfo,
} from "../pr.js";
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

  it("renders token usage summary when provided", () => {
    const tokenUsage: TokenUsageSummary = {
      inputTokens: 15000,
      outputTokens: 3000,
      estimatedCost: 0.12,
    };
    const description = buildPrDescription([SUCCESS_RESULT], END_OF_RUN, {
      tokenUsage,
    });
    expect(description).toContain("Token Usage");
    expect(description).toContain("15000");
    expect(description).toContain("3000");
    expect(description).toContain("$0.12");
  });

  it("renders span density warning banner when exceeded", () => {
    const spanDensity: SpanDensityInfo = {
      spanDensityWarning: true,
      totalSpans: 75,
      maxSpansPerRun: 50,
    };
    const description = buildPrDescription([SUCCESS_RESULT], END_OF_RUN, {
      spanDensity,
    });
    expect(description).toContain("Span Density Warning");
    expect(description).toContain("75");
    expect(description).toContain("50");
  });

  it("does not render span density warning when within limit", () => {
    const spanDensity: SpanDensityInfo = {
      spanDensityWarning: false,
      totalSpans: 30,
      maxSpansPerRun: 50,
    };
    const description = buildPrDescription([SUCCESS_RESULT], END_OF_RUN, {
      spanDensity,
    });
    expect(description).not.toContain("Span Density Warning");
  });
});
