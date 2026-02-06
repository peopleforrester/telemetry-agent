// ABOUTME: Per-file validation chain — syntax check, lint (Prettier), Weaver static check.
// ABOUTME: Runs steps in order with auto-fix for lint failures and retry limit enforcement.

import * as fs from "node:fs";
import { Project } from "ts-morph";
import { weaverCheck } from "./weaver.js";

export interface ValidationResult {
  passed: boolean;
  step: "syntax" | "lint" | "weaver";
  errors: string[];
  fixable: boolean;
}

export interface ValidationChainResult {
  passed: boolean;
  retries: number;
  failedStep: string | null;
  errors: string[];
}

export async function checkSyntax(filePath: string): Promise<ValidationResult> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("check.ts", content);
    const diagnostics = sf.getPreEmitDiagnostics().filter(
      (d) => d.getCategory() === 1 /* Error */
    );

    const errors = diagnostics.map((d) => {
      const line = d.getLineNumber() ?? 0;
      const msg = d.getMessageText();
      const text = typeof msg === "string" ? msg : msg.getMessageText();
      return `Line ${line}: ${text}`;
    });

    return {
      passed: errors.length === 0,
      step: "syntax",
      errors,
      fixable: false,
    };
  } catch (error) {
    return {
      passed: false,
      step: "syntax",
      errors: [(error as Error).message],
      fixable: false,
    };
  }
}

export async function checkLint(filePath: string): Promise<ValidationResult> {
  try {
    const prettier = await import("prettier");
    const content = fs.readFileSync(filePath, "utf-8");
    const formatted = await prettier.format(content, {
      filepath: filePath,
      parser: "typescript",
    });

    const passed = content === formatted;
    return {
      passed,
      step: "lint",
      errors: passed ? [] : ["File is not formatted according to Prettier"],
      fixable: true,
    };
  } catch (error) {
    return {
      passed: false,
      step: "lint",
      errors: [(error as Error).message],
      fixable: false,
    };
  }
}

export async function fixLint(filePath: string): Promise<void> {
  const prettier = await import("prettier");
  const content = fs.readFileSync(filePath, "utf-8");
  const formatted = await prettier.format(content, {
    filepath: filePath,
    parser: "typescript",
  });
  fs.writeFileSync(filePath, formatted, "utf-8");
}

export async function checkWeaver(
  schemaPath: string
): Promise<ValidationResult> {
  if (!schemaPath) {
    return { passed: true, step: "weaver", errors: [], fixable: false };
  }

  const result = await weaverCheck(schemaPath);
  return {
    passed: result.success,
    step: "weaver",
    errors: result.errors,
    fixable: false,
  };
}

export async function runValidationChain(
  filePath: string,
  schemaPath: string,
  maxRetries: number
): Promise<ValidationChainResult> {
  let retries = 0;

  while (retries <= maxRetries) {
    // Step 1: Syntax check
    const syntaxResult = await checkSyntax(filePath);
    if (!syntaxResult.passed) {
      if (retries >= maxRetries) {
        return {
          passed: false,
          retries,
          failedStep: "syntax",
          errors: syntaxResult.errors,
        };
      }
      retries++;
      continue;
    }

    // Step 2: Lint check
    const lintResult = await checkLint(filePath);
    if (!lintResult.passed) {
      if (lintResult.fixable) {
        await fixLint(filePath);
        retries++;
        continue;
      }
      if (retries >= maxRetries) {
        return {
          passed: false,
          retries,
          failedStep: "lint",
          errors: lintResult.errors,
        };
      }
      retries++;
      continue;
    }

    // Step 3: Weaver check
    if (schemaPath) {
      const weaverResult = await checkWeaver(schemaPath);
      if (!weaverResult.passed) {
        if (retries >= maxRetries) {
          return {
            passed: false,
            retries,
            failedStep: "weaver",
            errors: weaverResult.errors,
          };
        }
        retries++;
        continue;
      }
    }

    // All steps passed
    return { passed: true, retries, failedStep: null, errors: [] };
  }

  return {
    passed: false,
    retries,
    failedStep: "unknown",
    errors: ["Max retries exceeded"],
  };
}
