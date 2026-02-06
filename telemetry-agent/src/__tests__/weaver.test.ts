// ABOUTME: Tests for the Weaver CLI wrapper — command construction and output parsing.
// ABOUTME: Unit tests use fixtures; integration tests skip if Weaver is not installed.

import { describe, it, expect } from "vitest";

import {
  parseCheckOutput,
  parseResolveOutput,
  buildCheckArgs,
  buildResolveArgs,
  isWeaverInstalled,
} from "../weaver.js";

describe("Weaver CLI — unit tests (fixtures)", () => {
  it("parseCheckOutput parses successful output correctly", () => {
    const stdout = "";
    const stderr = "";
    const exitCode = 0;

    const result = parseCheckOutput(stdout, stderr, exitCode);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("parseCheckOutput parses error output with violations", () => {
    const stdout = "";
    const stderr = `error: Invalid attribute reference 'nonexistent.attr' in group 'my.span'
warning: Attribute 'my.attr' has no brief description`;
    const exitCode = 1;

    const result = parseCheckOutput(stdout, stderr, exitCode);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("nonexistent.attr");
  });

  it("parseResolveOutput parses JSON output into typed groups", () => {
    const jsonOutput = JSON.stringify([
      {
        id: "registry.test",
        type: "attribute_group",
        brief: "Test attributes",
        attributes: [
          { id: "test.name", type: "string", requirement_level: "required" },
        ],
      },
      {
        id: "test.operation",
        type: "span",
        brief: "A test span",
        attributes: [
          { ref: "test.name", requirement_level: "required" },
        ],
      },
    ]);

    const result = parseResolveOutput(jsonOutput);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].id).toBe("registry.test");
    expect(result.groups[0].type).toBe("attribute_group");
    expect(result.groups[1].type).toBe("span");
    expect(result.groups[1].attributes).toHaveLength(1);
  });

  it("buildCheckArgs constructs correct command arguments", () => {
    const args = buildCheckArgs("/path/to/registry");
    expect(args).toContain("registry");
    expect(args).toContain("check");
    expect(args).toContain("-r");
    expect(args).toContain("/path/to/registry");
  });

  it("buildResolveArgs constructs correct command arguments", () => {
    const args = buildResolveArgs("/path/to/registry");
    expect(args).toContain("registry");
    expect(args).toContain("resolve");
    expect(args).toContain("-r");
    expect(args).toContain("/path/to/registry");
    expect(args).toContain("-f");
    expect(args).toContain("json");
  });
});

describe("Weaver CLI — integration tests", () => {
  it("isWeaverInstalled returns a boolean", async () => {
    const result = await isWeaverInstalled();
    expect(typeof result).toBe("boolean");
  });
});
