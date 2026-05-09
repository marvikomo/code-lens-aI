import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../server";
import { readQuery, asNumber, nodeKind, textResult, int } from "../util";

const getCallersSchema: Record<string, any> = {
  symbol: z
    .string()
    .describe("Name of the called function/method to look up callers for."),
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
    .describe("Max callers (default 20)."),
};

export function registerGetCallers(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "get_callers",
    {
      title: "Find who calls a symbol",
      description:
        "List the Function/Method nodes that CALL the given symbol — its inbound dependencies. " +
        "Use this to answer 'who uses X?' or 'what would break if I changed X?'. " +
        "depth=1 returns direct callers; higher depths walk the call graph transitively. " +
        "If the symbol name is ambiguous, use get_definition first to identify the right id.",
      inputSchema: getCallersSchema,
    },
    async ({ symbol, depth, limit }) => {
      const d = depth ?? 1;
      const lim = limit ?? 20;

      // Resolve the symbol to actual node ids first (handles unresolved targets too).
      // `r` from `[r:CALLS*1..N]` is a List<Relationship>; use `size(r)` not
      // `length(r)` (length() is for Path values, hence the Neo4j type-mismatch
      // error this tool used to throw on depth=1).
      const records = await readQuery(
        ctx,
        `MATCH (caller:CodeNode)-[r:CALLS*1..${d}]->(target)
         WHERE target.name = $symbol OR target.symbol = $symbol
         WITH caller, size(r) AS distance, target
         RETURN DISTINCT caller, distance, target.name AS targetName, target.path AS targetPath
         ORDER BY distance, caller.path
         LIMIT $lim`,
        { symbol, lim: int(lim) },
      );

      if (records.length === 0) {
        return textResult(`No callers found for "${symbol}" within depth ${d}.`);
      }

      const lines = records.map((r) => {
        const caller = r.caller as {
          properties: Record<string, unknown>;
          labels: string[];
        };
        const p = caller.properties;
        const k = nodeKind(caller.labels);
        const distance = asNumber(r.distance);
        const startRow = asNumber(p.startRow) ?? 0;
        return (
          `- [d=${distance}] ${k} ${p.name}\n` +
          `    ${p.path}:${startRow + 1}`
        );
      });

      return textResult(
        `${records.length} caller(s) of "${symbol}" (depth ≤ ${d}):\n\n` +
          lines.join("\n"),
      );
    },
  );
}
