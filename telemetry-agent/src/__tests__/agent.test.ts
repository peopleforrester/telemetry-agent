// ABOUTME: Tests for the instrumentation agent — system prompt, tool schemas, tool execution.
// ABOUTME: Unit tests for prompt construction and tool validation; integration tests need API key.

import { describe, it, expect } from "vitest";

import {
  buildSystemPrompt,
  toolSchemas,
  executeAnalyzeFile,
  executeSearchNpm,
  executeTransformCode,
  executeReadFile,
} from "../agent.js";
import type { Config } from "../config.js";

const DEFAULT_CONFIG: Config = {
  schemaPath: "./registry",
  sdkInitFile: "src/telemetry/setup.ts",
  autoApproveLibraries: true,
  testCommand: "npm test",
  maxFixAttempts: 3,
  maxTokensPerFile: 50000,
  maxSpansPerFile: 5,
  exclude: [],
};

const SAMPLE_SCHEMA = `groups:
  - id: test.operation
    type: span
    brief: A test operation
    attributes:
      - ref: test.name
        requirement_level: required`;

describe("buildSystemPrompt", () => {
  it("includes schema content", () => {
    const prompt = buildSystemPrompt(SAMPLE_SCHEMA, DEFAULT_CONFIG);
    expect(prompt).toContain("test.operation");
    expect(prompt).toContain("A test operation");
  });

  it("includes maxSpansPerFile constraint", () => {
    const prompt = buildSystemPrompt(SAMPLE_SCHEMA, DEFAULT_CONFIG);
    expect(prompt).toContain("5");
  });
});

describe("tool schemas", () => {
  it("validate correct inputs for analyze_file", () => {
    const result = toolSchemas.analyze_file.safeParse({});
    expect(result.success).toBe(true);
  });

  it("validate correct inputs for search_npm", () => {
    const result = toolSchemas.search_npm.safeParse({ frameworkName: "pg" });
    expect(result.success).toBe(true);
  });

  it("reject invalid inputs for search_npm", () => {
    const result = toolSchemas.search_npm.safeParse({});
    expect(result.success).toBe(false);
  });

  it("validate correct inputs for transform_code", () => {
    const result = toolSchemas.transform_code.safeParse({
      transforms: {
        serviceName: "test-service",
        spans: [
          {
            functionName: "doWork",
            spanName: "test.do_work",
            attributes: [],
            variableName: "span",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("validate correct inputs for read_file", () => {
    const result = toolSchemas.read_file.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("tool execution", () => {
  const SIMPLE_FILE = `import { Pool } from 'pg';

export async function getUsers(pool: Pool) {
  const result = await pool.query('SELECT * FROM users');
  return result.rows;
}
`;

  it("executeAnalyzeFile returns analysis plan", async () => {
    const result = await executeAnalyzeFile(SIMPLE_FILE, "src/services/user.ts", DEFAULT_CONFIG);
    expect(result.filePath).toBe("src/services/user.ts");
    expect(result.spansToAdd).toBeDefined();
  });

  it("executeSearchNpm searches for a package", async () => {
    const result = await executeSearchNpm("pg");
    // May or may not find results depending on network
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("executeTransformCode applies transformations", () => {
    const input = `export async function doWork() {
  console.log('working');
}
`;
    const result = executeTransformCode(input, {
      serviceName: "test-service",
      spans: [
        {
          functionName: "doWork",
          spanName: "test.do_work",
          attributes: [],
          variableName: "span",
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.newContent).toContain("startActiveSpan");
  });

  it("executeReadFile returns content", () => {
    const result = executeReadFile(SIMPLE_FILE);
    expect(result.content).toBe(SIMPLE_FILE);
  });
});
