// ABOUTME: Tests for the init phase — prerequisite checks, config creation, error handling.
// ABOUTME: Uses fixture projects and temp directories to validate the init workflow.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import { runInit, findSdkInitFile, checkNodeVersion } from "../init.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

function copyFixture(fixtureName: string): string {
  const src = path.join(FIXTURES, fixtureName);
  const dest = path.join(os.tmpdir(), `init-test-${crypto.randomUUID()}`);
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

describe("checkNodeVersion", () => {
  it("returns compatible for current Node", () => {
    const result = checkNodeVersion();
    expect(result.compatible).toBe(true);
    expect(result.version).toBeTruthy();
  });
});

describe("findSdkInitFile", () => {
  it("finds file in src/telemetry/setup.ts", async () => {
    const dir = copyFixture("valid-project");
    try {
      const result = await findSdkInitFile(dir);
      expect(result).toBe("src/telemetry/setup.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when no SDK file exists", async () => {
    const dir = copyFixture("no-otel-project");
    try {
      const result = await findSdkInitFile(dir);
      expect(result).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runInit", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("succeeds with valid project", async () => {
    tempDir = copyFixture("valid-project");
    const result = await runInit(tempDir, {
      schemaPath: path.join(tempDir, "registry"),
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.discovered.projectName).toBe("valid-test-project");
    expect(result.discovered.sdkInitFile).toBe("src/telemetry/setup.ts");
  });

  it("fails when package.json missing", async () => {
    tempDir = path.join(os.tmpdir(), `init-empty-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const result = await runInit(tempDir);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("package.json"))).toBe(true);
  });

  it("fails when @opentelemetry/api not in dependencies", async () => {
    tempDir = copyFixture("no-otel-project");
    const result = await runInit(tempDir);

    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) => e.includes("@opentelemetry/api"))
    ).toBe(true);
  });

  it("warns when no test suite found (but still succeeds)", async () => {
    tempDir = copyFixture("valid-project");
    // Remove test script
    const pkgPath = path.join(tempDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    delete pkg.scripts.test;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    const result = await runInit(tempDir, {
      schemaPath: path.join(tempDir, "registry"),
    });

    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes("test"))).toBe(true);
    expect(result.discovered.hasTestSuite).toBe(false);
  });

  it("fails when schema path doesn't exist", async () => {
    tempDir = copyFixture("valid-project");
    const result = await runInit(tempDir, {
      schemaPath: "/nonexistent/path/registry",
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("schema"))).toBe(true);
  });

  it("writes correct telemetry-agent.yaml", async () => {
    tempDir = copyFixture("valid-project");
    const result = await runInit(tempDir, {
      schemaPath: path.join(tempDir, "registry"),
    });

    expect(result.success).toBe(true);
    const configPath = path.join(tempDir, "telemetry-agent.yaml");
    expect(fs.existsSync(configPath)).toBe(true);

    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).toContain("schemaPath");
    expect(content).toContain("sdkInitFile");
  });
});
