#!/usr/bin/env ts-node
/**
 * End-to-end test of the label_community tool:
 *   1. Label community 0
 *   2. Re-fetch overview, verify the label shows up
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
    // Use "ignore" rather than "inherit" — inherited stderr keeps the parent
    // pipe open after client.close(), causing the test wrapper (e.g. `tail`)
    // to hang waiting for EOF.
    stderr: "ignore",
  });

  const client = new Client({ name: "label-test", version: "0.0.1" });
  await client.connect(transport);

  console.log("[test] labeling community 0 as 'plan-pipeline' ...");
  const labelResult = await client.callTool({
    name: "label_community",
    arguments: {
      communityId: 0,
      label: "plan-pipeline",
      description: "Plan agent + requirements derivation pipeline (smoke-test label).",
    },
  });
  console.log(
    (labelResult.content as Array<{ text: string }>).map((c) => c.text).join("\n"),
  );

  console.log("\n[test] fetching overview, looking for label ...");
  const overview = await client.callTool({
    name: "get_overview",
    arguments: {},
  });
  const text = (overview.content as Array<{ text: string }>)
    .map((c) => c.text)
    .join("\n");

  // Find the line that mentions community 0
  const lines = text.split("\n");
  const idx = lines.findIndex((l) =>
    l.includes("community 0") || l.includes("community-0"),
  );
  if (idx >= 0) {
    console.log("---");
    console.log(lines.slice(idx, idx + 4).join("\n"));
    console.log("---");
  } else {
    console.log("(no line mentioning community 0 found in overview)");
  }

  if (text.includes("plan-pipeline")) {
    console.log("\n[test] OK — label is present in overview output");
  } else {
    console.error("\n[test] FAIL — label not found in overview");
    process.exit(1);
  }

  await client.close();
}

main().catch((err) => {
  console.error("[test] failed:", err);
  process.exit(1);
});
