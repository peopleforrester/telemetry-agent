// ABOUTME: Tests for coordinator post-processing — library aggregation, SDK render, install.
// ABOUTME: Validates deduplication, SDK file updates, and npm install integration.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";

import { postProcess, installDependencies } from "../coordinator.js";
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
  const dir = path.join(os.tmpdir(), `post-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir });
  execSync("git config user.email 'test@test.com'", { cwd: dir });
  execSync("git config user.name 'Test'", { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "init\n");
  execSync("git add . && git commit -m 'init'", { cwd: dir });
  return dir;
}

function addSdkInitFile(dir: string): void {
  const telDir = path.join(dir, "src", "telemetry");
  fs.mkdirSync(telDir, { recursive: true });
  fs.writeFileSync(
    path.join(telDir, "setup.ts"),
    `import { NodeSDK } from '@opentelemetry/sdk-node';

const sdk = new NodeSDK({
  serviceName: 'test-service',
  instrumentations: [],
});
sdk.start();
`
  );
  execSync("git add . && git commit -m 'add sdk init'", { cwd: dir });
}

function addPackageJson(dir: string): void {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "1.0.0", dependencies: {} }, null, 2)
  );
  execSync("git add . && git commit -m 'add package.json'", { cwd: dir });
}

describe("postProcess", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempRepo();
    addPackageJson(tempDir);
    addSdkInitFile(tempDir);
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("aggregates libraries from multiple results", async () => {
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
          { package: "@opentelemetry/instrumentation-express", import: "ExpressInstrumentation", config: {} },
        ],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      },
    ];

    const result = await postProcess(
      { config: DEFAULT_CONFIG, targetPath: tempDir, repoPath: tempDir },
      results
    );

    expect(result.librariesInstalled).toContain("@opentelemetry/instrumentation-pg");
    expect(result.librariesInstalled).toContain("@opentelemetry/instrumentation-express");
  });

  it("deduplicates identical library requirements", async () => {
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
        ],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      },
    ];

    const result = await postProcess(
      { config: DEFAULT_CONFIG, targetPath: tempDir, repoPath: tempDir },
      results
    );

    const pgCount = result.librariesInstalled.filter(
      (l) => l === "@opentelemetry/instrumentation-pg"
    ).length;
    expect(pgCount).toBe(1);
  });

  it("renders SDK init file with correct libraries", async () => {
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
    ];

    const result = await postProcess(
      { config: DEFAULT_CONFIG, targetPath: tempDir, repoPath: tempDir },
      results
    );

    expect(result.sdkFileUpdated).toBe(true);
    const sdkContent = fs.readFileSync(
      path.join(tempDir, "src", "telemetry", "setup.ts"),
      "utf-8"
    );
    expect(sdkContent).toContain("PgInstrumentation");
  });

  it("handles zero libraries (no SDK update needed)", async () => {
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
    ];

    const result = await postProcess(
      { config: DEFAULT_CONFIG, targetPath: tempDir, repoPath: tempDir },
      results
    );

    expect(result.librariesInstalled).toHaveLength(0);
    expect(result.sdkFileUpdated).toBe(false);
  });

  it("reports install errors without halting", async () => {
    const results: FileResult[] = [
      {
        path: "src/a.ts",
        status: "success",
        spans_added: 1,
        libraries_needed: [
          { package: "@nonexistent/fake-package-xyz-999", import: "FakeLib", config: {} },
        ],
        schema_extensions: [],
        attributes_created: 0,
        validation_retries: 0,
      },
    ];

    const result = await postProcess(
      { config: DEFAULT_CONFIG, targetPath: tempDir, repoPath: tempDir },
      results
    );

    expect(result.installErrors.length).toBeGreaterThan(0);
  });
});

describe("installDependencies", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `install-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "install-test", version: "1.0.0", dependencies: {} }, null, 2)
    );
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("constructs correct npm command and installs", async () => {
    const result = await installDependencies(tempDir, ["is-odd"]);
    expect(result.success).toBe(true);
    // Verify the package was added to package.json
    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["is-odd"]).toBeDefined();
  });

  it("reports failure for invalid packages", async () => {
    const result = await installDependencies(tempDir, [
      "@nonexistent/fake-package-xyz-99999",
    ]);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
