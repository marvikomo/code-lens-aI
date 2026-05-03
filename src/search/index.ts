import type { Driver, ManagedTransaction } from "neo4j-driver";
import { searchFTS } from "./fts";
import { searchVector } from "./vector";
import { searchHybrid, type HybridOptions } from "./hybrid";
import type { SearchHit } from "./fts";

export type SearchMode = "fts" | "vector" | "hybrid";

export interface SearchOptions extends HybridOptions {
  /** Override autodetection. If omitted, picks 'hybrid' when embeddings exist, else 'fts'. */
  mode?: SearchMode;
}

export type { SearchHit };

/**
 * Top-level search entry point. Dispatches to FTS, vector, or hybrid based on
 * `opts.mode`. When mode is omitted, autodetects: 'hybrid' if any node has an
 * embedding, otherwise 'fts'.
 */
export async function search(
  driver: Driver,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const mode = opts.mode ?? (await autodetectMode(driver, opts.database));
  switch (mode) {
    case "fts":
      return searchFTS(driver, query, opts);
    case "vector":
      return searchVector(driver, query, opts);
    case "hybrid":
      return searchHybrid(driver, query, opts);
  }
}

/** Returns 'hybrid' if at least one CodeNode has an embedding, otherwise 'fts'. */
export async function autodetectMode(
  driver: Driver,
  database?: string,
): Promise<SearchMode> {
  const sessionConfig = database ? { database } : {};
  const session = driver.session(sessionConfig);
  try {
    const result = await session.executeRead((tx: ManagedTransaction) =>
      tx.run(
        `MATCH (n:CodeNode) WHERE n.embedding IS NOT NULL
         RETURN count(n) AS c LIMIT 1`,
      ),
    );
    const c = result.records[0]?.get("c");
    const count = typeof c === "number" ? c : Number(c?.toNumber?.() ?? 0);
    return count > 0 ? "hybrid" : "fts";
  } finally {
    await session.close();
  }
}
