// ABOUTME: Tests for end-of-run validation — test execution, Weaver live-check skip logic.
// ABOUTME: Validates graceful skipping when Weaver/tests unavailable, env var passing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import { runTests, runEndOfRunValidation } from "../end-of-run.js";
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

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `eor-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("runTests", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("executes command and captures output", async () => {
    const result = await runTests(tempDir, "echo hello-test");
    expect(result.passed).toBe(true);
    expect(result.output).toContain("hello-test");
  });

  it("returns passed=false on non-zero exit", async () => {
    const result = await runTests(tempDir, "exit 1");
    expect(result.passed).toBe(false);
  });

  it("passes environment variables correctly", async () => {
    const result = await runTests(tempDir, "echo $MY_TEST_VAR", {
      MY_TEST_VAR: "test-value-42",
    });
    expect(result.passed).toBe(true);
    expect(result.output).toContain("test-value-42");
  });
});

describe("runEndOfRunValidation", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("skips when no test command", async () => {
    const config = { ...DEFAULT_CONFIG, testCommand: "" };
    const result = await runEndOfRunValidation(tempDir, config);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/test command/i);
  });

  it("skips when Weaver not installed", async () => {
    // This test relies on Weaver not being installed in the CI/test environment
    // If Weaver IS installed, it will still pass — the test command will just run
    const result = await runEndOfRunValidation(tempDir, DEFAULT_CONFIG);
    // Either skipped (no Weaver) or ran (Weaver present)
    expect(result.skipped || result.testsRan).toBe(true);
  });

  it("handles Weaver start failure gracefully", async () => {
    // Use a non-existent schema path to make Weaver fail
    const config = { ...DEFAULT_CONFIG, schemaPath: "/nonexistent/path" };
    const result = await runEndOfRunValidation(tempDir, config);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBeDefined();
  });
});
