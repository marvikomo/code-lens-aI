import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../server";
import { readQuery, asNumber, textResult, int } from "../util";

const impactAnalysisSchema: Record<string, any> = {
  symbol: z.string().describe("Symbol name (function/method/class) to analyze."),
  file: z
    .string()
    .optional()
    .describe("Disambiguate by file substring when the name is common."),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Max transitive caller depth (default 3)."),
};

export function registerImpactAnalysis(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "impact_analysis",
    {
      title: "Blast-radius analysis for a symbol change",
      description:
        "Compute the impact of changing a symbol — direct callers, transitive callers, " +
        "affected files, affected communities (architectural subsystems), and a coarse risk " +
        "score. Use BEFORE making non-trivial edits to surface what else needs to be checked. " +
        "If the target is on the spine of its community (is_core=true), the change is more " +
        "central and risk is higher.",
      inputSchema: impactAnalysisSchema,
    },
    async ({ symbol, file, maxDepth }) => {
      const d = maxDepth ?? 3;
      const fileFilter = file ? "AND target.path CONTAINS $file" : "";
      const params: Record<string, unknown> = { symbol, d: int(d) };
      if (file) params.file = file;

      const records = await readQuery(
        ctx,
        `MATCH (target:CodeNode { name: $symbol })
         WHERE (target:Function OR target:Method OR target:Class) ${fileFilter}
         WITH target LIMIT 1
         OPTIONAL MATCH (direct)-[:CALLS]->(target)
         WITH target, collect(DISTINCT direct) AS directs
         OPTIONAL MATCH (trans)-[:CALLS*1..${d}]->(target)
         WITH target, directs, collect(DISTINCT trans) AS transitives
         OPTIONAL MATCH (target)<-[:DEFINES]-(file:File)
         OPTIONAL MATCH (file)-[:IN_COMMUNITY]->(c:Community)
         RETURN
           target,
           file,
           c,
           file.is_core AS isCore,
           file.pagerank AS pagerank,
           file.boundary AS boundary,
           [d IN directs WHERE d IS NOT NULL | { name: d.name, path: d.path, startRow: d.startRow }] AS direct,
           [t IN transitives WHERE t IS NOT NULL | { name: t.name, path: t.path }] AS transitive`,
        params,
      );

      if (records.length === 0) {
        return textResult(`No symbol named "${symbol}" found.`);
      }
      const r = records[0];
      const target = r.target as {
        properties: Record<string, unknown>;
      } | null;
      if (!target) {
        return textResult(`No symbol named "${symbol}" found.`);
      }
      const file_ = r.file as { properties: Record<string, unknown> } | null;
      const community = r.c as { properties: Record<string, unknown> } | null;
      const isCore = !!r.isCore;
      const pagerank = asNumber(r.pagerank);
      const boundary = asNumber(r.boundary);
      const direct = (r.direct as Array<Record<string, unknown>>) ?? [];
      const transitive = (r.transitive as Array<Record<string, unknown>>) ?? [];

      const filesAffected = new Set<string>();
      for (const x of [...direct, ...transitive]) {
        if (x.path) filesAffected.add(String(x.path));
      }

      // Coarse risk: weights are intentionally simple; revise after real-world use.
      const risk =
        direct.length * 1 +
        (transitive.length - direct.length) * 0.3 +
        (isCore ? 10 : 0) +
        (boundary ?? 0) * 0.5;

      const out: string[] = [];
      out.push(`# Impact analysis for \`${target.properties.name}\``);
      if (file_) {
        out.push(
          `**File:** ${file_.properties.path}:${(asNumber(target.properties.startRow) ?? 0) + 1}`,
        );
      }
      if (community) {
        out.push(
          `**Community:** ${community.properties.communityId}` +
            (isCore ? "  ⚠️ **spine file (is_core)**" : ""),
        );
      }
      if (pagerank !== undefined) {
        out.push(`**PageRank:** ${pagerank.toFixed(3)}, **boundary:** ${boundary}`);
      }
      out.push("");
      out.push(`**Direct callers:** ${direct.length}`);
      out.push(`**Transitive callers (depth ≤ ${d}):** ${transitive.length}`);
      out.push(`**Files affected:** ${filesAffected.size}`);
      out.push(`**Coarse risk score:** ${risk.toFixed(1)}`);
      if (direct.length > 0) {
        out.push("");
        out.push("## Direct callers");
        for (const c of direct.slice(0, 20)) {
          out.push(
            `- ${c.name} (${c.path}:${(asNumber(c.startRow) ?? 0) + 1})`,
          );
        }
        if (direct.length > 20) out.push(`… and ${direct.length - 20} more`);
      }
      return textResult(out.join("\n"));
    },
  );
}
