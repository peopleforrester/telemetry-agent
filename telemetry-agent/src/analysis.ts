// ABOUTME: TypeScript file analysis using ts-morph — imports, frameworks, instrumentation, scope.
// ABOUTME: Detects existing OTel patterns, variable shadowing, and instrumentable functions.

import { Project, SyntaxKind, Node } from "ts-morph";
import { isInAllowlist } from "./allowlist.js";

export interface ImportInfo {
  moduleSpecifier: string;
  namedImports: string[];
  defaultImport: string | null;
}

export interface InstrumentationInfo {
  type: "span" | "tracer" | "import";
  location: { line: number; column: number };
}

export interface ShadowingResult {
  hasShadowing: boolean;
  conflicts: { name: string; existingLocation: { line: number } }[];
}

export interface FunctionInfo {
  name: string;
  isAsync: boolean;
  isExported: boolean;
  startLine: number;
  endLine: number;
  lineCount: number;
}

function createProject(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile("analysis-target.ts", code);
  return sourceFile;
}

export function analyzeImports(fileContent: string): ImportInfo[] {
  const sourceFile = createProject(fileContent);
  const imports = sourceFile.getImportDeclarations();

  return imports.map((imp) => ({
    moduleSpecifier: imp.getModuleSpecifierValue(),
    namedImports: imp.getNamedImports().map((n) => n.getName()),
    defaultImport: imp.getDefaultImport()?.getText() ?? null,
  }));
}

export function detectFrameworks(imports: ImportInfo[]): string[] {
  return imports
    .map((i) => i.moduleSpecifier)
    .filter((mod) => isInAllowlist(mod));
}

export function detectExistingInstrumentation(
  fileContent: string
): InstrumentationInfo[] {
  const results: InstrumentationInfo[] = [];
  const sourceFile = createProject(fileContent);

  // Check for @opentelemetry/api imports
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue().startsWith("@opentelemetry/")) {
      results.push({
        type: "import",
        location: {
          line: imp.getStartLineNumber(),
          column: imp.getStart() - imp.getStartLinePos(),
        },
      });
    }
  }

  // Scan text for tracer patterns
  const text = sourceFile.getFullText();

  const spanPatterns = [
    /tracer\.startActiveSpan/g,
    /tracer\.startSpan/g,
  ];

  for (const pattern of spanPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const pos = sourceFile.getLineAndColumnAtPos(match.index);
      results.push({
        type: "span",
        location: { line: pos.line, column: pos.column },
      });
    }
  }

  const tracerPattern = /trace\.getTracer/g;
  let match;
  while ((match = tracerPattern.exec(text)) !== null) {
    const pos = sourceFile.getLineAndColumnAtPos(match.index);
    results.push({
      type: "tracer",
      location: { line: pos.line, column: pos.column },
    });
  }

  return results;
}

export function checkVariableShadowing(
  fileContent: string,
  variableNames: string[],
  targetFunction: string
): ShadowingResult {
  const sourceFile = createProject(fileContent);
  const conflicts: { name: string; existingLocation: { line: number } }[] = [];

  // Find the target function
  const fn =
    sourceFile.getFunction(targetFunction) ??
    sourceFile
      .getDescendantsOfKind(SyntaxKind.MethodDeclaration)
      .find((m) => m.getName() === targetFunction);

  if (!fn) {
    return { hasShadowing: false, conflicts: [] };
  }

  // Check for variable declarations in the module scope and parent scopes
  for (const name of variableNames) {
    // Check module-level variable declarations
    for (const decl of sourceFile.getVariableDeclarations()) {
      if (decl.getName() === name) {
        conflicts.push({
          name,
          existingLocation: { line: decl.getStartLineNumber() },
        });
      }
    }

    // Check parameter names in the function itself
    if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
      for (const param of fn.getParameters()) {
        if (param.getName() === name) {
          conflicts.push({
            name,
            existingLocation: { line: param.getStartLineNumber() },
          });
        }
      }
    }

    // Check local variables inside the function body
    const body = Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)
      ? fn.getBody()
      : undefined;
    if (body) {
      body.forEachDescendant((node) => {
        if (Node.isVariableDeclaration(node) && node.getName() === name) {
          conflicts.push({
            name,
            existingLocation: { line: node.getStartLineNumber() },
          });
        }
      });
    }
  }

  return {
    hasShadowing: conflicts.length > 0,
    conflicts,
  };
}

export function findInstrumentableFunctions(
  fileContent: string
): FunctionInfo[] {
  const sourceFile = createProject(fileContent);
  const results: FunctionInfo[] = [];
  const MIN_LINES = 4;

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;

    const startLine = fn.getStartLineNumber();
    const endLine = fn.getEndLineNumber();
    const lineCount = endLine - startLine + 1;
    const isAsync = fn.isAsync();
    const isExported = fn.isExported();

    // Skip short synchronous functions with no external calls
    if (!isAsync && lineCount < MIN_LINES + 7) {
      continue;
    }

    // Skip non-exported short functions
    if (!isExported && lineCount < MIN_LINES + 7) {
      continue;
    }

    results.push({ name, isAsync, isExported, startLine, endLine, lineCount });
  }

  return results;
}
