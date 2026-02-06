// ABOUTME: Public API entry point for the telemetry-agent package.
// ABOUTME: Re-exports core functions and types for external consumers.

export { runInit } from "./init.js";
export { processFiles, postProcess } from "./coordinator.js";
export { createMcpServer, handleToolCall } from "./mcp-server.js";
export { loadConfig, writeConfig } from "./config.js";
export { runAgent } from "./agent.js";
export { buildPrDescription, buildResultManifest, createPullRequest } from "./pr.js";
export { runEndOfRunValidation, runTests } from "./end-of-run.js";
export { initAgentTelemetry, shutdownAgentTelemetry } from "./telemetry.js";

export type { Config } from "./config.js";
export type {
  CoordinatorOptions,
  CoordinatorResult,
  PostProcessResult,
  EndOfRunResult,
  FileProcessingContext,
  AgentFn,
} from "./coordinator.js";
export type { InitResult } from "./init.js";
export type { FileResult, LibraryRequirement } from "./results.js";
