// ABOUTME: Tests for the result module — Zod schemas, aggregation, summarization.
// ABOUTME: Covers parsing, schema unification, dedup, and summarization.

import { describe, it, expect } from "vitest";

import {
  SuccessResultSchema,
  FailureResultSchema,
  FileResultSchema,
  aggregateLibraries,
  summarizeResults,
  type FileResult,
} from "../results.js";

describe("Result Schemas", () => {
  it("SuccessResult validates correctly", () => {
    const input = {
      path: "src/services/user.ts",
      status: "success",
      spans_added: 2,
      libraries_needed: [
        { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation" },
      ],
      schema_extensions: ["myapp.user.create"],
      attributes_created: 1,
      validation_retries: 0,
    };

    const result = SuccessResultSchema.parse(input);
    expect(result.status).toBe("success");
    expect(result.spans_added).toBe(2);
    expect(result.libraries_needed).toHaveLength(1);
    expect(result.libraries_needed[0].package).toBe("@opentelemetry/instrumentation-pg");
  });

  it("FailureResult validates correctly", () => {
    const input = {
      path: "src/services/broken.ts",
      status: "failed",
      reason: "Syntax error after transformation",
      last_error: "Unexpected token at line 42",
    };

    const result = FailureResultSchema.parse(input);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("Syntax error after transformation");
    expect(result.last_error).toBe("Unexpected token at line 42");
  });

  it("invalid status value rejected", () => {
    const input = {
      path: "src/foo.ts",
      status: "unknown",
    };

    expect(() => FileResultSchema.parse(input)).toThrow();
  });

  it("FailureResult includes all fields with defaults", () => {
    const input = {
      path: "src/services/broken.ts",
      status: "failed",
      reason: "Syntax error",
    };

    const result = FailureResultSchema.parse(input);
    expect(result.spans_added).toBe(0);
    expect(result.libraries_needed).toEqual([]);
    expect(result.schema_extensions).toEqual([]);
    expect(result.attributes_created).toBe(0);
    expect(result.validation_retries).toBe(0);
  });

  it("FailureResult accepts explicit zeros for unified fields", () => {
    const input = {
      path: "src/services/broken.ts",
      status: "failed",
      reason: "Syntax error",
      spans_added: 0,
      libraries_needed: [],
      schema_extensions: [],
      attributes_created: 0,
      validation_retries: 0,
    };

    const result = FailureResultSchema.parse(input);
    expect(result.spans_added).toBe(0);
    expect(result.libraries_needed).toEqual([]);
  });
});

describe("aggregateLibraries", () => {
  it("deduplicates by package name", () => {
    const results: FileResult[] = [
      {
        path: "src/a.ts",
        status: "success",
        spans_added: 1,
        libraries_needed: [
          { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
        ],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      },
      {
        path: "src/b.ts",
        status: "success",
        spans_added: 1,
        libraries_needed: [
          { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
          {
            package: "@opentelemetry/instrumentation-express",
            import: "ExpressInstrumentation",
            config: {},
          },
        ],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      },
    ];

    const libs = aggregateLibraries(results);
    expect(libs).toHaveLength(2);
    const packages = libs.map((l) => l.package);
    expect(packages).toContain("@opentelemetry/instrumentation-pg");
    expect(packages).toContain("@opentelemetry/instrumentation-express");
  });

  it("ignores failed results", () => {
    const results: FileResult[] = [
      {
        path: "src/a.ts",
        status: "success",
        spans_added: 1,
        libraries_needed: [
          { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
        ],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      },
      {
        path: "src/b.ts",
        status: "failed",
        reason: "broke",
      },
    ];

    const libs = aggregateLibraries(results);
    expect(libs).toHaveLength(1);
    expect(libs[0].package).toBe("@opentelemetry/instrumentation-pg");
  });
});

describe("summarizeResults", () => {
  it("counts correctly with mixed success/failure", () => {
    const results: FileResult[] = [
      {
        path: "src/a.ts",
        status: "success",
        spans_added: 2,
        libraries_needed: [
          { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
        ],
        schema_extensions: [],
        attributes_created: 3,
        validation_retries: 0,
      },
      {
        path: "src/b.ts",
        status: "success",
        spans_added: 1,
        libraries_needed: [],
        schema_extensions: [],
        attributes_created: 1,
        validation_retries: 0,
      },
      {
        path: "src/c.ts",
        status: "failed",
        reason: "broke",
      },
    ];

    const summary = summarizeResults(results);
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.totalSpansAdded).toBe(3);
    expect(summary.totalAttributesCreated).toBe(4);
    expect(summary.librariesNeeded).toEqual(["@opentelemetry/instrumentation-pg"]);
  });
});
