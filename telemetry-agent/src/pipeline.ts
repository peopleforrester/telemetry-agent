// ABOUTME: File analysis pipeline — decides what to instrument per file.
// ABOUTME: Combines import analysis, library matching, scope checks, and span planning.

import { analyzeImports, detectFrameworks, detectExistingInstrumentation, checkVariableShadowing, findInstrumentableFunctions } from "./analysis.js";
import { lookupLibrary } from "./allowlist.js";
import { searchOtelLibrary, toLibraryRequirement } from "./npm-registry.js";
import type { LibraryRequirement } from "./results.js";
import type { Config } from "./config.js";
import type { SpanAttribute } from "./transform.js";

export interface SpanPlan {
  functionName: string;
  spanName: string;
  spanKind: "internal" | "client" | "server";
  attributes: SpanAttribute[];
  variableName: string;
}

export interface SkippedFunction {
  name: string;
  reason: "already_instrumented" | "too_short" | "shadowing_ambiguous";
}

export interface AnalysisPlan {
  filePath: string;
  librariesNeeded: LibraryRequirement[];
  spansToAdd: SpanPlan[];
  alreadyInstrumented: string[];
  skippedFunctions: SkippedFunction[];
}

export async function analyzeFile(
  filePath: string,
  fileContent: string,
  config: Config
): Promise<AnalysisPlan> {
  const librariesNeeded: LibraryRequirement[] = [];
  const spansToAdd: SpanPlan[] = [];
  const alreadyInstrumented: string[] = [];
  const skippedFunctions: SkippedFunction[] = [];

  // Analyze imports and detect frameworks
  const imports = analyzeImports(fileContent);
  const frameworks = detectFrameworks(imports);

  // For each framework, find the instrumentation library
  for (const fw of frameworks) {
    const lib = lookupLibrary(fw);
    if (lib) {
      librariesNeeded.push(lib);
    } else if (config.autoApproveLibraries) {
      const npmResult = await searchOtelLibrary(fw);
      if (npmResult) {
        librariesNeeded.push(toLibraryRequirement(npmResult));
      }
    }
  }

  // Detect existing instrumentation
  const existing = detectExistingInstrumentation(fileContent);
  const instrumentableFns = findInstrumentableFunctions(fileContent);

  // Check which functions are already instrumented
  for (const fn of instrumentableFns) {
    const hasSpans = existing.some(
      (e) => e.type === "span" && e.location.line >= fn.startLine && e.location.line <= fn.endLine
    );
    if (hasSpans) {
      alreadyInstrumented.push(fn.name);
    }
  }

  // Plan spans for uninstrumented functions
  const namespace = deriveNamespace(filePath);
  const candidates = instrumentableFns.filter(
    (fn) => !alreadyInstrumented.includes(fn.name)
  );

  for (const fn of candidates) {
    if (spansToAdd.length >= config.maxSpansPerFile) break;

    // Check variable shadowing
    const shadowResult = checkVariableShadowing(fileContent, ["span", "tracer"], fn.name);
    let variableName = "span";
    if (shadowResult.hasShadowing) {
      if (shadowResult.conflicts.some((c) => c.name === "span")) {
        variableName = "otelSpan";
      }
    }

    spansToAdd.push({
      functionName: fn.name,
      spanName: buildSpanName(namespace, fn.name),
      spanKind: "internal",
      attributes: [],
      variableName,
    });
  }

  return {
    filePath,
    librariesNeeded,
    spansToAdd,
    alreadyInstrumented,
    skippedFunctions,
  };
}

export function buildSpanName(namespace: string, functionName: string): string {
  return `${namespace}.${camelToSnake(functionName)}`;
}

function camelToSnake(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

function deriveNamespace(filePath: string): string {
  // src/services/user-service.ts -> user_service
  const basename = filePath.split("/").pop()?.replace(/\.ts$/, "") ?? "unknown";
  return basename.replace(/-/g, "_");
}
