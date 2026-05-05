import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import neo4j, { type Driver } from "neo4j-driver";

import { registerSearchCode } from "./tools/search-code";
import { registerGetDefinition } from "./tools/get-definition";
import { registerReadCode } from "./tools/read-code";
import { registerGetCallers } from "./tools/get-callers";
import { registerGetCallees } from "./tools/get-callees";
import { registerImpactAnalysis } from "./tools/impact-analysis";
import { registerGetOverview } from "./tools/get-overview";
import { registerLabelCommunity } from "./tools/label-community";
import { registerGenerateWiki } from "./tools/generate-wiki";
import { registerCypher } from "./tools/cypher";

export interface McpServerOptions {
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  neo4jDatabase?: string;
}

/**
 * Boots a stdio MCP server backed by the project's Neo4j knowledge graph.
 * Designed to be wired into Claude Desktop / Cursor / Codex via their stdio
 * MCP config. Logs go to stderr (stdout is reserved for the protocol).
 */
export async function startMcpServer(opts: McpServerOptions): Promise<void> {
  const driver: Driver = neo4j.driver(
    opts.neo4jUri,
    neo4j.auth.basic(opts.neo4jUser, opts.neo4jPassword),
  );

  // Probe connection early so misconfig fails fast (before agent calls a tool).
  try {
    const session = driver.session(
      opts.neo4jDatabase ? { database: opts.neo4jDatabase } : {},
    );
    try {
      await session.run("RETURN 1");
    } finally {
      await session.close();
    }
  } catch (err) {
    await driver.close();
    throw new Error(
      `Failed to connect to Neo4j at ${opts.neo4jUri}: ${(err as Error).message}`,
    );
  }

  const server = new McpServer(
    { name: "code-lens-ai", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const ctx = { driver, database: opts.neo4jDatabase };

  registerSearchCode(server, ctx);
  registerGetDefinition(server, ctx);
  registerReadCode(server, ctx);
  registerGetCallers(server, ctx);
  registerGetCallees(server, ctx);
  registerImpactAnalysis(server, ctx);
  registerGetOverview(server, ctx);
  registerLabelCommunity(server, ctx);
  registerGenerateWiki(server, ctx);
  registerCypher(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] code-lens-ai MCP server ready (stdio)");

  // Clean shutdown on signal.
  const shutdown = async () => {
    console.error("[mcp] shutting down");
    await server.close().catch(() => {});
    await driver.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export interface ToolContext {
  driver: Driver;
  database?: string;
}
