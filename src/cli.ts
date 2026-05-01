#!/usr/bin/env node
import "dotenv/config";
import fs from "fs";
import path from "path";
import { analyzeRepository } from "./analyser/analyser";
import { indexToNeo4j } from "./indexers/neo4j";

interface CliArgs {
  repo: string;
  out?: string;
  ignore: string[];
  pretty: boolean;
  noResolveCalls: boolean;
  stats: boolean;
  noJson: boolean;
  // Neo4j
  neo4jUri?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
  neo4jDatabase?: string;
  neo4jClear: boolean;
  neo4jSkipUnresolved: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repo: "",
    ignore: [],
    pretty: true,
    noResolveCalls: false,
    stats: false,
    noJson: false,
    neo4jClear: false,
    neo4jSkipUnresolved: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-o":
      case "--out":
        args.out = argv[++i];
        break;
      case "--ignore":
        args.ignore.push(...(argv[++i] ?? "").split(",").filter(Boolean));
        break;
      case "--no-pretty":
        args.pretty = false;
        break;
      case "--no-resolve-calls":
        args.noResolveCalls = true;
        break;
      case "--stats":
        args.stats = true;
        break;
      case "--no-json":
        args.noJson = true;
        break;
      case "--neo4j-uri":
        args.neo4jUri = argv[++i];
        break;
      case "--neo4j-user":
        args.neo4jUser = argv[++i];
        break;
      case "--neo4j-password":
        args.neo4jPassword = argv[++i];
        break;
      case "--neo4j-database":
        args.neo4jDatabase = argv[++i];
        break;
      case "--neo4j-clear":
        args.neo4jClear = true;
        break;
      case "--neo4j-skip-unresolved":
        args.neo4jSkipUnresolved = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        rest.push(a);
    }
  }
  args.repo = rest[0] ?? ".";

  // Env-var fallbacks for credentials.
  args.neo4jUri ??= process.env.NEO4J_URI;
  args.neo4jUser ??= process.env.NEO4J_USER;
  args.neo4jPassword ??= process.env.NEO4J_PASSWORD;
  args.neo4jDatabase ??= process.env.NEO4J_DATABASE;
  return args;
}

function printHelp(): void {
  console.log(
    `ast-graph - build a code graph from a repository (JS/TS/Java)

Usage:
  ast-graph <repo-path> [options]

General:
  -o, --out <file>             Write JSON to file (default: stdout)
      --ignore <a,b,c>         Extra folder/file names to ignore
      --no-pretty              Compact JSON output
      --no-resolve-calls       Keep CALLS edges fully unresolved
      --no-json                Do not emit JSON (use with --neo4j-uri)
      --stats                  Print summary stats to stderr

Neo4j (also reads NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD / NEO4J_DATABASE):
      --neo4j-uri <uri>        e.g. bolt://localhost:7687  or  neo4j+s://...
      --neo4j-user <name>
      --neo4j-password <pw>
      --neo4j-database <name>
      --neo4j-clear            DETACH DELETE all :CodeNode before indexing
      --neo4j-skip-unresolved  Skip edges whose target was never resolved

  -h, --help                   Show this help`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repo) {
    printHelp();
    process.exit(1);
  }

  console.error(`[ast-graph] analysing ${path.resolve(args.repo)} ...`);
  const graph = analyzeRepository(args.repo, {
    ignore: args.ignore,
    resolveCallsByName: !args.noResolveCalls,
  });

  if (args.stats) {
    const counts: Record<string, number> = {};
    for (const n of graph.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    const eCounts: Record<string, number> = {};
    for (const e of graph.edges) eCounts[e.kind] = (eCounts[e.kind] ?? 0) + 1;
    console.error("[ast-graph] node counts:", counts);
    console.error("[ast-graph] edge counts:", eCounts);
  }

  // ── JSON output ─────────────────────────────────────────────────────
  if (!args.noJson) {
    // Strip the live graphlib reference from the JSON payload.
    const payload = { nodes: graph.nodes, edges: graph.edges };
    const json = args.pretty
      ? JSON.stringify(payload, null, 2)
      : JSON.stringify(payload);

    if (args.out) {
      const outPath = path.resolve(args.out);
      fs.writeFileSync(outPath, json, "utf8");
      console.error(`[ast-graph] wrote ${outPath}`);
    } else if (!args.neo4jUri) {
      // Only stream to stdout if we're not also writing to neo4j (keeps logs clean).
      process.stdout.write(json + "\n");
    }
  }

  // ── Neo4j indexing ─────────────────────────────────────────────────
  if (args.neo4jUri) {
    if (!args.neo4jUser || !args.neo4jPassword) {
      console.error(
        "[ast-graph] --neo4j-uri requires --neo4j-user and --neo4j-password (or NEO4J_USER / NEO4J_PASSWORD env vars)",
      );
      process.exit(2);
    }
    console.error(`[ast-graph] indexing into Neo4j at ${args.neo4jUri} ...`);
    const result = await indexToNeo4j(graph, {
      uri: args.neo4jUri,
      user: args.neo4jUser,
      password: args.neo4jPassword,
      database: args.neo4jDatabase,
      clear: args.neo4jClear,
      skipUnresolved: args.neo4jSkipUnresolved,
    });
    console.error(
      `[ast-graph] indexed ${result.nodesWritten} nodes, ${result.edgesWritten} edges`,
    );
  }
}

main().catch((err: unknown) => {
  console.error("[ast-graph] error:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
