import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../server";
import { readQuery, asNumber, textResult } from "../util";

export function registerGetOverview(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "get_overview",
    {
      title: "High-level codebase overview",
      description:
        "Return a fast structural summary: total counts by node kind, language distribution, " +
        "top architectural communities (subsystems detected via Leiden), and the spine files " +
        "in each community (most central, by PageRank+boundary). " +
        "Use this as the FIRST tool when starting work on an unfamiliar codebase to orient yourself.",
      inputSchema: {},
    },
    async () => {
      const [counts, languages, communities] = await Promise.all([
        readQuery(
          ctx,
          `MATCH (n:CodeNode)
           WITH labels(n) AS labels, n
           UNWIND labels AS l
           WITH l, count(*) AS c WHERE l <> 'CodeNode'
           RETURN l AS kind, c AS count ORDER BY count DESC`,
        ),
        readQuery(
          ctx,
          `MATCH (f:File) WHERE f.language IS NOT NULL
           RETURN f.language AS language, count(*) AS count ORDER BY count DESC`,
        ),
        readQuery(
          ctx,
          `MATCH (c:Community)<-[:IN_COMMUNITY]-(f:File)
           OPTIONAL MATCH (c)<-[:IN_COMMUNITY]-(spine:File {is_core: true})
           WITH c, count(DISTINCT f) AS size,
                collect(DISTINCT spine.name)[..6] AS spine,
                collect(DISTINCT f.name)[..3] AS sample
           RETURN c.communityId AS id, size, spine, sample
           ORDER BY size DESC LIMIT 12`,
        ),
      ]);

      const out: string[] = [];
      out.push("# Codebase overview");
      out.push("");
      out.push("## Node counts");
      for (const r of counts) {
        out.push(`- ${r.kind}: ${asNumber(r.count)}`);
      }
      out.push("");
      out.push("## Language distribution (files)");
      for (const r of languages) {
        out.push(`- ${r.language}: ${asNumber(r.count)}`);
      }
      out.push("");
      if (communities.length === 0) {
        out.push(
          "## Communities\n(none — run `--cluster` to detect architectural subsystems)",
        );
      } else {
        out.push("## Top architectural communities (Leiden + spine)");
        for (const r of communities) {
          const id = asNumber(r.id);
          const size = asNumber(r.size);
          const spine = (r.spine as string[]) ?? [];
          const sample = (r.sample as string[]) ?? [];
          out.push(
            `- **community-${id}** (${size} files)` +
              (spine.length ? `\n    spine: ${spine.join(", ")}` : "") +
              (sample.length ? `\n    e.g.: ${sample.join(", ")}` : ""),
          );
        }
      }
      return textResult(out.join("\n"));
    },
  );
}
