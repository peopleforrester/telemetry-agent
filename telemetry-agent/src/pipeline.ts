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
  reason: "already_instrumented" | "too_short" | "shadowing_ambiguous" | "deprioritized";
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

  // Sort candidates by priority tier (lower tier = higher priority)
  const lines = fileContent.split("\n");
  candidates.sort((a, b) => {
    const bodyA = lines.slice(a.startLine - 1, a.endLine).join("\n");
    const bodyB = lines.slice(b.startLine - 1, b.endLine).join("\n");
    return classifyPriority(a.name, bodyA, a.isExported && a.isAsync) -
           classifyPriority(b.name, bodyB, b.isExported && b.isAsync);
  });

  for (const fn of candidates) {
    if (spansToAdd.length >= config.maxSpansPerFile) {
      // Deprioritized — exceeded cap
      skippedFunctions.push({ name: fn.name, reason: "deprioritized" });
      continue;
    }

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

// External call patterns for tier-1 classification
const EXTERNAL_CALL_PATTERNS = [
  /pool\.query/,
  /\.query\s*\(/,
  /fetch\s*\(/,
  /axios\./,
  /prisma\./,
  /client\.send/,
  /grpc\./,
];

// Complex branching patterns for tier-3 classification
const COMPLEX_BRANCHING_PATTERNS = [
  /if\s*\(.*\)\s*\{[\s\S]*else/,
  /switch\s*\(/,
  /try\s*\{[\s\S]*catch/,
];

export function classifyPriority(
  _functionName: string,
  functionBody: string,
  isExportedAsync?: boolean,
): number {
  // Tier 1: External calls
  if (EXTERNAL_CALL_PATTERNS.some((p) => p.test(functionBody))) {
    return 1;
  }

  // Tier 2: Exported async functions (entry points)
  // Check body for export async pattern if flag not provided
  if (isExportedAsync ?? /export\s+async\s+function/.test(functionBody)) {
    return 2;
  }

  // Tier 3: Complex branching
  if (COMPLEX_BRANCHING_PATTERNS.some((p) => p.test(functionBody))) {
    return 3;
  }

  // Tier 4: Everything else
  return 4;
}

function deriveNamespace(filePath: string): string {
  // src/services/user-service.ts -> user_service
  const basename = filePath.split("/").pop()?.replace(/\.ts$/, "") ?? "unknown";
  return basename.replace(/-/g, "_");
}
