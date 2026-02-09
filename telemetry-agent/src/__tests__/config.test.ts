// ABOUTME: Tests for the config module — Zod schema validation, YAML I/O.
// ABOUTME: Covers parsing, defaults, validation errors, and file read/write roundtrips.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

// Import will fail until config.ts is implemented — that's TDD.
import {
  ConfigSchema,
  loadConfig,
  writeConfig,
  type Config,
} from "../config.js";

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `config-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("ConfigSchema", () => {
  it("parses a valid config with all fields", () => {
    const input = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
      autoApproveLibraries: false,
      testCommand: "vitest run",
      maxFixAttempts: 5,
      maxTokensPerFile: 30000,
      maxSpansPerFile: 3,
      exclude: ["dist/**"],
    };

    const result = ConfigSchema.parse(input);

    expect(result.schemaPath).toBe("./registry");
    expect(result.sdkInitFile).toBe("src/telemetry/setup.ts");
    expect(result.autoApproveLibraries).toBe(false);
    expect(result.testCommand).toBe("vitest run");
    expect(result.maxFixAttempts).toBe(5);
    expect(result.maxTokensPerFile).toBe(30000);
    expect(result.maxSpansPerFile).toBe(3);
    expect(result.exclude).toEqual(["dist/**"]);
  });

  it("applies defaults for optional fields", () => {
    const input = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
    };

    const result = ConfigSchema.parse(input);

    expect(result.autoApproveLibraries).toBe(true);
    expect(result.testCommand).toBe("npm test");
    expect(result.maxFixAttempts).toBe(3);
    expect(result.maxTokensPerFile).toBe(50000);
    expect(result.maxSpansPerFile).toBe(5);
    expect(result.maxFilesPerRun).toBe(50);
    expect(result.maxSpansPerRun).toBe(50);
    expect(result.schemaCheckpointInterval).toBe(5);
    expect(result.exclude).toEqual([
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/*.d.ts",
      "node_modules/**",
    ]);
  });

  it("applies defaults for v2.1 fields (maxFilesPerRun, maxSpansPerRun, schemaCheckpointInterval)", () => {
    const input = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
    };

    const result = ConfigSchema.parse(input);

    expect(result.maxFilesPerRun).toBe(50);
    expect(result.maxSpansPerRun).toBe(50);
    expect(result.schemaCheckpointInterval).toBe(5);
  });

  it("accepts custom values for v2.1 fields", () => {
    const input = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
      maxFilesPerRun: 20,
      maxSpansPerRun: 100,
      schemaCheckpointInterval: 10,
    };

    const result = ConfigSchema.parse(input);

    expect(result.maxFilesPerRun).toBe(20);
    expect(result.maxSpansPerRun).toBe(100);
    expect(result.schemaCheckpointInterval).toBe(10);
  });

  it("rejects zero or negative values for v2.1 fields", () => {
    const base = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
    };

    expect(() =>
      ConfigSchema.parse({ ...base, maxFilesPerRun: 0 })
    ).toThrow();

    expect(() =>
      ConfigSchema.parse({ ...base, maxSpansPerRun: 0 })
    ).toThrow();

    expect(() =>
      ConfigSchema.parse({ ...base, schemaCheckpointInterval: 0 })
    ).toThrow();
  });

  it("rejects missing required fields with helpful message", () => {
    expect(() => ConfigSchema.parse({})).toThrow();

    try {
      ConfigSchema.parse({});
    } catch (error: unknown) {
      // Zod 4 uses `issues` array instead of `errors`
      const zodError = error as { issues?: Array<{ path: (string | number)[] }>; errors?: Array<{ path: string[] }> };
      const issueList = zodError.issues ?? zodError.errors ?? [];
      const paths = issueList.map((e) => e.path.join("."));
      expect(paths).toContain("schemaPath");
      expect(paths).toContain("sdkInitFile");
    }
  });

  it("rejects out-of-range values", () => {
    const base = {
      schemaPath: "./registry",
      sdkInitFile: "src/telemetry/setup.ts",
    };

    // maxFixAttempts: 0 is below min of 1
    expect(() =>
      ConfigSchema.parse({ ...base, maxFixAttempts: 0 })
    ).toThrow();

    // maxFixAttempts: 11 is above max of 10
    expect(() =>
      ConfigSchema.parse({ ...base, maxFixAttempts: 11 })
    ).toThrow();

    // maxSpansPerFile: 100 is above max of 20
    expect(() =>
      ConfigSchema.parse({ ...base, maxSpansPerFile: 100 })
    ).toThrow();

    // maxSpansPerFile: 0 is below min of 1
    expect(() =>
      ConfigSchema.parse({ ...base, maxSpansPerFile: 0 })
    ).toThrow();

    // maxTokensPerFile: 500 is below min of 1000
    expect(() =>
      ConfigSchema.parse({ ...base, maxTokensPerFile: 500 })
    ).toThrow();
  });
});

describe("loadConfig / writeConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig reads from a YAML file correctly", () => {
    const yamlContent = `schemaPath: ./registry
sdkInitFile: src/telemetry/setup.ts
maxFixAttempts: 5
`;
    const configPath = path.join(tempDir, "telemetry-agent.yaml");
    fs.writeFileSync(configPath, yamlContent, "utf-8");

    const config = loadConfig(configPath);

    expect(config.schemaPath).toBe("./registry");
    expect(config.sdkInitFile).toBe("src/telemetry/setup.ts");
    expect(config.maxFixAttempts).toBe(5);
    // Defaults should still be applied
    expect(config.autoApproveLibraries).toBe(true);
    expect(config.testCommand).toBe("npm test");
  });

  it("writeConfig produces valid YAML that loadConfig can read back", () => {
    const config: Config = {
      schemaPath: "./my-registry",
      sdkInitFile: "src/otel/init.ts",
      autoApproveLibraries: false,
      testCommand: "vitest run",
      maxFixAttempts: 7,
      maxTokensPerFile: 40000,
      maxSpansPerFile: 10,
      maxFilesPerRun: 25,
      maxSpansPerRun: 75,
      schemaCheckpointInterval: 3,
      exclude: ["build/**", "*.generated.ts"],
    };
    const configPath = path.join(tempDir, "telemetry-agent.yaml");

    writeConfig(configPath, config);
    const loaded = loadConfig(configPath);

    expect(loaded).toEqual(config);
  });

  it("loadConfig throws if file does not exist", () => {
    const missingPath = path.join(tempDir, "nonexistent.yaml");

    expect(() => loadConfig(missingPath)).toThrow();
  });
});
