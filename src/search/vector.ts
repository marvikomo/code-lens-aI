import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import type { NodeKind } from "../util/graph";
import { embed } from "../embeddings/local";
import type { SearchHit } from "./fts";

export interface VectorOptions {
  limit?: number;
  kind?: NodeKind;
  snippetChars?: number;
  database?: string;
  /** Override embedding model (must match what was used at index time). */
  model?: string;
}

const VECTOR_INDEX_NAME = "code_vec";

/**
 * Semantic search via Neo4j's vector index. Embeds the query text with the
 * same model used at index time, then runs cosine similarity against the
 * `embedding` property on :CodeNode.
 *
 * Will throw if the vector index doesn't exist or no nodes have embeddings —
 * caller should run the embeddings pipeline first.
 */
export async function searchVector(
  driver: Driver,
  query: string,
  opts: VectorOptions = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 20;
  const snippetChars = opts.snippetChars ?? 280;
  const sessionConfig = opts.database ? { database: opts.database } : {};

  const queryVec = await embed(query, opts.model);

  // Pull more than `limit` so that an optional kind filter still yields enough.
  const fanout = opts.kind ? limit * 4 : limit;

  const cypher = opts.kind
    ? `CALL db.index.vector.queryNodes($index, $k, $vec) YIELD node, score
       WHERE node:\`${opts.kind}\`
       RETURN node, score LIMIT $limit`
    : `CALL db.index.vector.queryNodes($index, $k, $vec) YIELD node, score
       RETURN node, score LIMIT $limit`;

  const session = driver.session(sessionConfig);
  try {
    const result = await session.executeRead((tx: ManagedTransaction) =>
      tx.run(cypher, {
        index: VECTOR_INDEX_NAME,
        k: neo4j.int(fanout),
        vec: queryVec,
        limit: neo4j.int(limit),
      }),
    );
    return result.records.map((r) => {
      const node = r.get("node");
      const rawScore = r.get("score");
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
        score:
          typeof rawScore === "number"
            ? rawScore
            : Number(rawScore?.toNumber?.() ?? 0),
        matchedBy: ["vector" as const],
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
