// ABOUTME: Tests for the per-file validation chain — syntax, lint, Weaver checks.
// ABOUTME: Validates each step and the retry loop with maxRetries enforcement.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import {
  checkSyntax,
  checkLint,
  fixLint,
  runValidationChain,
} from "../validation.js";

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `validation-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("checkSyntax", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("passes for valid TypeScript", async () => {
    const filePath = path.join(tempDir, "valid.ts");
    fs.writeFileSync(filePath, "export const x: number = 1;\n");

    const result = await checkSyntax(filePath);
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails for invalid TypeScript (missing bracket)", async () => {
    const filePath = path.join(tempDir, "invalid.ts");
    fs.writeFileSync(filePath, "export function foo() {\n  return 1;\n");

    const result = await checkSyntax(filePath);
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("checkLint", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("passes for formatted code", async () => {
    const filePath = path.join(tempDir, "formatted.ts");
    fs.writeFileSync(filePath, 'export const x = 1;\nexport const y = "hello";\n');

    const result = await checkLint(filePath);
    expect(result.passed).toBe(true);
  });

  it("fails for unformatted code", async () => {
    const filePath = path.join(tempDir, "unformatted.ts");
    fs.writeFileSync(filePath, "export const x=1;export const y =     'hello'");

    const result = await checkLint(filePath);
    expect(result.passed).toBe(false);
  });
});

describe("fixLint", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("auto-formats code", async () => {
    const filePath = path.join(tempDir, "fixme.ts");
    fs.writeFileSync(filePath, "export const x=1;export const y =     'hello'");

    await fixLint(filePath);
    const result = await checkLint(filePath);
    expect(result.passed).toBe(true);
  });
});

describe("runValidationChain", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("passes on first try for valid code", async () => {
    const filePath = path.join(tempDir, "good.ts");
    fs.writeFileSync(filePath, 'export const x = 1;\nexport const y = "hello";\n');

    const result = await runValidationChain(filePath, "", 3);
    expect(result.passed).toBe(true);
    expect(result.retries).toBe(0);
  });

  it("retries on lint failure, passes after fix", async () => {
    const filePath = path.join(tempDir, "fixable.ts");
    fs.writeFileSync(filePath, "export const x=1;export const y =     'hello'");

    const result = await runValidationChain(filePath, "", 3);
    expect(result.passed).toBe(true);
    expect(result.retries).toBeGreaterThanOrEqual(1);
  });

  it("stops at maxRetries", async () => {
    const filePath = path.join(tempDir, "broken.ts");
    fs.writeFileSync(filePath, "export function foo() {\n  return 1;\n");

    const result = await runValidationChain(filePath, "", 2);
    expect(result.passed).toBe(false);
    expect(result.failedStep).toBe("syntax");
  });

  it("reports correct failedStep", async () => {
    const filePath = path.join(tempDir, "syntax-err.ts");
    fs.writeFileSync(filePath, "const x: = ;;\n");

    const result = await runValidationChain(filePath, "", 1);
    expect(result.passed).toBe(false);
    expect(result.failedStep).toBe("syntax");
  });
});
