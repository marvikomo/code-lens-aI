import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../server";
import { writeQuery, textResult, int } from "../util";

const labelCommunitySchema: Record<string, any> = {
  communityId: z
    .number()
    .int()
    .describe("The integer community id from get_overview."),
  label: z
    .string()
    .min(1)
    .max(60)
    .describe(
      "Short human-readable name (2-4 words, kebab or snake case, e.g. 'auth-pipeline', 'user-flow-handlers').",
    ),
  description: z
    .string()
    .max(500)
    .optional()
    .describe(
      "One-sentence description of what files in this community share.",
    ),
};

/**
 * Lets the agent attach a semantic label and optional description to a
 * Leiden community. Labels persist across --cluster-only reruns (the
 * materialization MERGE preserves them on ON MATCH); they are wiped by
 * --neo4j-clear (intentional).
 *
 * Designed to be called on first connect after `get_overview` shows the
 * "ACTION REQUIRED" hint listing unlabeled communities.
 */
export function registerLabelCommunity(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "label_community",
    {
      title: "Label a community with a human-readable name",
      description:
        "Attach a short semantic label (and optional description) to a community " +
        "detected by Leiden clustering. Use this on first connect when get_overview " +
        "shows unlabeled communities — pick a 2-4 word name describing what the " +
        "community does, based on its spine files and sample. Labels persist across " +
        "re-clustering until --neo4j-clear is used. Subsequent get_overview calls " +
        "show your label instead of community-N.",
      inputSchema: labelCommunitySchema,
    },
    async ({ communityId, label, description }) => {
      const params: Record<string, unknown> = {
        cid: int(communityId),
        label,
      };
      let cypher = `MATCH (c:Community { communityId: $cid })
        SET c.label = $label`;
      if (description) {
        cypher += `, c.description = $description`;
        params.description = description;
      }
      cypher += ` RETURN c.communityId AS id, c.label AS label`;

      const records = await writeQuery(ctx, cypher, params);
      if (records.length === 0) {
        return textResult(
          `No community with id ${communityId} — was it materialized? ` +
            `(communities below --cluster-min-size aren't materialized as nodes)`,
        );
      }
      return textResult(`Labeled community ${communityId}: "${label}"`);
    },
  );
}
