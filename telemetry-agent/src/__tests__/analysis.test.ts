// ABOUTME: Tests for TypeScript file analysis — imports, frameworks, instrumentation, shadowing.
// ABOUTME: Uses inline TypeScript strings as test fixtures for ts-morph analysis.

import { describe, it, expect } from "vitest";

import {
  analyzeImports,
  detectFrameworks,
  detectExistingInstrumentation,
  checkVariableShadowing,
  findInstrumentableFunctions,
} from "../analysis.js";

describe("analyzeImports", () => {
  it("finds named imports", () => {
    const code = `import { Pool } from 'pg';\nimport { Client } from 'pg';`;
    const imports = analyzeImports(code);
    const pgImport = imports.find((i) => i.moduleSpecifier === "pg");
    expect(pgImport).toBeDefined();
    expect(pgImport!.namedImports).toContain("Pool");
  });

  it("finds default imports", () => {
    const code = `import express from 'express';`;
    const imports = analyzeImports(code);
    const exp = imports.find((i) => i.moduleSpecifier === "express");
    expect(exp).toBeDefined();
    expect(exp!.defaultImport).toBe("express");
  });

  it("finds namespace imports", () => {
    const code = `import * as grpc from '@grpc/grpc-js';`;
    const imports = analyzeImports(code);
    const g = imports.find((i) => i.moduleSpecifier === "@grpc/grpc-js");
    expect(g).toBeDefined();
    expect(g!.namedImports).toHaveLength(0);
  });
});

describe("detectFrameworks", () => {
  it("returns ['pg'] for pg import", () => {
    const imports = analyzeImports(`import { Pool } from 'pg';`);
    const frameworks = detectFrameworks(imports);
    expect(frameworks).toContain("pg");
  });

  it("returns empty for unknown modules", () => {
    const imports = analyzeImports(`import { foo } from 'my-custom-lib';`);
    const frameworks = detectFrameworks(imports);
    expect(frameworks).toHaveLength(0);
  });
});

describe("detectExistingInstrumentation", () => {
  it("finds tracer.startActiveSpan", () => {
    const code = `
const tracer = trace.getTracer('my-service');
async function doWork() {
  return tracer.startActiveSpan('work', async (span) => {
    span.end();
  });
}
`;
    const info = detectExistingInstrumentation(code);
    expect(info.some((i) => i.type === "span")).toBe(true);
  });

  it("finds @opentelemetry/api import", () => {
    const code = `import { trace, SpanStatusCode } from '@opentelemetry/api';`;
    const info = detectExistingInstrumentation(code);
    expect(info.some((i) => i.type === "import")).toBe(true);
  });

  it("returns empty for uninstrumented file", () => {
    const code = `
export async function getUser(id: string) {
  return db.query('SELECT * FROM users WHERE id = $1', [id]);
}
`;
    const info = detectExistingInstrumentation(code);
    expect(info).toHaveLength(0);
  });
});

describe("checkVariableShadowing", () => {
  it("detects 'span' in outer scope", () => {
    const code = `
const span = 'outer-variable';
export async function doWork() {
  console.log(span);
}
`;
    const result = checkVariableShadowing(code, ["span"], "doWork");
    expect(result.hasShadowing).toBe(true);
    expect(result.conflicts.some((c) => c.name === "span")).toBe(true);
  });

  it("returns false when no conflicts", () => {
    const code = `
export async function doWork() {
  const x = 1;
  return x;
}
`;
    const result = checkVariableShadowing(code, ["span", "tracer"], "doWork");
    expect(result.hasShadowing).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it("detects 'tracer' as module-level variable", () => {
    const code = `
const tracer = getTracer('test');
export async function handle() {
  return tracer.startSpan('test');
}
`;
    const result = checkVariableShadowing(code, ["tracer"], "handle");
    expect(result.hasShadowing).toBe(true);
    expect(result.conflicts[0].name).toBe("tracer");
  });
});

describe("findInstrumentableFunctions", () => {
  it("finds exported async functions", () => {
    const code = `
export async function createUser(name: string, email: string) {
  const user = await db.query('INSERT INTO users (name, email) VALUES ($1, $2)', [name, email]);
  await sendEmail(email);
  await logAudit('user.created', user.id);
  return user;
}

export async function deleteUser(id: string) {
  await db.query('DELETE FROM users WHERE id = $1', [id]);
  await logAudit('user.deleted', id);
  return { deleted: true };
}
`;
    const fns = findInstrumentableFunctions(code);
    expect(fns.length).toBeGreaterThanOrEqual(1);
    expect(fns.some((f) => f.name === "createUser")).toBe(true);
    expect(fns.every((f) => f.isAsync)).toBe(true);
    expect(fns.every((f) => f.isExported)).toBe(true);
  });

  it("skips short synchronous helpers", () => {
    const code = `
export function formatName(first: string, last: string): string {
  return \`\${first} \${last}\`;
}
`;
    const fns = findInstrumentableFunctions(code);
    // Short sync helper (3 lines) should be skipped
    expect(fns).toHaveLength(0);
  });
});
