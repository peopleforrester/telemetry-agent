// ABOUTME: Tests for the library allowlist — framework-to-OTel-package mapping.
// ABOUTME: Validates lookups for known frameworks and null returns for unknown ones.

import { describe, it, expect } from "vitest";
import { lookupLibrary, isInAllowlist } from "../allowlist.js";

describe("lookupLibrary", () => {
  it("returns correct result for 'pg'", () => {
    const result = lookupLibrary("pg");
    expect(result).not.toBeNull();
    expect(result!.package).toBe("@opentelemetry/instrumentation-pg");
    expect(result!.import).toBe("PgInstrumentation");
  });

  it("returns correct result for 'fastify' (uses @fastify/otel)", () => {
    const result = lookupLibrary("fastify");
    expect(result).not.toBeNull();
    expect(result!.package).toBe("@fastify/otel");
    expect(result!.import).toBe("FastifyOtel");
  });

  it("returns null for unknown import 'some-random-lib'", () => {
    const result = lookupLibrary("some-random-lib");
    expect(result).toBeNull();
  });
});

describe("isInAllowlist", () => {
  it("returns true for 'express'", () => {
    expect(isInAllowlist("express")).toBe(true);
  });

  it("returns true for '@grpc/grpc-js'", () => {
    expect(isInAllowlist("@grpc/grpc-js")).toBe(true);
  });

  it("returns false for 'unknown'", () => {
    expect(isInAllowlist("unknown")).toBe(false);
  });
});
