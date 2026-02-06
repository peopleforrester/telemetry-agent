// ABOUTME: Self-instrumentation — OTel spans for the telemetry agent's own operations.
// ABOUTME: Provides span helpers for coordinator, file processing, and LLM calls.

import * as api from "@opentelemetry/api";

const TRACER_NAME = "telemetry-agent";
let tracerInstance: api.Tracer | null = null;

function getTracer(): api.Tracer {
  if (!tracerInstance) {
    tracerInstance = api.trace.getTracer(TRACER_NAME);
  }
  return tracerInstance;
}

export function initAgentTelemetry(): void {
  // Tracer is lazily initialized via getTracer()
  tracerInstance = api.trace.getTracer(TRACER_NAME);
}

export async function shutdownAgentTelemetry(): Promise<void> {
  tracerInstance = null;
}

export async function withCoordinatorSpan<T>(
  fn: () => Promise<T>,
  attributes?: Record<string, string | number>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan("telemetry_agent.run", async (span) => {
    try {
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          span.setAttribute(key, value);
        }
      }
      const result = await fn();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: api.SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withFileSpan<T>(
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan("telemetry_agent.file.process", async (span) => {
    try {
      span.setAttribute("file.path", filePath);
      const result = await fn();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: api.SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withLlmSpan<T>(
  model: string,
  fn: () => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan("telemetry_agent.llm.call", async (span) => {
    try {
      span.setAttribute("gen_ai.request.model", model);
      const result = await fn();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: api.SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function getTraceContext(): { traceId: string; spanId: string } | null {
  const span = api.trace.getActiveSpan();
  if (!span) return null;
  const ctx = span.spanContext();
  // Check for invalid (all-zero) trace ID
  if (ctx.traceId === "00000000000000000000000000000000") return null;
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}
