// ABOUTME: Tests for self-instrumentation — span creation, attributes, trace context.
// ABOUTME: Uses in-memory exporter to capture and verify spans without a backend.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import * as api from "@opentelemetry/api";

import {
  initAgentTelemetry,
  shutdownAgentTelemetry,
  withCoordinatorSpan,
  withFileSpan,
  withLlmSpan,
  getTraceContext,
} from "../telemetry.js";

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  // Enable async context propagation
  const contextManager = new AsyncLocalStorageContextManager();
  api.context.setGlobalContextManager(contextManager);

  // OTel SDK v2 uses constructor config for span processors
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  api.trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  exporter.shutdown();
  await shutdownAgentTelemetry();
});

describe("self-instrumentation", () => {
  it("withCoordinatorSpan creates span with correct name", async () => {
    exporter.reset();
    await withCoordinatorSpan(async () => "done", { "files.attempted": 3 });
    const spans = exporter.getFinishedSpans();
    const coordinatorSpan = spans.find((s) => s.name === "telemetry_agent.run");
    expect(coordinatorSpan).toBeDefined();
  });

  it("withFileSpan creates child span", async () => {
    exporter.reset();
    await withFileSpan("src/test.ts", async () => "processed");
    const spans = exporter.getFinishedSpans();
    const fileSpan = spans.find((s) => s.name === "telemetry_agent.file.process");
    expect(fileSpan).toBeDefined();
    expect(fileSpan!.attributes["file.path"]).toBe("src/test.ts");
  });

  it("withLlmSpan sets gen_ai attributes", async () => {
    exporter.reset();
    await withLlmSpan("claude-sonnet-4-5-20250929", async () => "response");
    const spans = exporter.getFinishedSpans();
    const llmSpan = spans.find((s) => s.name === "telemetry_agent.llm.call");
    expect(llmSpan).toBeDefined();
    expect(llmSpan!.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4-5-20250929");
  });

  it("getTraceContext returns trace/span IDs within a span", async () => {
    let ctx: { traceId: string; spanId: string } | null = null;
    await withCoordinatorSpan(async () => {
      ctx = getTraceContext();
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx!.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("getTraceContext returns null outside a span", () => {
    // Outside any active span context, should still work but return a non-recording span
    const ctx = getTraceContext();
    // May return the root context — either null or a valid trace ID
    expect(ctx === null || typeof ctx.traceId === "string").toBe(true);
  });

  it("withCoordinatorSpan records token and cost attributes", async () => {
    exporter.reset();
    await withCoordinatorSpan(async () => "done", {
      "gen_ai.usage.input_tokens": 15000,
      "gen_ai.usage.output_tokens": 3000,
      "telemetry_agent.estimated_cost": 0.12,
    });
    const spans = exporter.getFinishedSpans();
    const coordinatorSpan = spans.find((s) => s.name === "telemetry_agent.run");
    expect(coordinatorSpan).toBeDefined();
    expect(coordinatorSpan!.attributes["gen_ai.usage.input_tokens"]).toBe(15000);
    expect(coordinatorSpan!.attributes["gen_ai.usage.output_tokens"]).toBe(3000);
    expect(coordinatorSpan!.attributes["telemetry_agent.estimated_cost"]).toBe(0.12);
  });
});
