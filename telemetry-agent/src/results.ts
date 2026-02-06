// ABOUTME: Result file module — Zod schemas for per-file agent results, file I/O, aggregation.
// ABOUTME: Handles success/failure discriminated union, write/read/collect, and library dedup.

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

export const LibraryRequirementSchema = z.object({
  package: z.string(),
  import: z.string(),
  config: z.record(z.unknown()).default({}),
});

export type LibraryRequirement = z.infer<typeof LibraryRequirementSchema>;

export const SuccessResultSchema = z.object({
  path: z.string(),
  status: z.literal("success"),
  spans_added: z.number().int().min(0),
  libraries_needed: z.array(LibraryRequirementSchema).default([]),
  schema_extensions: z.array(z.string()).default([]),
  attributes_created: z.number().int().min(0).default(0),
  validation_retries: z.number().int().min(0).default(0),
});

export const FailureResultSchema = z.object({
  path: z.string(),
  status: z.literal("failed"),
  reason: z.string(),
  last_error: z.string().optional(),
});

export const FileResultSchema = z.discriminatedUnion("status", [
  SuccessResultSchema,
  FailureResultSchema,
]);

export type SuccessResult = z.infer<typeof SuccessResultSchema>;
export type FailureResult = z.infer<typeof FailureResultSchema>;
export type FileResult = z.infer<typeof FileResultSchema>;

export interface ResultSummary {
  total: number;
  succeeded: number;
  failed: number;
  totalSpansAdded: number;
  totalAttributesCreated: number;
  librariesNeeded: string[];
}

function resultFilename(filePath: string): string {
  return filePath.replace(/\//g, "__").replace(/\.ts$/, ".json");
}

export function writeResult(dir: string, result: FileResult): string {
  fs.mkdirSync(dir, { recursive: true });
  const filename = resultFilename(result.path);
  const outPath = path.join(dir, filename);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  return outPath;
}

export function readResult(filePath: string): FileResult {
  const raw = fs.readFileSync(filePath, "utf-8");
  return FileResultSchema.parse(JSON.parse(raw));
}

export function collectResults(dir: string): FileResult[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const results = files.map((f) => readResult(path.join(dir, f)));
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

export function aggregateLibraries(results: FileResult[]): LibraryRequirement[] {
  const seen = new Set<string>();
  const libs: LibraryRequirement[] = [];

  for (const r of results) {
    if (r.status !== "success") continue;
    for (const lib of r.libraries_needed) {
      if (!seen.has(lib.package)) {
        seen.add(lib.package);
        libs.push(lib);
      }
    }
  }

  return libs;
}

export function summarizeResults(results: FileResult[]): ResultSummary {
  let succeeded = 0;
  let failed = 0;
  let totalSpansAdded = 0;
  let totalAttributesCreated = 0;

  for (const r of results) {
    if (r.status === "success") {
      succeeded++;
      totalSpansAdded += r.spans_added;
      totalAttributesCreated += r.attributes_created;
    } else {
      failed++;
    }
  }

  const libs = aggregateLibraries(results);

  return {
    total: results.length,
    succeeded,
    failed,
    totalSpansAdded,
    totalAttributesCreated,
    librariesNeeded: libs.map((l) => l.package),
  };
}
