// ABOUTME: MCP server — thin wrapper exposing telemetry agent as MCP tools.
// ABOUTME: Provides init, instrument, and status tools for Claude Code integration.

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "./config.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServer {
  tools: McpToolDefinition[];
}

export function createMcpServer(): McpServer {
  return {
    tools: [
      {
        name: "telemetry_agent_init",
        description: "Initialize telemetry agent for a TypeScript project",
        inputSchema: {
          type: "object",
          properties: {
            targetDir: { type: "string", description: "Path to project root" },
            schemaPath: { type: "string", description: "Path to Weaver schema registry" },
          },
          required: ["targetDir"],
        },
      },
      {
        name: "telemetry_agent_instrument",
        description: "Instrument TypeScript files with OpenTelemetry",
        inputSchema: {
          type: "object",
          properties: {
            targetPath: { type: "string", description: "File or directory to instrument" },
            configPath: { type: "string", description: "Path to telemetry-agent.yaml" },
          },
          required: ["targetPath"],
        },
      },
      {
        name: "telemetry_agent_status",
        description: "Check if telemetry agent is initialized for a project",
        inputSchema: {
          type: "object",
          properties: {
            targetDir: { type: "string", description: "Path to project root" },
          },
          required: ["targetDir"],
        },
      },
    ],
  };
}

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "telemetry_agent_status": {
      const targetDir = args.targetDir as string;
      const configPath = path.join(targetDir, "telemetry-agent.yaml");
      if (!fs.existsSync(configPath)) {
        return "Project is not initialized — telemetry-agent.yaml not found.";
      }
      try {
        const config = loadConfig(configPath);
        return `Project is initialized.\nSchema: ${config.schemaPath}\nSDK init: ${config.sdkInitFile}`;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return `Config file exists but is invalid: ${message}`;
      }
    }

    case "telemetry_agent_init": {
      return `Init would be called for ${args.targetDir}`;
    }

    case "telemetry_agent_instrument": {
      return `Instrument would be called for ${args.targetPath}`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
