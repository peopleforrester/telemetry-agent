// ABOUTME: Result module — Zod schemas for per-file agent results, aggregation.
// ABOUTME: Handles success/failure discriminated union, library dedup, and summarization.

import { z } from "zod";

export const LibraryRequirementSchema = z.object({
  package: z.string(),
  import: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
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
  spans_added: z.number().int().min(0).default(0),
  libraries_needed: z.array(LibraryRequirementSchema).default([]),
  schema_extensions: z.array(z.string()).default([]),
  attributes_created: z.number().int().min(0).default(0),
  validation_retries: z.number().int().min(0).default(0),
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
