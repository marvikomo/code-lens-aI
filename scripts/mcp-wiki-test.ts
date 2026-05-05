#!/usr/bin/env ts-node
/**
 * Manual run of generate_wiki against whatever's currently in Neo4j.
 * Prints the rendered markdown so you can eyeball the structure.
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
    stderr: "ignore",
  });

  const client = new Client({ name: "wiki-test", version: "0.0.1" });
  await client.connect(transport);

  console.error("[wiki-test] calling generate_wiki ...");
  const out = await client.callTool({
    name: "generate_wiki",
    arguments: {},
  });
  const text = (out.content as Array<{ text: string }>)
    .map((c) => c.text)
    .join("\n");
  console.log(text);

  await client.close();
}

main().catch((err) => {
  console.error("[wiki-test] failed:", err);
  process.exit(1);
});
