#!/usr/bin/env ts-node
/**
 * Verify v5 impact_analysis on the stiche backend post-bugfix.
 * Targets chosen to exercise SAFE, FOCUS, and RISKY tiers.
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";

const TARGETS = [
  { symbol: "streamGeneration", note: "39 callers — expect RISKY + truncation + cross-community" },
  { symbol: "getContextAnalysisConfig", note: "20 callers — expect RISKY (boundary) or FOCUS" },
  { symbol: "stripJsonFences", note: "16 callers — expect FOCUS or RISKY" },
  { symbol: "classifyRequirements", note: "Few callers — expect SAFE or FOCUS" },
  { symbol: "isQuestionIntent", note: "Tiny helper — expect SAFE, no spine callers" },
];

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["ts-node", path.resolve(__dirname, "..", "src", "cli.ts"), "--mcp"],
    env: { ...process.env } as Record<string, string>,
    stderr: "ignore",
  });

  const client = new Client({ name: "impact-test", version: "0.0.1" });
  await client.connect(transport);

  for (const t of TARGETS) {
    console.log("\n" + "=".repeat(80));
    console.log(`TARGET: ${t.symbol}`);
    console.log(`NOTE:   ${t.note}`);
    console.log("=".repeat(80));
    const out = await client.callTool({
      name: "impact_analysis",
      arguments: { symbol: t.symbol },
    });
    const text = (out.content as Array<{ text: string }>).map((c) => c.text).join("\n");
    console.log(text);
  }

  await client.close();
}

main().catch((err) => {
  console.error("[impact-test] failed:", err);
  process.exit(1);
});
