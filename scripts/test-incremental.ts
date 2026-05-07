#!/usr/bin/env ts-node
/**
 * End-to-end verification of the incremental indexing pipeline.
 *
 * Each test case sets up an isolated temp git repo (or non-git folder),
 * shells out to the CLI with --incremental, and queries Neo4j to verify the
 * graph reflects what happened on disk.
 *
 * Run: npx ts-node scripts/test-incremental.ts
 */
import "dotenv/config";
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import neo4j, { Driver } from "neo4j-driver";

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

const NEO4J_URI = process.env.NEO4J_URI ?? "neo4j://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "password";

function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  const tag = passed ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}`);
  if (detail) console.log(`        ${detail}`);
}

function makeTempRepo(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `code-lens-${prefix}-`));
  return dir;
}

function gitInit(dir: string): void {
  execSync("git init -q && git config user.email t@t && git config user.name t", {
    cwd: dir,
  });
}

function gitCommit(dir: string, msg: string): void {
  execSync(`git add -A && git -c commit.gpgsign=false commit -q -m "${msg}"`, {
    cwd: dir,
  });
}

function runCli(repo: string): { stdout: string; stderr: string; ok: boolean } {
  const r = spawnSync(
    "npx",
    [
      "ts-node",
      path.resolve(__dirname, "..", "src", "cli.ts"),
      repo,
      "--no-json",
      "--incremental",
      "--neo4j-uri",
      NEO4J_URI,
      "--neo4j-user",
      NEO4J_USER,
      "--neo4j-password",
      NEO4J_PASSWORD,
    ],
    { encoding: "utf8" },
  );
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    ok: r.status === 0,
  };
}

async function withDriver<T>(fn: (d: Driver) => Promise<T>): Promise<T> {
  const d = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  try {
    return await fn(d);
  } finally {
    await d.close();
  }
}

async function fileNodeMeta(
  repo: string,
  filePath: string,
): Promise<{ contentHash: string | null; lastIndexed: string | null } | null> {
  return await withDriver(async (d) => {
    const s = d.session();
    try {
      const r = await s.run(
        `MATCH (f:File { path: $p }) RETURN f.contentHash AS h, f.lastIndexed AS t LIMIT 1`,
        { p: filePath },
      );
      if (r.records.length === 0) return null;
      return {
        contentHash: r.records[0].get("h"),
        lastIndexed: r.records[0].get("t"),
      };
    } finally {
      await s.close();
    }
  });
}

async function repoMeta(
  repo: string,
): Promise<{ lastCommit: string | null; indexedAt: string | null } | null> {
  return await withDriver(async (d) => {
    const s = d.session();
    try {
      const r = await s.run(
        `MATCH (r:Repository { path: $p })
         RETURN r.lastCommit AS c, r.lastIndexed AS t LIMIT 1`,
        { p: repo },
      );
      if (r.records.length === 0) return null;
      return {
        lastCommit: r.records[0].get("c"),
        indexedAt: r.records[0].get("t"),
      };
    } finally {
      await s.close();
    }
  });
}

async function fileExists(repo: string, filePath: string): Promise<boolean> {
  return await withDriver(async (d) => {
    const s = d.session();
    try {
      const r = await s.run(
        `MATCH (f:File { path: $p }) RETURN count(f) AS n`,
        { p: filePath },
      );
      const n = r.records[0].get("n");
      return Number((n as { low?: number }).low ?? n) > 0;
    } finally {
      await s.close();
    }
  });
}

async function clearReposByPath(prefix: string): Promise<void> {
  await withDriver(async (d) => {
    const s = d.session();
    try {
      await s.run(
        `MATCH (n:CodeNode) WHERE n.path STARTS WITH $p DETACH DELETE n`,
        { p: prefix },
      );
    } finally {
      await s.close();
    }
  });
}

// ─── Fixtures ──────────────────────────────────────────────────────────

function writeBaseFixture(dir: string): void {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "util.ts"),
    `export function helper(x: number): number { return x * 2; }\n`,
  );
  fs.writeFileSync(
    path.join(dir, "src", "service.ts"),
    `import { helper } from "./util";\nexport function compute(): number { return helper(21); }\n`,
  );
  fs.writeFileSync(
    path.join(dir, "src", "main.ts"),
    `import { compute } from "./service";\nexport function run(): number { return compute(); }\n`,
  );
}

// ─── Test cases ────────────────────────────────────────────────────────

async function caseColdGitIndex(): Promise<void> {
  const repo = makeTempRepo("cold-git");
  try {
    writeBaseFixture(repo);
    gitInit(repo);
    gitCommit(repo, "init");
    const head = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();

    const r = runCli(repo);
    if (!r.ok) {
      record("cold git index runs", false, `CLI failed: ${r.stderr.slice(0, 200)}`);
      return;
    }
    record("cold git index runs", true, "CLI exited cleanly");

    const meta = await repoMeta(repo);
    record(
      "cold git index stamps repo lastCommit",
      meta?.lastCommit === head,
      `expected ${head.slice(0, 12)}, got ${(meta?.lastCommit ?? "null").slice(0, 12)}`,
    );

    const util = await fileNodeMeta(repo, path.join(repo, "src", "util.ts"));
    record(
      "cold git index stamps File contentHash + lastIndexed",
      !!util?.contentHash && !!util?.lastIndexed,
      `hash=${(util?.contentHash ?? "missing").slice(0, 12)}, t=${util?.lastIndexed ?? "missing"}`,
    );
  } finally {
    await clearReposByPath(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

async function caseGitFastPath(): Promise<void> {
  const repo = makeTempRepo("fast-path");
  try {
    writeBaseFixture(repo);
    gitInit(repo);
    gitCommit(repo, "init");

    runCli(repo); // cold
    const r = runCli(repo); // re-run, no edits
    record(
      "git fast-path: no-op re-run prints 'already up to date'",
      r.stderr.includes("already up to date"),
      r.stderr.split("\n").find((l) => l.includes("up to date")) ?? "(line not found)",
    );
  } finally {
    await clearReposByPath(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

async function caseSingleLeafEdit(): Promise<void> {
  const repo = makeTempRepo("leaf-edit");
  try {
    writeBaseFixture(repo);
    gitInit(repo);
    gitCommit(repo, "init");
    runCli(repo); // cold

    const beforeUtil = await fileNodeMeta(repo, path.join(repo, "src", "util.ts"));
    const beforeMain = await fileNodeMeta(repo, path.join(repo, "src", "main.ts"));

    // Wait briefly so timestamps differ.
    await new Promise((res) => setTimeout(res, 50));

    // Edit the LEAF file (main.ts — nothing imports from it)
    fs.appendFileSync(path.join(repo, "src", "main.ts"), `\n// edit\n`);
    gitCommit(repo, "edit main");

    runCli(repo);

    const afterUtil = await fileNodeMeta(repo, path.join(repo, "src", "util.ts"));
    const afterMain = await fileNodeMeta(repo, path.join(repo, "src", "main.ts"));

    record(
      "leaf edit: edited file's lastIndexed bumped",
      !!afterMain?.lastIndexed && afterMain.lastIndexed !== beforeMain?.lastIndexed,
      `before=${beforeMain?.lastIndexed} after=${afterMain?.lastIndexed}`,
    );
    record(
      "leaf edit: unrelated file's lastIndexed UNCHANGED",
      afterUtil?.lastIndexed === beforeUtil?.lastIndexed,
      `before=${beforeUtil?.lastIndexed} after=${afterUtil?.lastIndexed}`,
    );
  } finally {
    await clearReposByPath(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

async function caseCascadeOnImportedFile(): Promise<void> {
  const repo = makeTempRepo("cascade");
  try {
    writeBaseFixture(repo);
    gitInit(repo);
    gitCommit(repo, "init");
    runCli(repo); // cold

    const beforeMain = await fileNodeMeta(repo, path.join(repo, "src", "main.ts"));
    const beforeService = await fileNodeMeta(repo, path.join(repo, "src", "service.ts"));

    await new Promise((res) => setTimeout(res, 50));

    // Edit util.ts — both service.ts and (transitively) main.ts depend on it.
    // Direct importer cascade: service.ts must be re-extracted.
    fs.appendFileSync(path.join(repo, "src", "util.ts"), `\n// edit\n`);
    gitCommit(repo, "edit util");

    runCli(repo);

    const afterService = await fileNodeMeta(repo, path.join(repo, "src", "service.ts"));
    record(
      "cascade: direct importer (service.ts) was re-extracted",
      afterService?.lastIndexed !== beforeService?.lastIndexed,
      `before=${beforeService?.lastIndexed} after=${afterService?.lastIndexed}`,
    );

    // CALLS edge from compute() → helper() should still resolve correctly.
    const callsResolved = await withDriver(async (d) => {
      const s = d.session();
      try {
        const r = await s.run(
          `MATCH (f1:File { path: $sp })-[:DEFINES]->(caller:Function { name: "compute" })
                 -[:CALLS]->(callee:Function { name: "helper" })<-[:DEFINES]-(f2:File { path: $up })
           RETURN count(*) AS n`,
          {
            sp: path.join(repo, "src", "service.ts"),
            up: path.join(repo, "src", "util.ts"),
          },
        );
        return Number(r.records[0].get("n"));
      } finally {
        await s.close();
      }
    });
    record(
      "cascade: CALLS edge compute→helper still resolves after cascade",
      callsResolved > 0,
      `count=${callsResolved}`,
    );
    void beforeMain;
  } finally {
    await clearReposByPath(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

async function caseFileAdded(): Promise<void> {
  const repo = makeTempRepo("added");
  try {
    writeBaseFixture(repo);
    gitInit(repo);
    gitCommit(repo, "init");
    runCli(repo); // cold

    fs.writeFileSync(
      path.join(repo, "src", "newcomer.ts"),
      `export function brandNew(): string { return "hi"; }\n`,
    );
    gitCommit(repo, "add newcomer");

    runCli(repo);

    const exists = await fileExists(repo, path.join(repo, "src", "newcomer.ts"));
    record("added file: File node exists post-incremental", exists, `exists=${exists}`);
  } finally {
    await clearReposByPath(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

async function caseFileDeleted(): Promise<void> {
  const repo = makeTempRepo("deleted");
  try {
    writeBaseFixture(repo);
    fs.writeFileSync(
      path.join(repo, "src", "doomed.ts"),
      `export function doomed(): void {}\n`,
    );
    gitInit(repo);
    gitCommit(repo, "init");
    runCli(repo); // cold

    const beforeExists = await fileExists(repo, path.join(repo, "src", "doomed.ts"));

    fs.unlinkSync(path.join(repo, "src", "doomed.ts"));
    gitCommit(repo, "rm doomed");

    runCli(repo);

    const afterExists = await fileExists(repo, path.join(repo, "src", "doomed.ts"));
    record(
      "deleted file: File node removed",
      beforeExists && !afterExists,
      `before=${beforeExists}, after=${afterExists}`,
    );
  } finally {
    await clearReposByPath(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

async function caseUncommittedEdit(): Promise<void> {
  const repo = makeTempRepo("uncommitted");
  try {
    writeBaseFixture(repo);
    gitInit(repo);
    gitCommit(repo, "init");
    runCli(repo); // cold

    const beforeMain = await fileNodeMeta(repo, path.join(repo, "src", "main.ts"));
    await new Promise((res) => setTimeout(res, 50));

    // Edit but DON'T commit.
    fs.appendFileSync(path.join(repo, "src", "main.ts"), `\n// dirty\n`);

    runCli(repo);

    const afterMain = await fileNodeMeta(repo, path.join(repo, "src", "main.ts"));
    record(
      "uncommitted edit: detected via git status, file re-indexed",
      afterMain?.lastIndexed !== beforeMain?.lastIndexed,
      `before=${beforeMain?.lastIndexed} after=${afterMain?.lastIndexed}`,
    );
  } finally {
    await clearReposByPath(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

async function caseHashModeNonGit(): Promise<void> {
  const repo = makeTempRepo("hash-mode");
  try {
    writeBaseFixture(repo);
    // No `git init` — this should trigger Mode B (hash).
    runCli(repo); // cold

    const beforeMain = await fileNodeMeta(repo, path.join(repo, "src", "main.ts"));
    record(
      "hash mode (non-git) cold index stamps contentHash",
      !!beforeMain?.contentHash,
      `hash=${beforeMain?.contentHash?.slice(0, 12) ?? "missing"}`,
    );

    await new Promise((res) => setTimeout(res, 50));
    fs.appendFileSync(path.join(repo, "src", "main.ts"), `\n// hash-edit\n`);

    const r = runCli(repo);
    record(
      "hash mode: re-run uses 'hash' delta (banner present)",
      r.stderr.includes("hash delta"),
      r.stderr.split("\n").find((l) => l.includes("delta")) ?? "(no delta line)",
    );

    const afterMain = await fileNodeMeta(repo, path.join(repo, "src", "main.ts"));
    record(
      "hash mode: edited file re-indexed",
      afterMain?.lastIndexed !== beforeMain?.lastIndexed && afterMain?.contentHash !== beforeMain?.contentHash,
      `hash before=${beforeMain?.contentHash?.slice(0, 12)} after=${afterMain?.contentHash?.slice(0, 12)}`,
    );
  } finally {
    await clearReposByPath(repo);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("=== Incremental indexing test harness ===\n");

  const cases: Array<[string, () => Promise<void>]> = [
    ["1. cold git index", caseColdGitIndex],
    ["2. git fast-path on no-op", caseGitFastPath],
    ["3. single leaf edit", caseSingleLeafEdit],
    ["4. cascade on imported file", caseCascadeOnImportedFile],
    ["5. file added", caseFileAdded],
    ["6. file deleted", caseFileDeleted],
    ["7. uncommitted working-tree edit", caseUncommittedEdit],
    ["8. hash mode (non-git fallback)", caseHashModeNonGit],
  ];

  for (const [label, fn] of cases) {
    console.log(`\n--- ${label} ---`);
    try {
      await fn();
    } catch (e) {
      record(label, false, `threw: ${(e as Error).message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}`);
      console.log(`    ${r.detail}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[test-incremental] fatal:", e);
  process.exit(1);
});
