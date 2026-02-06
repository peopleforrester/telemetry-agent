// ABOUTME: Tests for the git operations wrapper — branch, snapshot, revert, commit.
// ABOUTME: Uses temp git repos for each test to validate git state management.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";

import {
  createFeatureBranch,
  snapshotFile,
  revertFile,
  commitFile,
  commitFiles,
  isClean,
  getCurrentBranch,
} from "../git.js";

function makeTempRepo(): string {
  const dir = path.join(os.tmpdir(), `git-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir });
  execSync("git config user.email 'test@test.com'", { cwd: dir });
  execSync("git config user.name 'Test'", { cwd: dir });
  // Create initial commit so we have a branch
  fs.writeFileSync(path.join(dir, "README.md"), "init\n");
  execSync("git add README.md && git commit -m 'init'", { cwd: dir });
  return dir;
}

describe("git operations", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("createFeatureBranch creates and checks out new branch", async () => {
    const branch = await createFeatureBranch(repoDir, "telemetry-agent/test-123");
    expect(branch).toBe("telemetry-agent/test-123");
    const current = await getCurrentBranch(repoDir);
    expect(current).toBe("telemetry-agent/test-123");
  });

  it("snapshotFile captures file content and commit SHA", async () => {
    const filePath = "src/test.ts";
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "const x = 1;\n");
    execSync(`git add "${filePath}" && git commit -m "add test file"`, { cwd: repoDir });

    const snapshot = await snapshotFile(repoDir, filePath);
    expect(snapshot.filePath).toBe(filePath);
    expect(snapshot.content).toBe("const x = 1;\n");
    expect(snapshot.commitSha).toBeTruthy();
    expect(snapshot.commitSha!.length).toBeGreaterThan(6);
  });

  it("snapshotFile handles untracked file (commitSha is null)", async () => {
    const filePath = "src/new.ts";
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "const y = 2;\n");

    const snapshot = await snapshotFile(repoDir, filePath);
    expect(snapshot.commitSha).toBeNull();
    expect(snapshot.content).toBe("const y = 2;\n");
  });

  it("revertFile restores file to snapshot state after modification", async () => {
    const filePath = "src/test.ts";
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "original content\n");
    execSync(`git add "${filePath}" && git commit -m "add file"`, { cwd: repoDir });

    const snapshot = await snapshotFile(repoDir, filePath);

    // Modify the file
    fs.writeFileSync(fullPath, "BROKEN CONTENT\n");
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("BROKEN CONTENT\n");

    await revertFile(repoDir, snapshot);
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("original content\n");
  });

  it("revertFile restores untracked file", async () => {
    const filePath = "src/untracked.ts";
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "untracked original\n");

    const snapshot = await snapshotFile(repoDir, filePath);

    fs.writeFileSync(fullPath, "MODIFIED\n");
    await revertFile(repoDir, snapshot);
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("untracked original\n");
  });

  it("commitFile stages and commits, returns SHA", async () => {
    const filePath = "src/commit-test.ts";
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "commit me\n");

    const sha = await commitFile(repoDir, filePath, "add commit-test");
    expect(sha).toBeTruthy();
    expect(sha.length).toBeGreaterThan(6);

    // Verify file is committed
    const clean = await isClean(repoDir);
    expect(clean).toBe(true);
  });

  it("commitFiles commits multiple files", async () => {
    const files = ["src/a.ts", "src/b.ts"];
    for (const f of files) {
      const fp = path.join(repoDir, f);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, `content of ${f}\n`);
    }

    const sha = await commitFiles(repoDir, files, "add multiple");
    expect(sha).toBeTruthy();
    expect(await isClean(repoDir)).toBe(true);
  });

  it("isClean returns true when clean, false when dirty", async () => {
    expect(await isClean(repoDir)).toBe(true);

    fs.writeFileSync(path.join(repoDir, "dirty.txt"), "dirty\n");
    expect(await isClean(repoDir)).toBe(false);
  });

  it("getCurrentBranch returns correct branch name", async () => {
    const branch = await getCurrentBranch(repoDir);
    // Initial branch is usually "main" or "master"
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });
});
