// ABOUTME: PR creation helpers — builds result manifests and markdown PR descriptions.
// ABOUTME: Generates summary tables and stats from instrumentation results.

import { execSync } from "node:child_process";
import type { FileResult } from "./results.js";
import type { EndOfRunResult } from "./coordinator.js";

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface SpanDensityInfo {
  spanDensityWarning: boolean;
  totalSpans: number;
  maxSpansPerRun: number;
}

export interface PrDescriptionOptions {
  tokenUsage?: TokenUsageSummary;
  spanDensity?: SpanDensityInfo;
}

export function buildResultManifest(
  results: FileResult[],
  endOfRun: EndOfRunResult | null
): string {
  return JSON.stringify({ results, endOfRun }, null, 2);
}

export function buildPrDescription(
  results: FileResult[],
  endOfRun: EndOfRunResult | null,
  options?: PrDescriptionOptions,
): string {
  const succeeded = results.filter((r) => r.status === "success");
  const failed = results.filter((r) => r.status === "failed");
  const totalSpans = succeeded.reduce(
    (sum, r) => sum + (r.status === "success" ? r.spans_added : 0),
    0
  );

  const lines: string[] = [];

  lines.push("## Telemetry Agent — Instrumentation PR");
  lines.push("");
  lines.push(`**${results.length} files processed**: ${succeeded.length} succeeded, ${failed.length} failed`);
  lines.push(`**${totalSpans} spans** added`);
  lines.push("");

  // Results table
  lines.push("| File | Status | Spans | Libraries |");
  lines.push("|------|--------|-------|-----------|");
  for (const r of results) {
    const file = r.path;
    if (r.status === "success") {
      const libs = r.libraries_needed.map((l) => l.package).join(", ") || "—";
      lines.push(`| ${file} | success | ${r.spans_added} | ${libs} |`);
    } else {
      lines.push(`| ${file} | failed | — | — |`);
    }
  }
  lines.push("");

  // End-of-run results
  if (endOfRun) {
    lines.push("## Tests");
    lines.push("");
    if (endOfRun.skipped) {
      lines.push(`Tests skipped: ${endOfRun.skipReason}`);
    } else if (endOfRun.testsRan) {
      lines.push(`Tests ${endOfRun.testsPassed ? "passed" : "failed"}`);
    }
    lines.push("");
  }

  // Token usage summary
  if (options?.tokenUsage) {
    const { inputTokens, outputTokens, estimatedCost } = options.tokenUsage;
    lines.push("## Token Usage");
    lines.push("");
    lines.push(`- Input tokens: ${inputTokens}`);
    lines.push(`- Output tokens: ${outputTokens}`);
    lines.push(`- Estimated cost: $${estimatedCost.toFixed(2)}`);
    lines.push("");
  }

  // Span density warning
  if (options?.spanDensity?.spanDensityWarning) {
    const { totalSpans, maxSpansPerRun } = options.spanDensity;
    lines.push(`> **Span Density Warning:** Total spans (${totalSpans}) exceeds maxSpansPerRun (${maxSpansPerRun}). Review span additions for potential over-instrumentation.`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function createPullRequest(
  repoPath: string,
  branchName: string,
  title: string,
  body: string
): Promise<string> {
  const output = execSync(
    `gh pr create --title "${title}" --body "${body.replace(/"/g, '\\"')}"`,
    { cwd: repoPath, stdio: "pipe" }
  ).toString().trim();
  return output;
}
