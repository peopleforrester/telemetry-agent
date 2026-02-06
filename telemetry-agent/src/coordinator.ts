// ABOUTME: Coordinator core — manages file iteration with snapshot/revert safety.
// ABOUTME: Resolves files, enforces limits, creates branches, and orchestrates agent calls.

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { glob } from "./glob-util.js";
import { createFeatureBranch, snapshotFile, revertFile, commitFiles } from "./git.js";
import { writeResult, aggregateLibraries, type FileResult } from "./results.js";
import { renderSdkInitFile } from "./sdk-renderer.js";
import type { FileSnapshot } from "./git.js";
import type { Config } from "./config.js";

export interface CoordinatorOptions {
  config: Config;
  targetPath: string;
  repoPath: string;
}

export interface FileProcessingContext {
  filePath: string;
  snapshot: FileSnapshot;
  resultDir: string;
}

export type AgentFn = (
  ctx: FileProcessingContext,
  config: Config
) => Promise<FileResult>;

export interface CoordinatorResult {
  branchName: string;
  results: FileResult[];
  globalFailure: string | null;
  postProcess: PostProcessResult | null;
  endOfRun: EndOfRunResult | null;
}

export interface PostProcessResult {
  librariesInstalled: string[];
  sdkFileUpdated: boolean;
  installErrors: string[];
}

export interface EndOfRunResult {
  testsRan: boolean;
  testsPassed: boolean;
  testOutput: string;
  skipped: boolean;
  skipReason: string | null;
}

export async function resolveFiles(
  targetPath: string,
  exclude: string[]
): Promise<string[]> {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [targetPath];
  }

  // Glob for .ts files
  const allFiles = glob(targetPath, "**/*.ts");

  // Apply exclude patterns
  const filtered = allFiles.filter((f) => {
    const rel = path.relative(targetPath, f);
    return !exclude.some((pattern) => matchGlob(rel, pattern));
  });

  return filtered.sort();
}

export function enforceFileLimit(files: string[], limit: number): string[] {
  if (files.length > limit) {
    throw new Error(
      `Found ${files.length} files, max is ${limit}. Target a subdirectory or specific files.`
    );
  }
  return files;
}

export async function processFiles(
  options: CoordinatorOptions,
  agentFn: AgentFn
): Promise<CoordinatorResult> {
  const { config, targetPath, repoPath } = options;
  const results: FileResult[] = [];

  // Create feature branch
  const timestamp = Date.now();
  const branchName = await createFeatureBranch(
    repoPath,
    `telemetry-agent/${timestamp}`
  );

  // Resolve and filter files
  const allFiles = await resolveFiles(targetPath, config.exclude);
  const files = enforceFileLimit(allFiles, 10);

  // Create results directory
  const resultDir = path.join(repoPath, ".telemetry-agent-results");
  fs.mkdirSync(resultDir, { recursive: true });

  // Process each file
  for (const filePath of files) {
    const relPath = path.relative(repoPath, filePath);

    // Snapshot before agent
    const snapshot = await snapshotFile(repoPath, relPath);

    const ctx: FileProcessingContext = {
      filePath: relPath,
      snapshot,
      resultDir,
    };

    const result = await agentFn(ctx, config);

    // If agent failed, revert file
    if (result.status === "failed") {
      await revertFile(repoPath, snapshot);
    }

    // Write result file
    writeResult(resultDir, result);
    results.push(result);
  }

  return {
    branchName,
    results,
    globalFailure: null,
    postProcess: null,
    endOfRun: null,
  };
}

export async function postProcess(
  options: CoordinatorOptions,
  results: FileResult[]
): Promise<PostProcessResult> {
  const { config, repoPath } = options;
  const installErrors: string[] = [];

  // Aggregate libraries from all success results
  const libraries = aggregateLibraries(results);

  if (libraries.length === 0) {
    return { librariesInstalled: [], sdkFileUpdated: false, installErrors: [] };
  }

  // Install dependencies
  const packageNames = libraries.map((l) => l.package);
  const installResult = await installDependencies(repoPath, packageNames);
  if (!installResult.success) {
    installErrors.push(...installResult.errors);
  }

  // Render updated SDK init file
  const sdkPath = path.join(repoPath, config.sdkInitFile);
  let sdkFileUpdated = false;
  if (fs.existsSync(sdkPath)) {
    const existingContent = fs.readFileSync(sdkPath, "utf-8");
    const updatedContent = renderSdkInitFile(existingContent, libraries);
    if (updatedContent !== existingContent) {
      fs.writeFileSync(sdkPath, updatedContent);
      sdkFileUpdated = true;

      // Commit SDK + package files
      const filesToCommit = [config.sdkInitFile];
      if (fs.existsSync(path.join(repoPath, "package.json"))) {
        filesToCommit.push("package.json");
      }
      if (fs.existsSync(path.join(repoPath, "package-lock.json"))) {
        filesToCommit.push("package-lock.json");
      }
      await commitFiles(repoPath, filesToCommit, "Add instrumentation libraries to SDK init");
    }
  }

  return {
    librariesInstalled: packageNames,
    sdkFileUpdated,
    installErrors,
  };
}

export async function installDependencies(
  repoPath: string,
  packages: string[]
): Promise<{ success: boolean; errors: string[] }> {
  try {
    execSync(`npm install --save ${packages.join(" ")}`, {
      cwd: repoPath,
      stdio: "pipe",
      timeout: 60000,
    });
    return { success: true, errors: [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [message] };
  }
}

// Simple glob matching for exclude patterns
function matchGlob(filePath: string, pattern: string): boolean {
  // Convert glob to regex — **/ matches zero or more directories
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*\//g, "@@DSSLASH@@")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/@@DSSLASH@@/g, "(.*/)?");
  return new RegExp(`^${regex}$`).test(filePath);
}
