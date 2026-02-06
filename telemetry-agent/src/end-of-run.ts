// ABOUTME: End-of-run validation — runs tests with Weaver live-check integration.
// ABOUTME: Orchestrates test execution with OTLP override and compliance reporting.

import { execSync } from "node:child_process";
import { isWeaverInstalled, startWeaverLiveCheck } from "./weaver.js";
import type { Config } from "./config.js";
import type { EndOfRunResult } from "./coordinator.js";

export async function runTests(
  repoPath: string,
  testCommand: string,
  env?: Record<string, string>
): Promise<{ passed: boolean; output: string }> {
  try {
    const output = execSync(testCommand, {
      cwd: repoPath,
      stdio: "pipe",
      env: { ...process.env, ...env },
      timeout: 120000,
      shell: "/bin/bash",
    }).toString();
    return { passed: true, output };
  } catch (err: unknown) {
    const message = err instanceof Error ? (err as { stdout?: Buffer }).stdout?.toString() ?? err.message : String(err);
    return { passed: false, output: message };
  }
}

export async function runEndOfRunValidation(
  repoPath: string,
  config: Config
): Promise<EndOfRunResult> {
  // Skip if no test command
  if (!config.testCommand) {
    return {
      testsRan: false,
      testsPassed: false,
      testOutput: "",
      skipped: true,
      skipReason: "No test command configured",
    };
  }

  // Check Weaver availability
  const weaverAvailable = await isWeaverInstalled();
  if (!weaverAvailable) {
    // Run tests without Weaver live-check
    const testResult = await runTests(repoPath, config.testCommand);
    return {
      testsRan: true,
      testsPassed: testResult.passed,
      testOutput: testResult.output,
      skipped: true,
      skipReason: "Weaver not installed — tests ran without live-check",
    };
  }

  // Attempt to start Weaver live-check
  try {
    const handle = await startWeaverLiveCheck(config.schemaPath);

    // Run tests with OTLP endpoint override
    const testResult = await runTests(repoPath, config.testCommand, {
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${handle.grpcPort}`,
    });

    // Stop Weaver and get compliance report
    await handle.stop();

    return {
      testsRan: true,
      testsPassed: testResult.passed,
      testOutput: testResult.output,
      skipped: false,
      skipReason: null,
    };
  } catch {
    // Weaver failed to start — skip gracefully
    return {
      testsRan: false,
      testsPassed: false,
      testOutput: "",
      skipped: true,
      skipReason: "Weaver live-check failed to start",
    };
  }
}
