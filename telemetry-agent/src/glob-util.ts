// ABOUTME: Thin wrapper around Node.js fs for recursive file globbing.
// ABOUTME: Provides a synchronous glob function matching files by extension pattern.

import * as fs from "node:fs";
import * as path from "node:path";

export function glob(dir: string, pattern: string): string[] {
  const results: string[] = [];
  const ext = extractExtension(pattern);

  walk(dir, ext, results);
  return results;
}

function extractExtension(pattern: string): string {
  // Support patterns like "**/*.ts"
  const match = pattern.match(/\*\.(\w+)$/);
  return match ? `.${match[1]}` : "";
}

function walk(dir: string, ext: string, results: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, ext, results);
    } else if (!ext || entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
}
