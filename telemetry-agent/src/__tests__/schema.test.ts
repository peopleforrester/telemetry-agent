// ABOUTME: Tests for schema read/extend — Weaver registry YAML parsing and extension.
// ABOUTME: Validates namespace prefix enforcement and preservation of existing groups.

import { describe, it, expect } from "vitest";
import * as path from "node:path";

import { readSchema, extendSchema } from "../schema.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

describe("readSchema", () => {
  it("parses valid registry", async () => {
    const schemaPath = path.join(FIXTURES, "test-registry");
    const schema = await readSchema(schemaPath);
    expect(schema.groups.length).toBeGreaterThan(0);
    expect(schema.groups[0].id).toBeDefined();
  });
});

describe("extendSchema", () => {
  it("adds new span group", async () => {
    const schemaPath = path.join(FIXTURES, "test-registry");
    const schema = await readSchema(schemaPath);

    const result = extendSchema(schema, [
      {
        groupId: "registry.new_operation",
        type: "span",
        brief: "A new operation",
        spanKind: "internal",
        attributes: [
          { ref: "test.name", requirement_level: "required" },
        ],
      },
    ]);

    expect(result).toContain("registry.new_operation");
    expect(result).toContain("A new operation");
  });

  it("rejects group ID without correct namespace prefix", async () => {
    const schemaPath = path.join(FIXTURES, "test-registry");
    const schema = await readSchema(schemaPath);

    expect(() =>
      extendSchema(schema, [
        {
          groupId: "wrong.prefix.operation",
          type: "span",
          brief: "Bad prefix",
          attributes: [],
        },
      ])
    ).toThrow(/namespace/i);
  });

  it("preserves existing groups", async () => {
    const schemaPath = path.join(FIXTURES, "test-registry");
    const schema = await readSchema(schemaPath);

    const result = extendSchema(schema, [
      {
        groupId: "registry.added",
        type: "span",
        brief: "Added span",
        attributes: [],
      },
    ]);

    // Original groups should still be present
    expect(result).toContain("test.operation");
    expect(result).toContain("registry.test");
  });
});
