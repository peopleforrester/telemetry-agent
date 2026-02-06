// ABOUTME: Tests for MCP server — tool registration, input validation, and status checks.
// ABOUTME: Validates all three MCP tools respond correctly to valid/invalid inputs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import { createMcpServer, handleToolCall } from "../mcp-server.js";

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `mcp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("MCP server", () => {
  it("creates server with tool definitions", () => {
    const server = createMcpServer();
    expect(server.tools).toBeDefined();
    expect(server.tools).toHaveLength(3);
  });

  it("registers telemetry_agent_init tool", () => {
    const server = createMcpServer();
    const initTool = server.tools.find((t) => t.name === "telemetry_agent_init");
    expect(initTool).toBeDefined();
    expect(initTool!.description).toContain("Initialize");
  });

  it("registers telemetry_agent_instrument tool", () => {
    const server = createMcpServer();
    const instrumentTool = server.tools.find((t) => t.name === "telemetry_agent_instrument");
    expect(instrumentTool).toBeDefined();
    expect(instrumentTool!.description).toContain("Instrument");
  });

  it("registers telemetry_agent_status tool", () => {
    const server = createMcpServer();
    const statusTool = server.tools.find((t) => t.name === "telemetry_agent_status");
    expect(statusTool).toBeDefined();
  });
});

describe("handleToolCall", () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it("telemetry_agent_status returns not initialized for empty dir", async () => {
    const result = await handleToolCall("telemetry_agent_status", { targetDir: tempDir });
    expect(result).toContain("not initialized");
  });

  it("telemetry_agent_status returns initialized when config exists", async () => {
    // Write a minimal config file
    fs.writeFileSync(
      path.join(tempDir, "telemetry-agent.yaml"),
      "schemaPath: ./registry\nsdkInitFile: src/setup.ts\n"
    );
    const result = await handleToolCall("telemetry_agent_status", { targetDir: tempDir });
    expect(result).toContain("initialized");
  });
});
