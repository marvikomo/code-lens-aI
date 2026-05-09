import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../server";
import { readQuery, asNumber, nodeKind, textResult, int } from "../util";

const getCalleesSchema: Record<string, any> = {
  symbol: z.string().describe("Name of the calling function/method to expand."),
  file: z
    .string()
    .optional()
    .describe("Disambiguate when the name is common (substring match on path)."),
  depth: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Hops to traverse (default 1)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max callees (default 30)."),
};

export function registerGetCallees(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "get_callees",
    {
      title: "Find what a symbol calls",
      description:
        "List the functions/methods that the given symbol CALLS — its outbound dependencies. " +
        "Use this to answer 'what does X depend on?' or 'what library/internal calls happen inside X?'. " +
        "depth=1 returns direct callees; higher depths walk transitively. " +
        "Callees may include `:Unresolved` placeholder nodes — these are calls to symbols not " +
        "found in the indexed code (typically library or builtin methods).",
      inputSchema: getCalleesSchema,
    },
    async ({ symbol, file, depth, limit }) => {
      const d = depth ?? 1;
      const lim = limit ?? 30;
      const fileFilter = file ? "AND src.path CONTAINS $file" : "";
      const params: Record<string, unknown> = {
        symbol,
        lim: int(lim),
      };
      if (file) params.file = file;

      const records = await readQuery(
        ctx,
        `MATCH (src:CodeNode { name: $symbol })
         WHERE src:Function OR src:Method ${fileFilter}
         WITH src LIMIT 5
         MATCH (src)-[r:CALLS*1..${d}]->(target)
         WITH DISTINCT target, size(r) AS distance
         RETURN target, distance
         ORDER BY distance, target.name
         LIMIT $lim`,
        params,
      );

      if (records.length === 0) {
        return textResult(
          `No callees found for "${symbol}"${file ? ` in ${file}` : ""}.`,
        );
      }

      const lines = records.map((r) => {
        const target = r.target as {
          properties: Record<string, unknown>;
          labels: string[];
        };
        const p = target.properties;
        const k = nodeKind(target.labels);
        const distance = asNumber(r.distance);
        const name = p.name ?? p.symbol ?? "(unknown)";
        const loc = p.path
          ? `${p.path}:${(asNumber(p.startRow) ?? 0) + 1}`
          : "(external)";
        return `- [d=${distance}] ${k} ${name}\n    ${loc}`;
      });

      return textResult(
        `${records.length} callee(s) of "${symbol}" (depth ≤ ${d}):\n\n` +
          lines.join("\n"),
      );
    },
  );
}
