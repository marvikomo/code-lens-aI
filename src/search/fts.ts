import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import type { NodeKind } from "../util/graph";

export interface SearchHit {
  id: string;
  kind: NodeKind;
  name: string;
  path?: string;
  language?: string;
  signature?: string;
  bodySnippet?: string;
  startRow?: number;
  endRow?: number;
  score: number;
  matchedBy: ("fts" | "vector")[];
}

export interface FtsOptions {
  limit?: number;
  /** Filter to one node kind (e.g. "Function"). */
  kind?: NodeKind;
  /** Max chars of body returned per hit. Default 280. */
  snippetChars?: number;
  /** Neo4j database name override. */
  database?: string;
}

const FTS_INDEX_NAME = "code_fts";

/**
 * Keyword search via Neo4j's full-text index. Returns nodes ranked by BM25.
 *
 * Query string supports Lucene syntax:
 *   - plain words → OR
 *   - `+term` → required
 *   - `"phrase"` → exact phrase
 *   - `term*` → prefix match
 *   - `term~` → fuzzy match
 *   - `name:term` → restrict to one indexed field
 */
export async function searchFTS(
  driver: Driver,
  query: string,
  opts: FtsOptions = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 20;
  const snippetChars = opts.snippetChars ?? 280;
  const sessionConfig = opts.database ? { database: opts.database } : {};

  const cypher = opts.kind
    ? `CALL db.index.fulltext.queryNodes($index, $q) YIELD node, score
       WHERE node:\`${opts.kind}\`
       RETURN node, score LIMIT $limit`
    : `CALL db.index.fulltext.queryNodes($index, $q) YIELD node, score
       RETURN node, score LIMIT $limit`;

  const session = driver.session(sessionConfig);
  try {
    const result = await session.executeRead((tx: ManagedTransaction) =>
      tx.run(cypher, {
        index: FTS_INDEX_NAME,
        q: query,
        limit: neo4j.int(limit),
      }),
    );
    return result.records.map((r) => {
      const node = r.get("node");
      const score = r.get("score");
      const props = node.properties as Record<string, unknown>;
      const labels = node.labels as string[];
      const kind = (labels.find((l) => l !== "CodeNode") ?? "Unknown") as NodeKind;
      const body = typeof props.body === "string" ? props.body : undefined;
      return {
        id: String(props.id),
        kind,
        name: String(props.name ?? ""),
        path: props.path as string | undefined,
        language: props.language as string | undefined,
        signature: props.signature as string | undefined,
        bodySnippet: body ? body.slice(0, snippetChars) : undefined,
        startRow: numberOf(props.startRow),
        endRow: numberOf(props.endRow),
        score: typeof score === "number" ? score : Number(score?.toNumber?.() ?? 0),
        matchedBy: ["fts"],
      };
    });
  } finally {
    await session.close();
  }
}

function numberOf(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "toNumber" in (v as object)) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}
