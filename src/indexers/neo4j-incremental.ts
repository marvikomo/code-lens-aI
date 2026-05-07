import neo4j, { Driver, ManagedTransaction } from "neo4j-driver";

/**
 * Neo4j helpers used by the incremental indexer:
 *   - reading prior-run state (file hashes, repo meta)
 *   - scoped deletion of a file's subgraph
 *   - dependents-cascade lookups
 *
 * These helpers all open and close their own driver — keeps the call-site in
 * the analyser simple. For tight loops we'd inject a shared driver, but the
 * incremental path runs each helper once per indexing invocation.
 */

export interface IncrementalCtx {
  uri: string;
  user: string;
  password: string;
  database?: string;
}

function makeDriver(ctx: IncrementalCtx): Driver {
  return neo4j.driver(ctx.uri, neo4j.auth.basic(ctx.user, ctx.password));
}

function sessionConfig(ctx: IncrementalCtx) {
  return ctx.database ? { database: ctx.database } : {};
}

export interface RepositoryMeta {
  path: string;
  lastCommit: string | null;
  sourceUrl: string | null;
  indexedAt: string | null;
}

/**
 * Read repository-level metadata from the `:Repository` node for a given
 * absolute path. Returns null if no Repository node exists yet (cold cache).
 */
export async function getRepositoryMeta(
  ctx: IncrementalCtx,
  repoPath: string,
): Promise<RepositoryMeta | null> {
  const driver = makeDriver(ctx);
  const session = driver.session(sessionConfig(ctx));
  try {
    const res = await session.run(
      `MATCH (r:Repository { path: $path })
       RETURN r.path AS path, r.lastCommit AS lastCommit,
              r.sourceUrl AS sourceUrl, r.lastIndexed AS indexedAt
       LIMIT 1`,
      { path: repoPath },
    );
    if (res.records.length === 0) return null;
    const r = res.records[0];
    return {
      path: r.get("path"),
      lastCommit: r.get("lastCommit") ?? null,
      sourceUrl: r.get("sourceUrl") ?? null,
      indexedAt: r.get("indexedAt") ?? null,
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

/** Stamp commit/url/indexedAt on the :Repository node. */
export async function setRepositoryMeta(
  ctx: IncrementalCtx,
  repoPath: string,
  meta: { lastCommit?: string | null; sourceUrl?: string | null; indexedAt: string },
): Promise<void> {
  const driver = makeDriver(ctx);
  const session = driver.session(sessionConfig(ctx));
  try {
    await session.executeWrite((tx: ManagedTransaction) =>
      tx.run(
        `MATCH (r:Repository { path: $path })
         SET r.lastIndexed = $indexedAt
         FOREACH (_ IN CASE WHEN $lastCommit IS NULL THEN [] ELSE [1] END |
           SET r.lastCommit = $lastCommit
         )
         FOREACH (_ IN CASE WHEN $sourceUrl IS NULL THEN [] ELSE [1] END |
           SET r.sourceUrl = $sourceUrl
         )`,
        {
          path: repoPath,
          indexedAt: meta.indexedAt,
          lastCommit: meta.lastCommit ?? null,
          sourceUrl: meta.sourceUrl ?? null,
        },
      ),
    );
  } finally {
    await session.close();
    await driver.close();
  }
}

/**
 * Read all `(path, contentHash)` pairs for File nodes under a given repo.
 * Returns a Map keyed by absolute path.
 */
export async function getFileHashes(
  ctx: IncrementalCtx,
  repoPath: string,
): Promise<Map<string, string>> {
  const driver = makeDriver(ctx);
  const session = driver.session(sessionConfig(ctx));
  try {
    const res = await session.run(
      `MATCH (f:File)
       WHERE f.path STARTS WITH $prefix AND f.contentHash IS NOT NULL
       RETURN f.path AS path, f.contentHash AS hash`,
      { prefix: repoPath },
    );
    const m = new Map<string, string>();
    for (const r of res.records) {
      m.set(r.get("path"), r.get("hash"));
    }
    return m;
  } finally {
    await session.close();
    await driver.close();
  }
}

/**
 * Compute the dependents cascade: for each path in `paths`, collect file
 * paths that either import the file or have CALLS into its symbols.
 *
 * Returns the union of all dependents (deduped). The originating paths are
 * NOT included — caller unions them itself.
 */
export async function getDependents(
  ctx: IncrementalCtx,
  paths: string[],
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const driver = makeDriver(ctx);
  const session = driver.session(sessionConfig(ctx));
  try {
    const res = await session.run(
      `UNWIND $paths AS p
       MATCH (f:File { path: p })
       OPTIONAL MATCH (importer:File)-[:IMPORTS]->(f)
       OPTIONAL MATCH (caller:File)-[:DEFINES]->()-[:CALLS]->()<-[:DEFINES]-(f)
       WITH coalesce(importer.path, caller.path) AS dep, p
       WHERE dep IS NOT NULL AND dep <> p
       RETURN DISTINCT dep`,
      { paths },
    );
    const out = new Set<string>();
    for (const r of res.records) out.add(r.get("dep"));
    // Don't include the originating paths in the cascade.
    for (const p of paths) out.delete(p);
    return out;
  } finally {
    await session.close();
    await driver.close();
  }
}

/**
 * Delete File nodes (and everything they DEFINE, transitively) for the given
 * absolute paths. DETACH deletion also strips all relationships touching the
 * deleted nodes — including stale CALLS edges from dependents.
 */
export async function deleteFilesByPath(
  ctx: IncrementalCtx,
  paths: string[],
): Promise<{ deletedNodes: number }> {
  if (paths.length === 0) return { deletedNodes: 0 };
  const driver = makeDriver(ctx);
  const session = driver.session(sessionConfig(ctx));
  try {
    const res = await session.executeWrite((tx: ManagedTransaction) =>
      tx.run(
        `UNWIND $paths AS p
         MATCH (f:File { path: p })
         OPTIONAL MATCH (f)-[:DEFINES*1..]->(sym)
         WITH f, collect(DISTINCT sym) AS syms
         FOREACH (s IN syms | DETACH DELETE s)
         DETACH DELETE f
         RETURN count(*) AS n`,
        { paths },
      ),
    );
    const n = res.records[0]?.get("n");
    const num = typeof n === "object" && n !== null && "low" in (n as object)
      ? (n as { low: number }).low
      : Number(n ?? 0);
    return { deletedNodes: num };
  } finally {
    await session.close();
    await driver.close();
  }
}
