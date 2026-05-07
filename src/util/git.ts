import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Thin shell wrappers around `git` CLI for the incremental indexer's
 * git-aware change detection (Mode A in the plan).
 *
 * All commands run with `cwd` set to the target repo. Errors bubble up as
 * thrown `Error`s — callers in the analyser handle fallback to hash-mode.
 */

export interface GitDelta {
  /** Files whose content changed (committed or uncommitted). */
  changed: string[];
  /** Files added (committed or untracked working tree). */
  added: string[];
  /** Files deleted (committed or working tree). */
  deleted: string[];
}

/** True iff `<repo>/.git` exists (file or dir — submodules write a file). */
export function isGitRepo(repoPath: string): boolean {
  const gitDir = path.join(repoPath, ".git");
  try {
    return fs.existsSync(gitDir);
  } catch {
    return false;
  }
}

/** `git rev-parse HEAD` — current commit hash, or null if no commits yet. */
export function gitHeadCommit(repoPath: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoPath,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * `git merge-base --is-ancestor <commit> HEAD` — true iff `commit` is reachable
 * from HEAD. Used to detect force-push / rewritten history; if the previously
 * indexed commit is no longer reachable, we can't compute a diff and must fall
 * back to hash-mode for that run.
 */
export function gitIsAncestor(repoPath: string, commit: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
      cwd: repoPath,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * `git diff --name-status <since>..HEAD`. Returns absolute paths grouped by
 * change type. `since` is the previously-indexed commit; the diff captures
 * everything that landed since.
 */
export function gitCommitDelta(repoPath: string, since: string): GitDelta {
  const out = execFileSync(
    "git",
    ["diff", "--name-status", "-z", `${since}..HEAD`],
    { cwd: repoPath, encoding: "utf8" },
  );
  return parseNameStatusZ(out, repoPath);
}

/**
 * `git status --porcelain -uall -z`. Returns paths in the working tree that
 * differ from HEAD (uncommitted edits, staged changes, untracked, deletions).
 */
export function gitWorkingTreeDelta(repoPath: string): GitDelta {
  const out = execFileSync(
    "git",
    ["status", "--porcelain", "-uall", "-z"],
    { cwd: repoPath, encoding: "utf8" },
  );
  return parsePorcelainZ(out, repoPath);
}

/** True iff `git status --porcelain` is empty (working tree clean). */
export function gitWorkingTreeClean(repoPath: string): boolean {
  const out = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoPath,
    encoding: "utf8",
  });
  return out.trim().length === 0;
}

/**
 * Clone `url` into `targetDir`. Throws on failure (caller decides whether to
 * surface or retry).
 */
export function gitClone(url: string, targetDir: string): void {
  execFileSync("git", ["clone", url, targetDir], { stdio: "inherit" });
}

/**
 * Sync an existing clone: fetch + hard-reset to the remote default branch.
 * Cache is ours, so any local edits are intentionally discarded.
 */
export function gitFetchReset(repoPath: string): void {
  execFileSync("git", ["fetch", "origin"], {
    cwd: repoPath,
    stdio: "inherit",
  });
  // Resolve the remote's default branch (e.g. "main" / "master").
  const ref = execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    { cwd: repoPath, encoding: "utf8" },
  )
    .trim()
    .replace(/^refs\/remotes\//, ""); // → "origin/main"
  execFileSync("git", ["reset", "--hard", ref], {
    cwd: repoPath,
    stdio: "inherit",
  });
}

// ─── parsers ─────────────────────────────────────────────────────────────

function parseNameStatusZ(out: string, repoPath: string): GitDelta {
  const delta: GitDelta = { changed: [], added: [], deleted: [] };
  // -z `--name-status` output: each entry is two NUL-separated tokens
  // (`<status>`, `<path>`). Renames/copies have three tokens
  // (`R<score>`, `<old>`, `<new>`).
  const tokens = out.split("\0").filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i];
    const code = status[0];
    if (code === "R" || code === "C") {
      const oldPath = tokens[++i];
      const newPath = tokens[++i];
      if (oldPath) delta.deleted.push(absJoin(repoPath, oldPath));
      if (newPath) delta.added.push(absJoin(repoPath, newPath));
    } else {
      const file = tokens[++i];
      if (!file) continue;
      if (code === "A") delta.added.push(absJoin(repoPath, file));
      else if (code === "D") delta.deleted.push(absJoin(repoPath, file));
      else delta.changed.push(absJoin(repoPath, file)); // M / T / U
    }
  }
  return delta;
}

function parsePorcelainZ(out: string, repoPath: string): GitDelta {
  const delta: GitDelta = { changed: [], added: [], deleted: [] };
  // Porcelain v1: each entry is `XY <path>\0` (renames are `R  <new>\0<old>\0`).
  // X = staged status, Y = working tree status. ?? is untracked.
  const tokens = out.split("\0").filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 4) continue;
    const xy = tok.slice(0, 2);
    const file = tok.slice(3);
    if (xy[0] === "R" || xy[1] === "R") {
      // Rename: next token is the OLD path.
      const oldPath = tokens[++i];
      if (oldPath) delta.deleted.push(absJoin(repoPath, oldPath));
      delta.added.push(absJoin(repoPath, file));
    } else if (xy === "??") {
      delta.added.push(absJoin(repoPath, file));
    } else if (xy[0] === "D" || xy[1] === "D") {
      delta.deleted.push(absJoin(repoPath, file));
    } else if (xy[0] === "A" || xy[1] === "A") {
      delta.added.push(absJoin(repoPath, file));
    } else {
      delta.changed.push(absJoin(repoPath, file));
    }
  }
  return delta;
}

function absJoin(repoPath: string, rel: string): string {
  return path.resolve(repoPath, rel);
}

/** Merge two GitDeltas into one, deduping paths and resolving conflicts. */
export function mergeDeltas(a: GitDelta, b: GitDelta): GitDelta {
  const deleted = new Set([...a.deleted, ...b.deleted]);
  const addedRaw = new Set([...a.added, ...b.added]);
  const changedRaw = new Set([...a.changed, ...b.changed]);
  // If a path appears in both deleted and added/changed, the working-tree
  // state wins — treat it as added (file currently exists on disk).
  for (const p of deleted) {
    if (addedRaw.has(p) || changedRaw.has(p)) deleted.delete(p);
  }
  // Added supersedes changed for the same path.
  for (const p of addedRaw) changedRaw.delete(p);
  return {
    changed: [...changedRaw],
    added: [...addedRaw],
    deleted: [...deleted],
  };
}
