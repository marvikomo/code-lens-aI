# code-lens-aI

**A code-intelligence MCP server for AI agents.** Index a codebase once, then ask Claude / Cursor / any MCP client to understand it — with answers grounded in the real call graph, real architectural subsystems, and real source code, not hallucinated guesses.

Built on Tree-sitter + Neo4j + Leiden community detection. JS / TS / Java today, polyglot-ready.

---

## 🌟 The two killer features

### `generate_wiki` — Wiki skeleton in one MCP call

Without it: Claude in your IDE opens an unfamiliar codebase and burns ~30 tool calls (`cat`, `ls`, `grep`, repeated reads) just to gather the structural facts it needs to write a wiki.

With it: **one call** returns a structured markdown skeleton with all the facts pre-computed:

- Per-community **spine files** (top-PageRank in each architectural subsystem)
- **Top functions** in each subsystem (most-called, with signatures)
- **HTTP routes** table extracted from Express / Koa / etc. handlers
- **Entry points** (files no other file imports — likely application starts)
- **Test inventory** (files where AST patterns matched `describe`/`it`/`@Test`)
- **Cross-community import edges** as a data-flow hint
- **Glossary** of the top-50 most-called symbols with file:line refs

Plus explicit `[AGENT FILLS]` placeholders for the prose the agent should write (per-subsystem purpose, codebase narrative). The structural 80% comes free; the agent does the synthesis 20%.

**Real result:** on a 123-file LangGraph backend, tool call count to produce a wiki dropped from ~30 to ~5-8.

### `impact_analysis` — Decision-support, not a data dump

Without it: "What breaks if I change `verifyJWT`?" gets you a flat list of 47 callers with no signal about which matter.

With it, the **first three lines** answer the actual question:

```
## Verdict
⚠️ Risky change. 11 direct production callers across 3 communities,
   8 spine callers, target is itself a spine file.

> Based on visible callers in the indexed graph. May miss callers via
> re-exports, factory wrappers, or dynamic dispatch.
```

Then the breakdown:

- **Cross-community impact** — "✅ Contained" vs "⚠️ Crosses N boundaries"
- **Spine callers** — dedicated section listing callers that are themselves load-bearing files (their changes ripple)
- **Test files to update** — copy-paste-friendly path list
- **Production callers** grouped by architectural community, with truncation that always preserves at least one entry per community
- Risk score in metadata (sortable for tooling, never headlining the prose)

The verdict is honest: it always includes a caveat that callers via DI / re-export / dynamic dispatch may be missed. **No silent confidently-wrong answers.**

---

## 🔧 How it works

```
Source code
    │
    ▼ Tree-sitter parse
    │
Graph extraction (functions, classes, calls, imports, routes,
                  state objects, anonymous handlers, test files)
    │
    ▼ stored in
    │
Neo4j (with FTS index + vector index for hybrid search)
    │
    ▼ Leiden clustering
    │
Communities + PageRank + boundary degree → spine files
    │
    ▼ exposed via
    │
MCP server (10 tools, stdio transport)
    │
    ▼
Claude Code, Cursor, Codex, any MCP client
```

### What makes it sharper than `grep` + `Read`

| Capability | Native tools | code-lens-aI |
|---|---|---|
| "Find code by exact name" | `grep` | `search_code` (also semantic search if `--embed`) |
| "Show me this function's body" | `cat`/`Read` | `get_definition` (no filesystem access required) |
| "What calls X?" | `grep -r` (false positives) | `get_callers` (real CALLS edges) |
| "What does X depend on?" | manual import-tracing | `get_callees` |
| "What breaks if I change X?" | educated guess | `impact_analysis` with verdict + cross-community + spine |
| "What architectural subsystems are here?" | manual reading | `get_overview` (Leiden communities + spine files) |
| "Write me a wiki" | full-day exploration | `generate_wiki` skeleton in 1 call |

---

## 🚀 Quick start

### Prerequisites

- Node.js 18+
- Docker (for Neo4j)

### Setup

```bash
# Clone + install
git clone https://github.com/marvikomo/code-lens-aI.git
cd code-lens-aI
npm install

# Start Neo4j (with APOC + GDS plugins for clustering)
docker compose up -d neo4j

# Index a codebase + run Leiden clustering
npm run dev -- /path/to/your/repo --no-json --neo4j-clear --cluster

# (Optional) compute embeddings for semantic + hybrid search (~2-3 min, ~161 MB model)
npm run dev -- /path/to/your/repo --no-json --embed
```

### Wire into Claude Code

```bash
claude mcp add code-lens-ai \
  --transport stdio \
  -e NEO4J_URI=neo4j://localhost:7687 \
  -e NEO4J_USER=neo4j \
  -e NEO4J_PASSWORD=password \
  -- npx ts-node /absolute/path/to/code-lens-aI/src/cli.ts --mcp
```

Then in any Claude Code session inside the indexed project's folder:

```
Use code-lens-ai to give me an overview of this codebase.
```

The agent will see 10 tools (`search_code`, `get_definition`, `read_code`, `get_callers`, `get_callees`, `impact_analysis`, `get_overview`, `label_community`, `generate_wiki`, `cypher`) and decide which to use.

---

## 📋 The 10 MCP tools

| Tool | What it answers |
|---|---|
| `search_code` | "Find code that does X" — keyword (FTS), semantic (vector), or hybrid (RRF fusion) |
| `get_definition` | "Show me X's full body and signature" |
| `read_code` | "Read lines N-M of file Y" — direct, capped at 2000 lines |
| `get_callers` | "Who calls X?" — graph traversal with depth |
| `get_callees` | "What does X call?" — outbound graph traversal |
| `impact_analysis` | "Is it safe to change X?" — verdict-first with spine + test/prod + cross-community |
| `get_overview` | "What is this codebase?" — counts, languages, top communities, spine files |
| `label_community` | "Give this architectural subsystem a name" — agent-driven labeling |
| `generate_wiki` | "Write a wiki" — structural skeleton with [AGENT FILLS] markers |
| `cypher` | Read-only Cypher escape hatch for advanced queries |

---

## 🛠️ CLI reference

```bash
# General
ast-graph <repo-path> [options]

# Analysis
--no-json              # don't emit graph JSON to stdout
-o file.json           # write JSON to file
--ignore foo,bar       # extra directory/file names to skip
--stats                # print summary stats to stderr

# Neo4j (also reads NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD env vars)
--neo4j-uri <uri>
--neo4j-user <name>
--neo4j-password <pw>
--neo4j-clear          # DETACH DELETE all :CodeNode before re-indexing

# Clustering (requires Neo4j GDS plugin)
--cluster              # run Leiden + PageRank + spine selection
--cluster-only         # skip indexing; just re-cluster (preserves labels)
--cluster-clear        # wipe community props + labels first
--cluster-min-size <n> # min files to materialize a :Community node (default 3)

# Embeddings (opt-in; ~161MB model on first run)
--embed                # compute embeddings for Function/Method/Class nodes
--embed-model <hf-id>  # override default jinaai/jina-embeddings-v2-base-code

# Search-only mode (no <repo-path> needed)
--search "<query>"
--search-mode <m>      # fts | vector | hybrid (auto if omitted)
--search-limit <n>

# MCP server mode (no <repo-path> needed)
--mcp                  # stdio MCP server for Claude Code/Cursor
```

---

## 🎯 What's actually in the graph

Every indexed codebase gets:

**Node kinds:** `Repository`, `Folder`, `File`, `Class`, `Interface`, `TypeAlias`, `Enum`, `Function`, `Method`, `Property`, `Variable`, `Community`, `Unresolved`

**Edge types:** `CONTAINS`, `DEFINES`, `HAS_METHOD`, `HAS_PROPERTY`, `CALLS`, `IMPORTS`, `EXTENDS`, `IMPLEMENTS`, `IN_COMMUNITY`

**Properties on nodes:**
- Source code: `body`, `signature`, `bodyTruncated`
- Location: `path`, `startRow`, `endRow`, `startColumn`, `endColumn`, `language`
- HTTP handlers: `httpMethod`, `route`, `routerObject` (for `router.post(...)` patterns)
- State/factory: `builder` (for `Annotation.Root({...})`, `z.object({...})`, etc.)
- Tests: `isTest`, `testFramework` (jest / vitest / bun / junit / pytest detection)
- Communities: `community` int, `pagerank` float, `boundary` int, `is_core` boolean
- Embeddings: `embedding` float[768] (when `--embed` was run)
- FTS: indexed on `name`, `signature`, `body`, `path`

**What gets uniquely captured that other indexers miss:**

- **Anonymous route handlers** — `router.post("/users", async (req, res) => {...})` becomes a first-class `Function` node with `httpMethod: "POST"`, `route: "/users"`, and the handler body indexed for search
- **State objects** — `export const PlanAgentState = Annotation.Root({...})` becomes a `Variable` node with `builder: "Annotation.Root"` so you can find every state schema in one query
- **Test files** — detected via AST pattern matching (not just file path), with framework name (`jest` / `vitest` / `bun`)
- **Architectural communities** — Leiden detection on the file-import subgraph reveals real subsystems with ~80% accuracy on production codebases

---

## 🏗️ Architecture (one paragraph)

The CLI walks a repo, parses each file with **Tree-sitter** (Java + JS/TS), runs language-specific extractors that emit nodes (functions, classes, etc.) and edges (calls, imports) into an in-memory `graphlib` graph. The graph is bulk-pushed to **Neo4j** with a uniqueness constraint on `:CodeNode(id)`. After indexing, the **GDS plugin** runs Leiden community detection + PageRank + boundary degree on the file-IMPORTS subgraph, then per-community spine selection writes `is_core: true` on the most-central files. Optionally, **`@xenova/transformers`** computes 768-dim vector embeddings for Function/Method/Class bodies (jina-base-code model, in-process, ~161 MB). At query time, the **MCP server** exposes 10 tools that translate agent intent into Cypher / FTS / vector queries against this graph and shape the results into either decision-support prose (impact_analysis), structural facts (generate_wiki), or raw data (cypher).

---

## 📁 Project structure

```
src/
├── analyser/         # repo-walking + per-file extraction orchestration
├── extractor/        # per-language tree-sitter walkers (jsts.ts, java.ts, base.ts)
├── util/             # graph data model, language detection, parser factory
├── indexers/         # Neo4j bulk-write
├── clustering/       # Neo4j GDS Leiden + PageRank + spine
├── embeddings/       # @xenova/transformers wrapper + batch pipeline
├── search/           # FTS, vector, hybrid (RRF) implementations
├── mcp/              # MCP server + 10 tool implementations
└── cli.ts            # entry point — analysis, embeddings, clustering, search, mcp
scripts/
├── mcp-smoke.ts          # end-to-end MCP smoke test (10 tools)
├── mcp-impact-test.ts    # impact_analysis manual harness
├── mcp-wiki-test.ts      # generate_wiki manual harness
└── mcp-label-test.ts     # label_community manual harness
```

---

## 🤝 Contributing

The project is iterating fast. Real product feedback drives the roadmap — recent shipped features (Verdict-first impact_analysis, agent-driven community labeling, generate_wiki) all came from real-use sessions in Claude Code where gaps surfaced and got planned + shipped within hours.

If you find a gap: open an issue with the actual prompt + expected output. The plan files in `~/.claude/plans/` document the design rationale for each shipped capability.

---

## 📄 License

MIT
