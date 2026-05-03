#!/usr/bin/env ts-node
/**
 * Smoke test for the MCP server: spawns it as a child process, lists tools,
 * and runs a couple of representative tool calls. Run via:
 *   npx ts-node scripts/mcp-smoke.ts
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["ts-node", path.resolve(__dirname, "..", "src", "cli.ts"), "--mcp"],
    env: { ...process.env } as Record<string, string>,
    stderr: "inherit",
  });

  const client = new Client({ name: "smoke-test", version: "0.0.1" });
  await client.connect(transport);
  console.log("[smoke] connected");

  // 1. List tools.
  const tools = await client.listTools();
  console.log(`[smoke] tools advertised: ${tools.tools.length}`);
  for (const t of tools.tools) {
    console.log(`  - ${t.name}`);
  }

  // 2. Call get_overview (no input args).
  console.log("[smoke] calling get_overview ...");
  const overview = await client.callTool({
    name: "get_overview",
    arguments: {},
  });
  const overviewText = (overview.content as Array<{ type: string; text: string }>)
    .map((c) => c.text)
    .join("\n");
  console.log(overviewText.slice(0, 800));
  console.log(overviewText.length > 800 ? "...[truncated for smoke test]" : "");

  // 3. Call search_code with a representative query.
  console.log("\n[smoke] calling search_code('classify intent') ...");
  const search = await client.callTool({
    name: "search_code",
    arguments: { query: "classify intent", limit: 3 },
  });
  const searchText = (search.content as Array<{ type: string; text: string }>)
    .map((c) => c.text)
    .join("\n");
  console.log(searchText);

  await client.close();
  console.log("\n[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
