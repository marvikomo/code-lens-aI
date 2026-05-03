import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../server";
import { readQuery, asNumber, nodeKind, textResult } from "../util";

const getDefinitionSchema: Record<string, any> = {
  name: z.string().describe("Exact symbol name (function/class/method/etc)."),
  file: z
    .string()
    .optional()
    .describe("Filter to definitions in this file path (substring match)."),
  kind: z
    .enum([
      "Function",
      "Method",
      "Class",
      "Interface",
      "TypeAlias",
      "Enum",
      "Property",
    ])
    .optional()
    .describe("Restrict to one node kind."),
};

export function registerGetDefinition(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "get_definition",
    {
      title: "Get full definition of a symbol",
      description:
        "Fetch the full source body, signature, and location of a symbol by name. " +
        "Returns ALL matches (a name like 'parse' may appear in many files). " +
        "Use after search_code to get the actual code, or directly when you know the symbol name. " +
        "If multiple matches and you need to disambiguate, pass the file param.",
      inputSchema: getDefinitionSchema,
    },
    async ({ name, file, kind }) => {
      const where: string[] = ["n.name = $name"];
      const params: Record<string, unknown> = { name };
      if (file) {
        where.push("n.path CONTAINS $file");
        params.file = file;
      }
      if (kind) where.push(`n:\`${kind}\``);

      const records = await readQuery(
        ctx,
        `MATCH (n:CodeNode)
         WHERE ${where.join(" AND ")}
         RETURN n
         ORDER BY n.path, n.startRow
         LIMIT 20`,
        params,
      );

      if (records.length === 0) {
        return textResult(
          `No definition found for "${name}"` +
            (file ? ` in files matching "${file}"` : "") +
            ".",
        );
      }

      const blocks = records.map((r, i) => {
        const node = r.n as {
          properties: Record<string, unknown>;
          labels: string[];
        };
        const p = node.properties;
        const k = nodeKind(node.labels);
        const startRow = asNumber(p.startRow) ?? 0;
        const endRow = asNumber(p.endRow) ?? 0;
        const truncated = p.bodyTruncated ? " (truncated)" : "";
        const header = `## ${i + 1}. ${k} \`${p.name}\` — ${p.path}:${startRow + 1}-${endRow + 1}${truncated}`;
        const sig = p.signature
          ? `\n\nSignature:\n\`\`\`${p.language ?? ""}\n${p.signature}\n\`\`\``
          : "";
        const body = p.body
          ? `\n\nBody:\n\`\`\`${p.language ?? ""}\n${p.body}\n\`\`\``
          : "\n\n(no body stored)";
        return header + sig + body;
      });

      return textResult(
        `Found ${records.length} definition(s) of "${name}":\n\n` +
          blocks.join("\n\n---\n\n"),
      );
    },
  );
}
