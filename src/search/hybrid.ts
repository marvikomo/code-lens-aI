import type { Driver } from "neo4j-driver";
import { searchFTS, type SearchHit, type FtsOptions } from "./fts";
import { searchVector, type VectorOptions } from "./vector";

export interface HybridOptions extends FtsOptions, VectorOptions {
  /** RRF constant. 60 is the de facto default. */
  rrfK?: number;
}

/**
 * Hybrid keyword + semantic search via Reciprocal Rank Fusion.
 *
 * Pulls top-(limit*3) from FTS and from vector search in parallel, then
 * combines using RRF (rank-based, scale-free). Hits matched by both methods
 * naturally score higher.
 */
export async function searchHybrid(
  driver: Driver,
  query: string,
  opts: HybridOptions = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 20;
  const fanout = limit * 3;
  const k = opts.rrfK ?? 60;

  const [fts, vec] = await Promise.all([
    searchFTS(driver, query, { ...opts, limit: fanout }).catch((e) => {
      console.error(`[hybrid] FTS leg failed: ${(e as Error).message}`);
      return [] as SearchHit[];
    }),
    searchVector(driver, query, { ...opts, limit: fanout }).catch((e) => {
      console.error(`[hybrid] vector leg failed: ${(e as Error).message}`);
      return [] as SearchHit[];
    }),
  ]);

  const fused = new Map<string, SearchHit>();

  fts.forEach((hit, rank) => {
    const score = 1 / (k + rank + 1);
    fused.set(hit.id, { ...hit, score, matchedBy: ["fts"] });
  });

  vec.forEach((hit, rank) => {
    const score = 1 / (k + rank + 1);
    const existing = fused.get(hit.id);
    if (existing) {
      existing.score += score;
      existing.matchedBy = [...existing.matchedBy, "vector"];
    } else {
      fused.set(hit.id, { ...hit, score, matchedBy: ["vector"] });
    }
  });

  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
