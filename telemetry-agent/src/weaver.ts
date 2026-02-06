// ABOUTME: Weaver CLI wrapper — typed interface to weaver registry commands.
// ABOUTME: Provides check, resolve, live-check operations with parsed output types.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChildProcess } from "node:child_process";

const execFileAsync = promisify(execFile);

export interface WeaverCheckResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

export interface WeaverResolveResult {
  groups: WeaverGroup[];
  raw: unknown;
}

export interface WeaverGroup {
  id: string;
  type: string;
  brief: string;
  attributes: WeaverAttribute[];
}

export interface WeaverAttribute {
  id?: string;
  ref?: string;
  type?: string;
  requirement_level?: string;
}

export interface WeaverLiveCheckHandle {
  process: ChildProcess;
  grpcPort: number;
  httpPort: number;
  stop: () => Promise<WeaverComplianceReport>;
}

export interface WeaverComplianceReport {
  raw: string;
}

export function buildCheckArgs(registryPath: string): string[] {
  return ["registry", "check", "-r", registryPath];
}

export function buildResolveArgs(registryPath: string): string[] {
  return ["registry", "resolve", "-r", registryPath, "-f", "json"];
}

export function parseCheckOutput(
  stdout: string,
  stderr: string,
  exitCode: number
): WeaverCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const combined = `${stdout}\n${stderr}`.trim();
  for (const line of combined.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("error:")) {
      errors.push(trimmed);
    } else if (trimmed.startsWith("warning:")) {
      warnings.push(trimmed);
    }
  }

  return {
    success: exitCode === 0 && errors.length === 0,
    errors,
    warnings,
  };
}

export function parseResolveOutput(jsonOutput: string): WeaverResolveResult {
  const raw = JSON.parse(jsonOutput);
  const groups: WeaverGroup[] = (Array.isArray(raw) ? raw : []).map(
    (g: Record<string, unknown>) => ({
      id: g.id as string,
      type: g.type as string,
      brief: (g.brief as string) ?? "",
      attributes: ((g.attributes as Record<string, unknown>[]) ?? []).map(
        (a) => ({
          id: a.id as string | undefined,
          ref: a.ref as string | undefined,
          type: a.type as string | undefined,
          requirement_level: a.requirement_level as string | undefined,
        })
      ),
    })
  );

  return { groups, raw };
}

export async function weaverCheck(
  registryPath: string
): Promise<WeaverCheckResult> {
  const args = buildCheckArgs(registryPath);
  try {
    const { stdout, stderr } = await execFileAsync("weaver", args);
    return parseCheckOutput(stdout, stderr, 0);
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return parseCheckOutput(
      err.stdout ?? "",
      err.stderr ?? "",
      err.code ?? 1
    );
  }
}

export async function weaverResolve(
  registryPath: string
): Promise<WeaverResolveResult> {
  const args = buildResolveArgs(registryPath);
  const { stdout } = await execFileAsync("weaver", args);
  return parseResolveOutput(stdout);
}

export async function startWeaverLiveCheck(
  registryPath: string,
  opts?: { grpcPort?: number; httpPort?: number }
): Promise<WeaverLiveCheckHandle> {
  const { spawn } = await import("node:child_process");
  const grpcPort = opts?.grpcPort ?? 4317;
  const httpPort = opts?.httpPort ?? 4320;

  const child = spawn("weaver", [
    "registry",
    "live-check",
    "-r",
    registryPath,
    "--grpc-port",
    String(grpcPort),
    "--http-port",
    String(httpPort),
  ]);

  return {
    process: child,
    grpcPort,
    httpPort,
    stop: async () => {
      try {
        const response = await fetch(
          `http://localhost:${httpPort}/stop`,
          { method: "POST" }
        );
        const raw = await response.text();
        return { raw };
      } catch {
        child.kill();
        return { raw: "" };
      }
    },
  };
}

export async function isWeaverInstalled(): Promise<boolean> {
  try {
    await execFileAsync("weaver", ["--version"]);
    return true;
  } catch {
    return false;
  }
}
