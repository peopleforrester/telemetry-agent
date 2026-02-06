// ABOUTME: Tests for the SDK init file renderer — adding instrumentation libraries.
// ABOUTME: Validates import insertion, instrumentations array updates, dedup, and idempotency.

import { describe, it, expect } from "vitest";
import { renderSdkInitFile } from "../sdk-renderer.js";
import type { LibraryRequirement } from "../results.js";

const BASE_SDK_FILE = `import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';

const sdk = new NodeSDK({
  serviceName: 'my-service',
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [],
});

sdk.start();
`;

const SDK_FILE_WITH_PG = `import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

const sdk = new NodeSDK({
  serviceName: 'my-service',
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    new PgInstrumentation(),
  ],
});

sdk.start();
`;

describe("renderSdkInitFile", () => {
  it("adds single library to empty instrumentations array", () => {
    const libs: LibraryRequirement[] = [
      { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
    ];

    const result = renderSdkInitFile(BASE_SDK_FILE, libs);

    expect(result).toContain(
      "import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'"
    );
    expect(result).toContain("new PgInstrumentation()");
  });

  it("adds multiple libraries, sorted alphabetically", () => {
    const libs: LibraryRequirement[] = [
      { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
      {
        package: "@opentelemetry/instrumentation-express",
        import: "ExpressInstrumentation",
        config: {},
      },
    ];

    const result = renderSdkInitFile(BASE_SDK_FILE, libs);

    // Both imports present
    expect(result).toContain("ExpressInstrumentation");
    expect(result).toContain("PgInstrumentation");

    // Express should come before Pg alphabetically in imports
    const expressImportIdx = result.indexOf("ExpressInstrumentation");
    const pgImportIdx = result.indexOf("PgInstrumentation");
    expect(expressImportIdx).toBeLessThan(pgImportIdx);
  });

  it("doesn't duplicate existing instrumentations", () => {
    const libs: LibraryRequirement[] = [
      { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
    ];

    const result = renderSdkInitFile(SDK_FILE_WITH_PG, libs);

    // Should only appear once in imports
    const importMatches = result.match(/import.*PgInstrumentation/g);
    expect(importMatches).toHaveLength(1);

    // Should only appear once in instrumentations
    const instMatches = result.match(/new PgInstrumentation/g);
    expect(instMatches).toHaveLength(1);
  });

  it("preserves existing file structure (service name, etc.)", () => {
    const libs: LibraryRequirement[] = [
      { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} },
    ];

    const result = renderSdkInitFile(BASE_SDK_FILE, libs);

    expect(result).toContain("serviceName: 'my-service'");
    expect(result).toContain("sdk.start()");
    expect(result).toContain("OTLPTraceExporter");
  });

  it("handles empty libraries array (returns content unchanged)", () => {
    const result = renderSdkInitFile(BASE_SDK_FILE, []);
    expect(result).toBe(BASE_SDK_FILE);
  });
});
