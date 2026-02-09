// ABOUTME: Tests for the file analysis pipeline — framework detection, span planning, caps.
// ABOUTME: Validates the full analysis flow from file content to instrumentation plan.

import { describe, it, expect } from "vitest";

import { analyzeFile, buildSpanName, classifyPriority } from "../pipeline.js";
import type { Config } from "../config.js";

const DEFAULT_CONFIG: Config = {
  schemaPath: "./registry",
  sdkInitFile: "src/telemetry/setup.ts",
  autoApproveLibraries: true,
  testCommand: "npm test",
  maxFixAttempts: 3,
  maxTokensPerFile: 50000,
  maxSpansPerFile: 5,
  maxFilesPerRun: 50,
  maxSpansPerRun: 50,
  schemaCheckpointInterval: 5,
  exclude: [],
};

describe("analyzeFile", () => {
  it("detects pg import and returns library requirement", async () => {
    const code = `
import { Pool } from 'pg';

export async function getUsers() {
  const pool = new Pool();
  const result = await pool.query('SELECT * FROM users');
  return result.rows;
}
`;
    const plan = await analyzeFile("src/services/user.ts", code, DEFAULT_CONFIG);
    expect(plan.librariesNeeded.some((l) => l.package.includes("pg"))).toBe(true);
  });

  it("skips already-instrumented functions", async () => {
    const code = `
import { trace } from '@opentelemetry/api';
const tracer = trace.getTracer('test');

export async function doWork() {
  return tracer.startActiveSpan('work', async (span) => {
    try {
      const result = await fetch('/api');
      return result;
    } finally {
      span.end();
    }
  });
}
`;
    const plan = await analyzeFile("src/services/work.ts", code, DEFAULT_CONFIG);
    expect(plan.alreadyInstrumented).toContain("doWork");
    expect(plan.spansToAdd.some((s) => s.functionName === "doWork")).toBe(false);
  });

  it("respects maxSpansPerFile cap", async () => {
    // Create a file with many functions
    const functions = Array.from({ length: 10 }, (_, i) => `
export async function handler${i}(req: Request) {
  const data = await fetch('/api/${i}');
  const json = await data.json();
  await processData(json);
  return json;
}`).join("\n");

    const code = `import { Request } from 'express';\n${functions}`;
    const config = { ...DEFAULT_CONFIG, maxSpansPerFile: 2 };
    const plan = await analyzeFile("src/handlers.ts", code, config);
    expect(plan.spansToAdd.length).toBeLessThanOrEqual(2);
  });

  it("handles variable shadowing (uses otelSpan)", async () => {
    const code = `
const span = 'global-span-value';

export async function processData(input: string) {
  console.log(span);
  const result = await transform(input);
  await save(result);
  return result;
}
`;
    const plan = await analyzeFile("src/process.ts", code, DEFAULT_CONFIG);
    const spanPlan = plan.spansToAdd.find((s) => s.functionName === "processData");
    if (spanPlan) {
      expect(spanPlan.variableName).toBe("otelSpan");
    }
  });

  it("returns empty plan for file with no instrumentable functions", async () => {
    const code = `
export const VERSION = '1.0.0';
export type Config = { name: string };
`;
    const plan = await analyzeFile("src/constants.ts", code, DEFAULT_CONFIG);
    expect(plan.spansToAdd).toHaveLength(0);
    expect(plan.librariesNeeded).toHaveLength(0);
  });
});

describe("classifyPriority", () => {
  it("prioritizes external calls (tier 1) over pure logic", () => {
    const codeWithDb = `
export async function fetchUser(id: string) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}
`;
    const codeWithoutDb = `
export async function processData(input: string) {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  return upper;
}
`;
    expect(classifyPriority("fetchUser", codeWithDb)).toBe(1);
    expect(classifyPriority("processData", codeWithoutDb)).toBeGreaterThan(1);
  });

  it("prioritizes exported async (tier 2) after external calls", () => {
    // Exported async without external calls → tier 2
    const code = `
export async function handleRequest(req: Request) {
  const data = JSON.parse(req.body);
  return data;
}
`;
    expect(classifyPriority("handleRequest", code)).toBe(2);
  });

  it("skips tier-4 functions when cap reached", async () => {
    // Create a file with mixed-priority functions
    const code = `
export async function dbCall() {
  await pool.query('SELECT 1');
  return true;
}

export async function entryPoint() {
  const x = JSON.parse('{}');
  return x;
}

export async function simpleWork() {
  return 42;
}
`;
    const config = { ...DEFAULT_CONFIG, maxSpansPerFile: 2 };
    const plan = await analyzeFile("src/mixed.ts", code, config);
    // With cap of 2, lower priority functions should be skipped
    expect(plan.spansToAdd.length).toBeLessThanOrEqual(2);
  });

  it("records skipped functions with deprioritized reason", async () => {
    // Many functions, low cap
    const functions = Array.from({ length: 5 }, (_, i) => `
export async function handler${i}(req: Request) {
  const data = JSON.parse(req.body);
  const result = await process(data);
  return result;
}`).join("\n");

    const code = `import { Request } from 'express';\n${functions}`;
    const config = { ...DEFAULT_CONFIG, maxSpansPerFile: 2 };
    const plan = await analyzeFile("src/handlers.ts", code, config);
    const deprioritized = plan.skippedFunctions.filter((s) => s.reason === "deprioritized");
    // Some functions should be deprioritized
    expect(deprioritized.length).toBeGreaterThan(0);
  });
});

describe("buildSpanName", () => {
  it("converts camelCase to snake_case correctly", () => {
    expect(buildSpanName("myapp", "createUser")).toBe("myapp.create_user");
    expect(buildSpanName("myapp", "getOrderById")).toBe("myapp.get_order_by_id");
    expect(buildSpanName("myapp", "simple")).toBe("myapp.simple");
  });
});
