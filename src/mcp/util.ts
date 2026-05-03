import neo4j, { type ManagedTransaction, type Session } from "neo4j-driver";
import type { ToolContext } from "./server";

/** Wrap a JS number for Cypher LIMIT/SKIP/etc. (Neo4j requires Integer). */
export function int(n: number) {
  return neo4j.int(n);
}

/** A standard MCP text content block. */
export interface TextContent {
  type: "text";
  text: string;
  [key: string]: unknown;
}

/** Wrap a string in MCP's content envelope. */
export function textResult(s: string): { content: TextContent[] } {
  return { content: [{ type: "text", text: s }] };
}

/** Serialize a JSON-friendly object as a fenced JSON block. */
export function jsonResult(o: unknown): { content: TextContent[] } {
  return textResult("```json\n" + JSON.stringify(o, null, 2) + "\n```");
}

/** Run a read-only Cypher query and return the records as plain objects. */
export async function readQuery(
  ctx: ToolContext,
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const session: Session = ctx.driver.session(
    ctx.database ? { database: ctx.database } : {},
  );
  try {
    const result = await session.executeRead((tx: ManagedTransaction) =>
      tx.run(cypher, params),
    );
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}

/** Convert a Neo4j Integer (Int64) or numeric value to a JS number. */
export function asNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "toNumber" in (v as object)) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

/** Recursively convert Neo4j Integers in a value to plain numbers. */
export function unwrap(v: unknown): unknown {
  if (v == null || typeof v !== "object") return v;
  // Neo4j Integer
  if ("low" in v && "high" in v && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  // Neo4j Node
  if ("identity" in v && "labels" in v && "properties" in v) {
    return {
      labels: (v as { labels: string[] }).labels,
      properties: unwrap((v as { properties: unknown }).properties),
    };
  }
  // Neo4j Relationship
  if ("type" in v && "start" in v && "end" in v && "properties" in v) {
    return {
      type: (v as { type: string }).type,
      properties: unwrap((v as { properties: unknown }).properties),
    };
  }
  if (Array.isArray(v)) return v.map(unwrap);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = unwrap(val);
  return out;
}

/** Truncate body text safely for tool output. Default 600 chars. */
export function snippet(body: string | undefined, max = 600): string | undefined {
  if (!body) return undefined;
  if (body.length <= max) return body;
  return body.slice(0, max) + "\n…[truncated]";
}

/** Locate a kind-specific label from a Neo4j node's label array. */
export function nodeKind(labels: string[]): string {
  return labels.find((l) => l !== "CodeNode") ?? "Unknown";
}
