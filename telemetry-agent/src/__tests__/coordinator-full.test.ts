// ABOUTME: Tests for the full coordinator loop — mock agent processes files end-to-end.
// ABOUTME: Validates branch creation, mixed success/failure handling, and post-processing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";

import { processFiles, type AgentFn } from "../coordinator.js";
import type { Config } from "../config.js";

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
  const dir = path.join(os.tmpdir(), `full-test-${crypto.randomUUID()}`);
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

describe("full coordinator loop", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempRepo(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("processes files end-to-end with mock agent", async () => {
    addTsFiles(tempDir, ["a.ts", "b.ts"]);
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

    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.status === "success")).toBe(true);
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

  it("handles mixed success/failure", async () => {
    addTsFiles(tempDir, ["good.ts", "bad.ts"]);
    let callCount = 0;
    const mockAgent: AgentFn = async (ctx) => {
      callCount++;
      if (ctx.filePath.includes("bad")) {
        return { path: ctx.filePath, status: "failed", reason: "Intentional failure" };
      }
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

    const result = await processFiles(
      { config: DEFAULT_CONFIG, targetPath: path.join(tempDir, "src"), repoPath: tempDir },
      mockAgent
    );

    expect(result.results).toHaveLength(2);
    expect(result.results.filter((r) => r.status === "success")).toHaveLength(1);
    expect(result.results.filter((r) => r.status === "failed")).toHaveLength(1);
  });
});
