// ABOUTME: End-to-end integration test — full workflow from init through instrumentation.
// ABOUTME: Uses a fixture project to validate the complete telemetry agent pipeline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";

import { runInit } from "../init.js";
import { loadConfig } from "../config.js";
import { processFiles, type AgentFn } from "../coordinator.js";
import { getCurrentBranch } from "../git.js";
import { analyzeFile } from "../pipeline.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const E2E_FIXTURE = path.join(FIXTURES, "e2e-project");

function copyFixtureToTemp(): string {
  const dir = path.join(os.tmpdir(), `e2e-test-${crypto.randomUUID()}`);
  fs.cpSync(E2E_FIXTURE, dir, { recursive: true });
  // Initialize git repo
  execSync("git init", { cwd: dir });
  execSync("git config user.email 'test@test.com'", { cwd: dir });
  execSync("git config user.name 'Test'", { cwd: dir });
  execSync("git add . && git commit -m 'initial'", { cwd: dir });
  return dir;
}

describe("E2E: init", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = copyFixtureToTemp(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("initializes project with valid fixture", async () => {
    const result = await runInit(tempDir, {
      schemaPath: path.join(tempDir, "registry"),
    });
    expect(result.success).toBe(true);
    expect(result.discovered.projectName).toBe("e2e-test-project");
    expect(result.discovered.sdkInitFile).toBeDefined();
  });

  it("writes config that can be loaded back", async () => {
    const initResult = await runInit(tempDir, {
      schemaPath: path.join(tempDir, "registry"),
    });
    expect(initResult.success).toBe(true);

    const config = loadConfig(path.join(tempDir, "telemetry-agent.yaml"));
    expect(config.schemaPath).toBeDefined();
    expect(config.sdkInitFile).toBeDefined();
  });

  it("fails without package.json", async () => {
    const emptyDir = path.join(os.tmpdir(), `e2e-empty-${crypto.randomUUID()}`);
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = await runInit(emptyDir);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("package.json"))).toBe(true);

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe("E2E: pipeline analysis", () => {
  it("analyzes user-service.ts and detects pg import", async () => {
    const filePath = "src/services/user-service.ts";
    const content = fs.readFileSync(path.join(E2E_FIXTURE, filePath), "utf-8");
    const config = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
      autoApproveLibraries: true,
      testCommand: "npm test",
      maxFixAttempts: 3,
      maxTokensPerFile: 50000,
      maxSpansPerFile: 5,
      exclude: [],
    };

    const plan = await analyzeFile(filePath, content, config);
    expect(plan.librariesNeeded.length).toBeGreaterThan(0);
    expect(plan.librariesNeeded.some((l) => l.package.includes("pg"))).toBe(true);
  });

  it("analyzes order-service.ts as pure business logic", async () => {
    const filePath = "src/services/order-service.ts";
    const content = fs.readFileSync(path.join(E2E_FIXTURE, filePath), "utf-8");
    const config = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
      autoApproveLibraries: true,
      testCommand: "npm test",
      maxFixAttempts: 3,
      maxTokensPerFile: 50000,
      maxSpansPerFile: 5,
      exclude: [],
    };

    const plan = await analyzeFile(filePath, content, config);
    // Should have spans planned (no framework libraries, just manual spans)
    expect(plan.spansToAdd.length).toBeGreaterThan(0);
  });

  it("analyzes formatter.ts as short utility (limited instrumentation)", async () => {
    const filePath = "src/utils/formatter.ts";
    const content = fs.readFileSync(path.join(E2E_FIXTURE, filePath), "utf-8");
    const config = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
      autoApproveLibraries: true,
      testCommand: "npm test",
      maxFixAttempts: 3,
      maxTokensPerFile: 50000,
      maxSpansPerFile: 5,
      exclude: [],
    };

    const plan = await analyzeFile(filePath, content, config);
    // Short sync utility — should have no or minimal spans
    expect(plan.librariesNeeded).toHaveLength(0);
  });
});

describe("E2E: coordinator with mock agent", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = copyFixtureToTemp(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("processes service files end-to-end", async () => {
    const config = {
      schemaPath: path.join(tempDir, "registry"),
      sdkInitFile: "src/telemetry/setup.ts",
      autoApproveLibraries: true,
      testCommand: "echo tests",
      maxFixAttempts: 3,
      maxTokensPerFile: 50000,
      maxSpansPerFile: 5,
      exclude: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
    };

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
      { config, targetPath: path.join(tempDir, "src", "services"), repoPath: tempDir },
      mockAgent
    );

    expect(result.globalFailure).toBeNull();
    expect(result.results.length).toBe(2);
    expect(result.branchName).toMatch(/telemetry-agent\//);
  });

  it("creates feature branch", async () => {
    const config = {
      schemaPath: path.join(tempDir, "registry"),
      sdkInitFile: "src/telemetry/setup.ts",
      autoApproveLibraries: true,
      testCommand: "echo tests",
      maxFixAttempts: 3,
      maxTokensPerFile: 50000,
      maxSpansPerFile: 5,
      exclude: [],
    };

    const mockAgent: AgentFn = async (ctx) => ({
      path: ctx.filePath,
      status: "success",
      spans_added: 0,
      libraries_needed: [],
      schema_extensions: [],
      attributes_created: 0,
      validation_retries: 0,
    });

    await processFiles(
      { config, targetPath: path.join(tempDir, "src", "services"), repoPath: tempDir },
      mockAgent
    );

    const branch = await getCurrentBranch(tempDir);
    expect(branch).toMatch(/telemetry-agent\//);
  });

  it("reverts failed files", async () => {
    const config = {
      schemaPath: path.join(tempDir, "registry"),
      sdkInitFile: "src/telemetry/setup.ts",
      autoApproveLibraries: true,
      testCommand: "echo tests",
      maxFixAttempts: 3,
      maxTokensPerFile: 50000,
      maxSpansPerFile: 5,
      exclude: ["**/*.test.ts"],
    };

    const originalContent = fs.readFileSync(
      path.join(tempDir, "src", "services", "user-service.ts"),
      "utf-8"
    );

    const mockAgent: AgentFn = async (ctx) => {
      // Mangle file then report failure
      const fp = path.join(tempDir, ctx.filePath);
      fs.writeFileSync(fp, "BROKEN\n");
      return { path: ctx.filePath, status: "failed", reason: "Intentional" };
    };

    await processFiles(
      { config, targetPath: path.join(tempDir, "src", "services"), repoPath: tempDir },
      mockAgent
    );

    const afterContent = fs.readFileSync(
      path.join(tempDir, "src", "services", "user-service.ts"),
      "utf-8"
    );
    expect(afterContent).toBe(originalContent);
  });
});
