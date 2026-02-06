// ABOUTME: Tests for the coordinator core — file resolution, limits, and processing loop.
// ABOUTME: Uses temp git repos with mock agent functions to validate snapshot/revert.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";

import {
  resolveFiles,
  enforceFileLimit,
  processFiles,
  type AgentFn,
} from "../coordinator.js";
import type { Config } from "../config.js";
import type { FileResult } from "../results.js";

const DEFAULT_CONFIG: Config = {
  schemaPath: "./registry",
  sdkInitFile: "src/telemetry/setup.ts",
  autoApproveLibraries: true,
  testCommand: "npm test",
  maxFixAttempts: 3,
  maxTokensPerFile: 50000,
  maxSpansPerFile: 5,
  exclude: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts", "node_modules/**"],
};

function makeTempRepo(): string {
  const dir = path.join(os.tmpdir(), `coord-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir });
  execSync("git config user.email 'test@test.com'", { cwd: dir });
  execSync("git config user.name 'Test'", { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "init\n");
  execSync("git add . && git commit -m 'init'", { cwd: dir });
  return dir;
}

function addTsFiles(dir: string, names: string[]): void {
  const srcDir = path.join(dir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(
      path.join(srcDir, name),
      `export const ${name.replace(".ts", "")} = true;\n`
    );
  }
  execSync("git add . && git commit -m 'add files'", { cwd: dir });
}

describe("resolveFiles", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempRepo(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("finds .ts files in directory", async () => {
    addTsFiles(tempDir, ["a.ts", "b.ts", "c.ts"]);
    const files = await resolveFiles(path.join(tempDir, "src"), []);
    expect(files).toHaveLength(3);
  });

  it("returns single file when given file path", async () => {
    addTsFiles(tempDir, ["a.ts"]);
    const files = await resolveFiles(path.join(tempDir, "src", "a.ts"), []);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("a.ts");
  });

  it("excludes test files and node_modules", async () => {
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "app.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(srcDir, "app.test.ts"), "test\n");
    fs.writeFileSync(path.join(srcDir, "app.spec.ts"), "spec\n");

    const files = await resolveFiles(srcDir, ["**/*.test.ts", "**/*.spec.ts"]);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("app.ts");
  });
});

describe("enforceFileLimit", () => {
  it("passes with <= 10 files", () => {
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
    expect(() => enforceFileLimit(files, 10)).not.toThrow();
  });

  it("throws with > 10 files", () => {
    const files = Array.from({ length: 11 }, (_, i) => `file${i}.ts`);
    expect(() => enforceFileLimit(files, 10)).toThrow(/11.*10/);
  });
});

describe("processFiles", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempRepo(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("calls agentFn for each file", async () => {
    addTsFiles(tempDir, ["a.ts", "b.ts"]);
    const called: string[] = [];
    const mockAgent: AgentFn = async (ctx) => {
      called.push(ctx.filePath);
      return {
        path: ctx.filePath,
        status: "success",
        spans_added: 1,
        libraries_needed: [],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      };
    };

    await processFiles(
      { config: DEFAULT_CONFIG, targetPath: path.join(tempDir, "src"), repoPath: tempDir },
      mockAgent
    );
    expect(called).toHaveLength(2);
  });

  it("reverts file on agent failure", async () => {
    addTsFiles(tempDir, ["target.ts"]);
    const originalContent = fs.readFileSync(path.join(tempDir, "src", "target.ts"), "utf-8");

    const mockAgent: AgentFn = async (ctx) => {
      // Mangle the file
      const fp = path.join(tempDir, ctx.filePath);
      fs.writeFileSync(fp, "BROKEN CONTENT\n");
      return {
        path: ctx.filePath,
        status: "failed",
        reason: "Agent broke the file",
      };
    };

    const result = await processFiles(
      { config: DEFAULT_CONFIG, targetPath: path.join(tempDir, "src"), repoPath: tempDir },
      mockAgent
    );

    expect(result.results[0].status).toBe("failed");
    // File should be reverted
    const afterContent = fs.readFileSync(path.join(tempDir, "src", "target.ts"), "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("creates feature branch", async () => {
    addTsFiles(tempDir, ["a.ts"]);
    const mockAgent: AgentFn = async (ctx) => ({
      path: ctx.filePath,
      status: "success",
      spans_added: 0,
      libraries_needed: [],
      schema_extensions: [],
      attributes_created: 0,
      validation_retries: 0,
    });

    const result = await processFiles(
      { config: DEFAULT_CONFIG, targetPath: path.join(tempDir, "src"), repoPath: tempDir },
      mockAgent
    );

    expect(result.branchName).toMatch(/telemetry-agent\//);
  });

  it("writes result files", async () => {
    addTsFiles(tempDir, ["a.ts"]);
    const mockAgent: AgentFn = async (ctx) => ({
      path: ctx.filePath,
      status: "success",
      spans_added: 1,
      libraries_needed: [],
      schema_extensions: [],
      attributes_created: 0,
      validation_retries: 0,
    });

    const result = await processFiles(
      { config: DEFAULT_CONFIG, targetPath: path.join(tempDir, "src"), repoPath: tempDir },
      mockAgent
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("success");
  });

  it("snapshot preserves original file content", async () => {
    addTsFiles(tempDir, ["preserve.ts"]);
    const originalContent = fs.readFileSync(path.join(tempDir, "src", "preserve.ts"), "utf-8");

    const mockAgent: AgentFn = async (ctx) => {
      // Modify the file but report success
      const fp = path.join(tempDir, ctx.filePath);
      fs.writeFileSync(fp, "// modified\n" + fs.readFileSync(fp, "utf-8"));
      return {
        path: ctx.filePath,
        status: "success",
        spans_added: 1,
        libraries_needed: [],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      };
    };

    await processFiles(
      { config: DEFAULT_CONFIG, targetPath: path.join(tempDir, "src"), repoPath: tempDir },
      mockAgent
    );

    // On success the modified content should remain (not reverted)
    const afterContent = fs.readFileSync(path.join(tempDir, "src", "preserve.ts"), "utf-8");
    expect(afterContent).not.toBe(originalContent);
  });
});
