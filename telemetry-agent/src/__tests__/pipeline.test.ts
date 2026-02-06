// ABOUTME: Tests for the file analysis pipeline — framework detection, span planning, caps.
// ABOUTME: Validates the full analysis flow from file content to instrumentation plan.

import { describe, it, expect } from "vitest";

import { analyzeFile, buildSpanName } from "../pipeline.js";
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

describe("buildSpanName", () => {
  it("converts camelCase to snake_case correctly", () => {
    expect(buildSpanName("myapp", "createUser")).toBe("myapp.create_user");
    expect(buildSpanName("myapp", "getOrderById")).toBe("myapp.get_order_by_id");
    expect(buildSpanName("myapp", "simple")).toBe("myapp.simple");
  });
});
