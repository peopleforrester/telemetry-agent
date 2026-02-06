// ABOUTME: Tests for code transformation — OTel imports, tracer declaration, span wrapping.
// ABOUTME: Validates AST-based transformations produce valid TypeScript output.

import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";

import {
  addOtelImports,
  addTracerDeclaration,
  wrapFunctionWithSpan,
  applyTransformations,
  type SpanAttribute,
} from "../transform.js";

function isValidTypeScript(code: string): boolean {
  try {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("test-output.ts", code);
    const diagnostics = sf.getPreEmitDiagnostics();
    // Allow type errors (missing external types), just check syntax
    return !diagnostics.some(
      (d) => d.getCategory() === 1 /* Error */ && d.getCode() < 2000 /* Syntax errors */
    );
  } catch {
    return false;
  }
}

describe("addOtelImports", () => {
  it("adds import to file without it", () => {
    const code = `import { Pool } from 'pg';\n\nexport async function query() { return null; }`;
    const result = addOtelImports(code);
    expect(result).toContain("trace, SpanStatusCode");
    expect(result).toContain("@opentelemetry/api");
  });

  it("skips if import already exists", () => {
    const code = `import { trace, SpanStatusCode } from '@opentelemetry/api';\n\nexport async function query() { return null; }`;
    const result = addOtelImports(code);
    const matches = result.match(/@opentelemetry\/api/g);
    expect(matches).toHaveLength(1);
  });
});

describe("addTracerDeclaration", () => {
  it("adds tracer after imports", () => {
    const code = `import { trace } from '@opentelemetry/api';\n\nexport async function query() { return null; }`;
    const result = addTracerDeclaration(code, "my-service");
    expect(result).toContain("const tracer = trace.getTracer('my-service')");
    // Tracer should be after import
    const importIdx = result.indexOf("import");
    const tracerIdx = result.indexOf("const tracer");
    expect(tracerIdx).toBeGreaterThan(importIdx);
  });

  it("skips if tracer exists", () => {
    const code = `import { trace } from '@opentelemetry/api';\nconst tracer = trace.getTracer('existing');\n\nexport async function query() { return null; }`;
    const result = addTracerDeclaration(code, "my-service");
    const matches = result.match(/const tracer/g);
    expect(matches).toHaveLength(1);
  });
});

describe("wrapFunctionWithSpan", () => {
  it("wraps async function correctly", () => {
    const code = `
import { trace, SpanStatusCode } from '@opentelemetry/api';
const tracer = trace.getTracer('test');

export async function createUser(name: string) {
  const user = await db.insert(name);
  return user;
}
`;
    const result = wrapFunctionWithSpan(code, "createUser", "user.create", []);
    expect(result).toContain("tracer.startActiveSpan");
    expect(result).toContain("'user.create'");
    expect(result).toContain("span.end()");
    expect(result).toContain("span.recordException");
    expect(result).toContain("SpanStatusCode.ERROR");
  });

  it('uses "otelSpan" when "span" is shadowed', () => {
    const code = `
import { trace, SpanStatusCode } from '@opentelemetry/api';
const tracer = trace.getTracer('test');

export async function processSpan(span: string) {
  console.log(span);
  return span;
}
`;
    const result = wrapFunctionWithSpan(
      code,
      "processSpan",
      "process.span",
      [],
      "otelSpan"
    );
    expect(result).toContain("otelSpan");
    expect(result).toContain("otelSpan.end()");
  });

  it("adds attributes", () => {
    const code = `
import { trace, SpanStatusCode } from '@opentelemetry/api';
const tracer = trace.getTracer('test');

export async function getOrder(orderId: string) {
  return await db.query(orderId);
}
`;
    const attrs: SpanAttribute[] = [
      { key: "order.id", valueExpression: "orderId" },
    ];
    const result = wrapFunctionWithSpan(code, "getOrder", "order.get", attrs);
    expect(result).toContain("span.setAttribute('order.id', orderId)");
  });

  it("preserves existing code structure", () => {
    const code = `
import { trace, SpanStatusCode } from '@opentelemetry/api';
const tracer = trace.getTracer('test');

// This is an important function
export async function doWork() {
  const result = await fetch('/api');
  return result.json();
}
`;
    const result = wrapFunctionWithSpan(code, "doWork", "work.do", []);
    // Original code should still be present
    expect(result).toContain("fetch('/api')");
    expect(result).toContain("result.json()");
  });
});

describe("applyTransformations", () => {
  it("chains all transforms correctly", () => {
    const code = `
import { Pool } from 'pg';

export async function createUser(name: string) {
  const pool = new Pool();
  const result = await pool.query('INSERT INTO users(name) VALUES($1)', [name]);
  return result.rows[0];
}
`;
    const result = applyTransformations(code, {
      serviceName: "user-service",
      spans: [
        {
          functionName: "createUser",
          spanName: "user.create",
          attributes: [{ key: "user.name", valueExpression: "name" }],
          variableName: "span",
        },
      ],
    });

    expect(result).toContain("@opentelemetry/api");
    expect(result).toContain("trace.getTracer('user-service')");
    expect(result).toContain("tracer.startActiveSpan");
    expect(result).toContain("'user.create'");
  });

  it("handles empty spans list (returns unchanged)", () => {
    const code = `export const x = 1;\n`;
    const result = applyTransformations(code, {
      serviceName: "test",
      spans: [],
    });
    expect(result).toBe(code);
  });

  it("round-trip: transform output is valid TypeScript", () => {
    const code = `
export async function fetchData(url: string) {
  const res = await fetch(url);
  return await res.json();
}
`;
    const result = applyTransformations(code, {
      serviceName: "data-service",
      spans: [
        {
          functionName: "fetchData",
          spanName: "data.fetch",
          attributes: [],
          variableName: "span",
        },
      ],
    });

    expect(isValidTypeScript(result)).toBe(true);
  });
});
