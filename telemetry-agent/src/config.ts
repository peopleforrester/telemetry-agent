// ABOUTME: Config module — Zod schema for telemetry-agent.yaml, YAML I/O.
// ABOUTME: Defines the Config type and provides loadConfig/writeConfig functions.

import * as fs from "node:fs";
import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const ConfigSchema = z.object({
  schemaPath: z.string(),
  sdkInitFile: z.string(),
  autoApproveLibraries: z.boolean().default(true),
  testCommand: z.string().default("npm test"),
  maxFixAttempts: z.number().int().min(1).max(10).default(3),
  maxTokensPerFile: z.number().int().min(1000).default(50000),
  maxSpansPerFile: z.number().int().min(1).max(20).default(5),
  exclude: z
    .array(z.string())
    .default(["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts", "node_modules/**"]),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(configPath: string): Config {
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);
  return ConfigSchema.parse(parsed);
}

export function writeConfig(configPath: string, config: Config): void {
  const validated = ConfigSchema.parse(config);
  const yamlContent = stringifyYaml(validated);
  fs.writeFileSync(configPath, yamlContent, "utf-8");
}
