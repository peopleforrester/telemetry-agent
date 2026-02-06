// ABOUTME: Git operations wrapper using simple-git for branch, snapshot, revert, commit.
// ABOUTME: Provides file-level snapshot/revert for safe agent processing with rollback.

import * as fs from "node:fs";
import * as path from "node:path";
import { simpleGit } from "simple-git";

export interface FileSnapshot {
  filePath: string;
  commitSha: string | null;
  content: string;
}

export async function createFeatureBranch(
  repoPath: string,
  branchName: string
): Promise<string> {
  const git = simpleGit(repoPath);
  await git.checkoutLocalBranch(branchName);
  return branchName;
}

export async function snapshotFile(
  repoPath: string,
  filePath: string
): Promise<FileSnapshot> {
  const fullPath = path.join(repoPath, filePath);
  const content = fs.readFileSync(fullPath, "utf-8");

  const git = simpleGit(repoPath);
  let commitSha: string | null = null;

  try {
    const log = await git.log({ file: filePath, maxCount: 1 });
    if (log.latest) {
      commitSha = log.latest.hash;
    }
  } catch {
    // File not tracked — commitSha stays null
  }

  return { filePath, commitSha, content };
}

export async function revertFile(
  repoPath: string,
  snapshot: FileSnapshot
): Promise<void> {
  const fullPath = path.join(repoPath, snapshot.filePath);
  fs.writeFileSync(fullPath, snapshot.content, "utf-8");

  if (snapshot.commitSha) {
    // Reset any staged changes for this file
    const git = simpleGit(repoPath);
    try {
      await git.checkout(["--", snapshot.filePath]);
    } catch {
      // File may not be staged; writing content back is sufficient
    }
  }
}

export async function commitFile(
  repoPath: string,
  filePath: string,
  message: string
): Promise<string> {
  return commitFiles(repoPath, [filePath], message);
}

export async function commitFiles(
  repoPath: string,
  files: string[],
  message: string
): Promise<string> {
  const git = simpleGit(repoPath);
  await git.add(files);
  const result = await git.commit(message);
  return result.commit;
}

export async function isClean(repoPath: string): Promise<boolean> {
  const git = simpleGit(repoPath);
  const status = await git.status();
  return status.isClean();
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const status = await git.status();
  return status.current ?? "";
}
