// ABOUTME: Tests for the result file module — Zod schemas, file I/O, aggregation.
// ABOUTME: Covers parsing, write/read roundtrips, collection, dedup, and summarization.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import {
  SuccessResultSchema,
  FailureResultSchema,
  FileResultSchema,
  writeResult,
  readResult,
  collectResults,
  aggregateLibraries,
  summarizeResults,
  type FileResult,
  type LibraryRequirement,
} from "../results.js";

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `results-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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
});

describe("writeResult / readResult", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writeResult creates file with correct name", () => {
    const result: FileResult = {
      path: "src/services/user.ts",
      status: "success",
      spans_added: 1,
      libraries_needed: [],
      schema_extensions: [],
      attributes_created: 0,
      validation_retries: 0,
    };

    const written = writeResult(tempDir, result);
    expect(fs.existsSync(written)).toBe(true);
    // src/services/user.ts -> src__services__user.json
    expect(path.basename(written)).toBe("src__services__user.json");
  });

  it("readResult reads back what writeResult wrote", () => {
    const result: FileResult = {
      path: "src/services/order.ts",
      status: "success",
      spans_added: 3,
      libraries_needed: [
        { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
      ],
      schema_extensions: ["myapp.order.create"],
      attributes_created: 2,
      validation_retries: 1,
    };

    const written = writeResult(tempDir, result);
    const loaded = readResult(written);

    expect(loaded).toEqual(result);
  });
});

describe("collectResults", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds all JSON files in directory", () => {
    const results: FileResult[] = [
      {
        path: "src/a.ts",
        status: "success",
        spans_added: 1,
        libraries_needed: [],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      },
      {
        path: "src/b.ts",
        status: "failed",
        reason: "syntax error",
      },
    ];

    for (const r of results) {
      writeResult(tempDir, r);
    }

    const collected = collectResults(tempDir);
    expect(collected).toHaveLength(2);
    // Should be sorted by path
    expect(collected[0].path).toBe("src/a.ts");
    expect(collected[1].path).toBe("src/b.ts");
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
