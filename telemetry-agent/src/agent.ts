// ABOUTME: Instrumentation Agent — AI-driven OpenTelemetry instrumentation via Anthropic SDK.
// ABOUTME: Defines tools, system prompt, and agentic loop for per-file instrumentation.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { analyzeFile } from "./pipeline.js";
import { searchOtelLibrary } from "./npm-registry.js";
import { applyTransformations, type TransformPlan } from "./transform.js";
import type { Config } from "./config.js";
import type { FileResult } from "./results.js";

// Tool input schemas
export const toolSchemas = {
  analyze_file: z.object({}),
  search_npm: z.object({ frameworkName: z.string() }),
  transform_code: z.object({
    transforms: z.object({
      serviceName: z.string(),
      spans: z.array(
        z.object({
          functionName: z.string(),
          spanName: z.string(),
          attributes: z.array(
            z.object({ key: z.string(), valueExpression: z.string() })
          ).default([]),
          variableName: z.string().default("span"),
        })
      ),
    }),
  }),
  extend_schema: z.object({
    extensions: z.array(
      z.object({
        groupId: z.string(),
        type: z.enum(["span", "attribute_group"]),
        brief: z.string(),
        spanKind: z.string().optional(),
        attributes: z.array(
          z.object({
            ref: z.string().optional(),
            id: z.string().optional(),
            type: z.string().optional(),
            requirement_level: z.string(),
          })
        ).default([]),
      })
    ),
  }),
  validate: z.object({}),
  read_file: z.object({}),
};

// Tool execution functions (stateless, testable)
export async function executeAnalyzeFile(
  fileContent: string,
  filePath: string,
  config: Config
) {
  return analyzeFile(filePath, fileContent, config);
}

export async function executeSearchNpm(frameworkName: string) {
  return searchOtelLibrary(frameworkName);
}

export function executeTransformCode(
  fileContent: string,
  transforms: TransformPlan
): { success: boolean; newContent: string } {
  try {
    const newContent = applyTransformations(fileContent, transforms);
    return { success: true, newContent };
  } catch (err: unknown) {
    return { success: false, newContent: fileContent };
  }
}

export function executeReadFile(fileContent: string): { content: string } {
  return { content: fileContent };
}

export function buildSystemPrompt(schema: string, config: Config): string {
  return `You are an OpenTelemetry instrumentation agent. Your job is to add observability
to TypeScript source files using the OpenTelemetry API.

## Resolved Weaver Schema

\`\`\`yaml
${schema}
\`\`\`

## Rules

1. **Libraries first**: If a framework has an official OpenTelemetry instrumentation library,
   prefer that over manual spans. Use the analyze_file tool to detect frameworks.
2. **Manual spans as fallback**: For business logic without framework libraries,
   wrap functions with tracer.startActiveSpan().
3. **Span density limit**: Add at most ${config.maxSpansPerFile} spans per file.
4. **Naming conventions**: Span names follow the schema namespace. Use snake_case.
   Format: {namespace}.{function_name_in_snake_case}
5. **Variable shadowing**: Before inserting "span" or "tracer" variables, check
   the analysis plan for shadowing conflicts. Use "otelSpan" if "span" is taken.
6. **Error handling**: All spans must have try/catch/finally with span.recordException()
   and span.end() in finally.
7. **Preserve behavior**: Never change the functional behavior of the code.
   Only add observability instrumentation.

## Workflow

1. Call read_file to see the current file content.
2. Call analyze_file to get the analysis plan.
3. If libraries are needed, note them in your output.
4. Call transform_code to apply span instrumentation.
5. Return the result with spans_added count and libraries_needed.

## Output Format

When done, provide a JSON summary with:
- spans_added: number of spans inserted
- libraries_needed: array of { package, import, config } objects
- schema_extensions: array of new schema group IDs added`;
}

// Anthropic tool definitions for the API
function buildToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "analyze_file",
      description: "Run analysis pipeline on the current file to detect frameworks, existing instrumentation, and plan spans.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "search_npm",
      description: "Search npm registry for an OpenTelemetry instrumentation package for a framework.",
      input_schema: {
        type: "object" as const,
        properties: { frameworkName: { type: "string", description: "The framework to search for" } },
        required: ["frameworkName"],
      },
    },
    {
      name: "transform_code",
      description: "Apply code transformations to add OTel imports, tracer declaration, and span wrappers.",
      input_schema: {
        type: "object" as const,
        properties: {
          transforms: {
            type: "object",
            properties: {
              serviceName: { type: "string" },
              spans: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    functionName: { type: "string" },
                    spanName: { type: "string" },
                    attributes: { type: "array", items: { type: "object", properties: { key: { type: "string" }, valueExpression: { type: "string" } } } },
                    variableName: { type: "string" },
                  },
                  required: ["functionName", "spanName"],
                },
              },
            },
            required: ["serviceName", "spans"],
          },
        },
        required: ["transforms"],
      },
    },
    {
      name: "read_file",
      description: "Read the current file content.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ];
}

export async function runAgent(
  fileContent: string,
  filePath: string,
  resolvedSchema: string,
  config: Config
): Promise<FileResult> {
  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt(resolvedSchema, config);
  let currentContent = fileContent;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Instrument this TypeScript file: ${filePath}\n\n\`\`\`typescript\n${fileContent}\n\`\`\``,
    },
  ];

  const tools = buildToolDefinitions();
  const maxTurns = 10;

  for (let turn = 0; turn < maxTurns; turn++) {
    // Check token budget
    if (totalInputTokens + totalOutputTokens > config.maxTokensPerFile) {
      return {
        path: filePath,
        status: "failed",
        reason: `Token budget exceeded: ${totalInputTokens + totalOutputTokens} > ${config.maxTokensPerFile}`,
      };
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Check if done (no tool use)
    if (response.stop_reason === "end_turn" || !response.content.some((b) => b.type === "tool_use")) {
      // Parse final text for result
      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "";

      return parseAgentResult(filePath, text, currentContent, fileContent);
    }

    // Process tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      let toolResult: string;
      switch (block.name) {
        case "analyze_file": {
          const plan = await executeAnalyzeFile(currentContent, filePath, config);
          toolResult = JSON.stringify(plan);
          break;
        }
        case "search_npm": {
          const input = block.input as { frameworkName: string };
          const npmResult = await executeSearchNpm(input.frameworkName);
          toolResult = JSON.stringify(npmResult);
          break;
        }
        case "transform_code": {
          const input = block.input as { transforms: TransformPlan };
          const transformResult = executeTransformCode(currentContent, input.transforms);
          if (transformResult.success) {
            currentContent = transformResult.newContent;
          }
          toolResult = JSON.stringify(transformResult);
          break;
        }
        case "read_file": {
          toolResult = JSON.stringify(executeReadFile(currentContent));
          break;
        }
        default:
          toolResult = JSON.stringify({ error: `Unknown tool: ${block.name}` });
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: toolResult,
      });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  return {
    path: filePath,
    status: "failed",
    reason: "Max turns exceeded",
  };
}

function parseAgentResult(
  filePath: string,
  text: string,
  currentContent: string,
  originalContent: string
): FileResult {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*"spans_added"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        path: filePath,
        status: "success",
        spans_added: parsed.spans_added ?? 0,
        libraries_needed: parsed.libraries_needed ?? [],
        schema_extensions: parsed.schema_extensions ?? [],
        attributes_created: parsed.attributes_created ?? 0,
        validation_retries: 0,
      };
    } catch {
      // Fall through
    }
  }

  // If content was modified, count it as success with 0 spans
  if (currentContent !== originalContent) {
    return {
      path: filePath,
      status: "success",
      spans_added: 0,
      libraries_needed: [],
      schema_extensions: [],
      attributes_created: 0,
      validation_retries: 0,
    };
  }

  return {
    path: filePath,
    status: "failed",
    reason: "Agent did not produce a parseable result",
  };
}
