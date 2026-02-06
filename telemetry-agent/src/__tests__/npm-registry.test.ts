// ABOUTME: Tests for npm registry client — search strategy, package info, import inference.
// ABOUTME: Unit tests (no network) and integration tests (skip in CI).

import { describe, it, expect } from "vitest";

import {
  toLibraryRequirement,
  buildSearchUrls,
  searchOtelLibrary,
  getPackageInfo,
} from "../npm-registry.js";

describe("npm registry — unit tests", () => {
  it("toLibraryRequirement infers correct import from @opentelemetry/instrumentation-pg", () => {
    const result = toLibraryRequirement({
      packageName: "@opentelemetry/instrumentation-pg",
      version: "0.50.0",
      description: "Pg instrumentation",
    });
    expect(result.package).toBe("@opentelemetry/instrumentation-pg");
    expect(result.import).toBe("PgInstrumentation");
  });

  it("toLibraryRequirement handles scoped packages like @fastify/otel", () => {
    const result = toLibraryRequirement({
      packageName: "@fastify/otel",
      version: "1.0.0",
      description: "Fastify OTel",
    });
    expect(result.package).toBe("@fastify/otel");
    expect(result.import).toBe("FastifyOtel");
  });

  it("buildSearchUrls constructs correct search URLs", () => {
    const urls = buildSearchUrls("pg");
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("@opentelemetry/instrumentation-pg");
    expect(urls[1]).toContain("@pg/otel");
    expect(urls[2]).toContain("opentelemetry+instrumentation+pg");
  });
});

describe("npm registry — integration tests", () => {
  const SKIP = !!process.env.CI;

  it.skipIf(SKIP)("searchOtelLibrary('pg') finds instrumentation package", async () => {
    const result = await searchOtelLibrary("pg");
    expect(result).not.toBeNull();
    expect(result!.packageName).toContain("pg");
  });

  it.skipIf(SKIP)("searchOtelLibrary('nonexistent-xyz-999') returns null", async () => {
    const result = await searchOtelLibrary("nonexistent-xyz-999");
    expect(result).toBeNull();
  });

  it.skipIf(SKIP)("getPackageInfo returns valid info", async () => {
    const result = await getPackageInfo("@opentelemetry/instrumentation-pg");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("@opentelemetry/instrumentation-pg");
    expect(result!.deprecated).toBe(false);
  });
});
