import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../server";
import { readQuery, asNumber, textResult, int } from "../util";

const SPINE_PER_COMMUNITY = 5;
const TOP_FNS_PER_COMMUNITY = 5;
const EXTERNALS_PER_COMMUNITY = 8;
const ROUTES_RENDER_CAP = 80;
const TESTS_RENDER_CAP = 30;
const GLOSSARY_LIMIT = 50;
const ORPHANS_RENDER_CAP = 5;
const SECTION_DIVIDER = "\n\n---\n\n";

interface CommunityRow {
  id: number;
  label: string | null;
  description: string | null;
  size: number;
}

interface SpineFile {
  cid: number;
  path: string;
  name: string;
  pagerank: number;
}

interface TopFn {
  cid: number;
  name: string;
  signature: string | null;
  path: string;
  startRow: number;
  callCount: number;
}

interface CrossEdge {
  fromId: number;
  fromLabel: string | null;
  toId: number;
  toLabel: string | null;
  count: number;
}

interface Route {
  method: string;
  route: string;
  path: string;
  startRow: number;
}

interface TestFile {
  path: string;
  framework: string | null;
}

interface GlossaryEntry {
  name: string;
  signature: string | null;
  path: string;
  startRow: number;
  callCount: number;
}

interface ExternalImport {
  cid: number;
  spec: string;
  uses: number;
}

interface CoverageStats {
  total: number;
  clustered: number;
  orphans: string[];
}

export function registerGenerateWiki(
  server: McpServer,
  ctx: ToolContext,
): void {
  server.registerTool(
    "generate_wiki",
    {
      title: "Generate a wiki skeleton for the indexed codebase",
      description:
        "Produces a structured markdown wiki with all the STRUCTURAL facts pre-computed: " +
        "per-community spine files, top functions, route inventory, entry points, test breakdown, " +
        "and a glossary of the 50 most-called symbols. Sections marked [AGENT FILLS] need " +
        "synthesis from you (codebase purpose, per-subsystem narrative, data-flow story). " +
        "Use this as the FIRST tool when asked to write project documentation, a wiki, an " +
        "architecture overview, or a 'what is this codebase' explanation. Saves ~20 exploratory " +
        "tool calls vs. building the wiki from scratch via get_overview + cypher + read_code. " +
        "Returns markdown — read the [AGENT FILLS] sections, do targeted read_code/get_definition " +
        "calls to fill them, then write the final document.",
      inputSchema: {},
    },
    async () => {
      return await runGenerateWiki(ctx);
    },
  );
}

async function runGenerateWiki(
  ctx: ToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Run the independent queries in parallel — biggest perf win.
  const [
    repoRows,
    countRows,
    languageRows,
    communityRows,
    spineRows,
    topFnRows,
    crossRows,
    routeRows,
    entryRows,
    testRows,
    glossaryRows,
    externalRows,
    coverageRows,
  ] = await Promise.all([
    readQuery(
      ctx,
      `MATCH (r:Repository) RETURN r.name AS name, r.path AS path LIMIT 1`,
    ),
    readQuery(
      ctx,
      `MATCH (n:CodeNode)
       WITH labels(n) AS labels
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
       WITH c, count(f) AS size
       RETURN c.communityId AS id, c.label AS label,
              c.description AS description, size
       ORDER BY size DESC`,
    ),
    readQuery(
      ctx,
      `MATCH (c:Community)<-[:IN_COMMUNITY]-(f:File)
       WHERE f.is_core = true
       WITH c.communityId AS cid, f
       ORDER BY f.pagerank DESC
       RETURN cid, f.path AS path, f.name AS name, f.pagerank AS pagerank`,
    ),
    readQuery(
      ctx,
      `MATCH (c:Community)<-[:IN_COMMUNITY]-(f:File)-[:DEFINES]->(fn:Function)
       OPTIONAL MATCH (fn)<-[r:CALLS]-(:CodeNode)
       WITH c.communityId AS cid, fn, count(r) AS callCount
       WHERE callCount > 0
       RETURN cid, fn.name AS name, fn.signature AS signature,
              fn.path AS path, fn.startRow AS startRow, callCount
       ORDER BY callCount DESC`,
    ),
    readQuery(
      ctx,
      `MATCH (c1:Community)<-[:IN_COMMUNITY]-(:File)-[:IMPORTS]->(:File)-[:IN_COMMUNITY]->(c2:Community)
       WHERE c1 <> c2
       RETURN c1.communityId AS fromId, c1.label AS fromLabel,
              c2.communityId AS toId, c2.label AS toLabel,
              count(*) AS count`,
    ),
    readQuery(
      ctx,
      `MATCH (n:Function) WHERE n.httpMethod IS NOT NULL
       RETURN n.httpMethod AS method, n.route AS route,
              n.path AS path, n.startRow AS startRow
       ORDER BY n.path, n.startRow`,
    ),
    readQuery(
      ctx,
      `MATCH (f:File) WHERE NOT (f)<-[:IMPORTS]-()
       RETURN f.path AS path ORDER BY f.path`,
    ),
    readQuery(
      ctx,
      `MATCH (f:File) WHERE f.isTest = true
       RETURN f.path AS path, f.testFramework AS framework
       ORDER BY f.path`,
    ),
    readQuery(
      ctx,
      `MATCH (target)<-[r:CALLS]-(:CodeNode)
       WHERE (target:Function OR target:Method) AND target.name IS NOT NULL
       WITH target, count(r) AS callCount
       ORDER BY callCount DESC LIMIT $limit
       RETURN target.name AS name, target.signature AS signature,
              target.path AS path, target.startRow AS startRow, callCount`,
      { limit: int(GLOSSARY_LIMIT) },
    ),
    readQuery(
      ctx,
      // Skip Java stdlib (java.*, javax.*) — every Java file imports it, so it
      // would dominate the per-community top-N and crowd out actionable signal
      // like Spring/Hibernate/etc.
      `MATCH (c:Community)<-[:IN_COMMUNITY]-(:File)-[:IMPORTS]->(u:Unresolved)
       WHERE u.symbol IS NOT NULL
         AND NOT u.symbol STARTS WITH 'java.'
         AND NOT u.symbol STARTS WITH 'javax.'
       WITH c.communityId AS cid, u.symbol AS spec, count(*) AS uses
       RETURN cid, spec, uses
       ORDER BY cid, uses DESC`,
    ),
    readQuery(
      ctx,
      // Subsystem coverage — files NOT in any materialized :Community are
      // invisible to every per-subsystem render below. Surface the gap honestly
      // so the reader can calibrate trust in the wiki's completeness.
      `MATCH (f:File)
       OPTIONAL MATCH (f)-[ic:IN_COMMUNITY]->(:Community)
       WITH count(f) AS total, count(ic) AS clustered,
            collect(CASE WHEN ic IS NULL THEN f.path END) AS rawOrphans
       RETURN total, clustered,
              [p IN rawOrphans WHERE p IS NOT NULL] AS orphans`,
    ),
  ]);

  const repo = repoRows[0] ?? { name: "(unknown)", path: "(unknown)" };

  const counts = countRows.map((r) => ({
    kind: String(r.kind),
    count: asNumber(r.count) ?? 0,
  }));

  const languages = languageRows.map((r) => ({
    language: String(r.language),
    count: asNumber(r.count) ?? 0,
  }));

  const communities: CommunityRow[] = communityRows.map((r) => ({
    id: asNumber(r.id) ?? 0,
    label: (r.label as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    size: asNumber(r.size) ?? 0,
  }));

  const spine: SpineFile[] = spineRows.map((r) => ({
    cid: asNumber(r.cid) ?? 0,
    path: String(r.path),
    name: String(r.name),
    pagerank: asNumber(r.pagerank) ?? 0,
  }));

  const topFns: TopFn[] = topFnRows.map((r) => ({
    cid: asNumber(r.cid) ?? 0,
    name: String(r.name ?? "(anonymous)"),
    signature: (r.signature as string | null) ?? null,
    path: String(r.path ?? ""),
    startRow: asNumber(r.startRow) ?? 0,
    callCount: asNumber(r.callCount) ?? 0,
  }));

  const cross: CrossEdge[] = crossRows.map((r) => ({
    fromId: asNumber(r.fromId) ?? 0,
    fromLabel: (r.fromLabel as string | null) ?? null,
    toId: asNumber(r.toId) ?? 0,
    toLabel: (r.toLabel as string | null) ?? null,
    count: asNumber(r.count) ?? 0,
  }));

  const routes: Route[] = routeRows.map((r) => ({
    method: String(r.method),
    route: String(r.route ?? ""),
    path: String(r.path ?? ""),
    startRow: asNumber(r.startRow) ?? 0,
  }));

  const entries: string[] = entryRows.map((r) => String(r.path));

  const tests: TestFile[] = testRows.map((r) => ({
    path: String(r.path),
    framework: (r.framework as string | null) ?? null,
  }));

  const glossary: GlossaryEntry[] = glossaryRows.map((r) => ({
    name: String(r.name),
    signature: (r.signature as string | null) ?? null,
    path: String(r.path ?? ""),
    startRow: asNumber(r.startRow) ?? 0,
    callCount: asNumber(r.callCount) ?? 0,
  }));

  const externals: ExternalImport[] = externalRows.map((r) => ({
    cid: asNumber(r.cid) ?? 0,
    spec: String(r.spec),
    uses: asNumber(r.uses) ?? 0,
  }));

  const coverageRow = coverageRows[0] ?? { total: 0, clustered: 0, orphans: [] };
  const coverage: CoverageStats = {
    total: asNumber(coverageRow.total) ?? 0,
    clustered: asNumber(coverageRow.clustered) ?? 0,
    orphans: Array.isArray(coverageRow.orphans)
      ? (coverageRow.orphans as unknown[]).map((p) => String(p))
      : [],
  };

  return textResult(
    renderWiki({
      repoName: String(repo.name),
      repoPath: String(repo.path),
      counts,
      languages,
      communities,
      spine,
      topFns,
      cross,
      routes,
      entries,
      tests,
      glossary,
      externals,
      coverage,
    }),
  );
}

interface RenderInput {
  repoName: string;
  repoPath: string;
  counts: { kind: string; count: number }[];
  languages: { language: string; count: number }[];
  communities: CommunityRow[];
  spine: SpineFile[];
  topFns: TopFn[];
  cross: CrossEdge[];
  routes: Route[];
  entries: string[];
  tests: TestFile[];
  glossary: GlossaryEntry[];
  externals: ExternalImport[];
  coverage: CoverageStats;
}

function renderWiki(d: RenderInput): string {
  const out: string[] = [];
  const unlabeledIds = d.communities.filter((c) => !c.label).map((c) => c.id);

  out.push(`# Wiki for \`${d.repoName}\` (skeleton)`);
  out.push("");
  out.push(`> ⚠️ This is a structural skeleton, not the final wiki. As the agent, you should:`);
  out.push("> 1. Synthesize the **Overview** section from the repo's README + project structure");
  out.push("> 2. Write each subsystem's **Purpose** paragraph by inspecting its spine files");
  out.push("> 3. Write the **How it fits together** narrative by tracing cross-community imports");
  out.push(">");
  out.push(
    "> All numerical and structural facts below are extracted from the indexed graph — trust them. " +
      "All `[AGENT FILLS]` markers are prose you should write.",
  );

  if (unlabeledIds.length > 0) {
    out.push("");
    out.push(
      `> ⚠️ ${unlabeledIds.length} of ${d.communities.length} communities are unlabeled ` +
        `(IDs: ${unlabeledIds.join(", ")}). Run \`label_community\` for each before generating ` +
        `the final wiki — the subsystem section headings will read better with semantic names.`,
    );
  }

  // ─── Overview ──────────────────────────────────────────────────────────
  out.push(SECTION_DIVIDER);
  out.push("## Overview");
  out.push("");
  out.push("[AGENT FILLS — 2-3 sentences from the repo README + top-level structure]");
  out.push("");
  out.push(`**Repo path:** \`${d.repoPath}\``);
  out.push("");

  if (d.languages.length > 0) {
    const langLine = d.languages
      .map((l) => `${l.language} (${l.count} files)`)
      .join(", ");
    out.push(`**Languages:** ${langLine}`);
  }
  if (d.counts.length > 0) {
    const countLine = d.counts
      .filter((c) => c.kind !== "Repository" && c.kind !== "Folder")
      .map((c) => `${c.count.toLocaleString()} ${pluralKind(c.kind, c.count)}`)
      .join(", ");
    out.push(`**Counts:** ${countLine}`);
  }
  out.push(`**Architectural subsystems:** ${d.communities.length} (Leiden-detected)`);

  // Coverage signal — tells the reader what % of files are visible in the
  // per-subsystem sections below. Files in unmaterialized (below-threshold)
  // communities are invisible to the per-community rendering, so surfacing
  // the gap lets the reader calibrate trust in the wiki's completeness.
  if (d.coverage.total > 0) {
    const pct = Math.round((d.coverage.clustered / d.coverage.total) * 100);
    out.push(
      `**Files clustered into subsystems:** ${d.coverage.clustered} of ${d.coverage.total} (${pct}%)`,
    );
    if (d.coverage.orphans.length > 0) {
      const shown = d.coverage.orphans.slice(0, ORPHANS_RENDER_CAP);
      const hidden = d.coverage.orphans.length - shown.length;
      const list = shown.map((p) => `\`${p}\``).join(", ");
      const tail =
        hidden > 0 ? ` (showing ${shown.length} of ${d.coverage.orphans.length})` : "";
      out.push("");
      const filesWord = d.coverage.orphans.length === 1 ? "file" : "files";
      out.push(
        `> ${d.coverage.orphans.length} ${filesWord} not in any materialized subsystem${tail}: ${list}`,
      );
    }
  }

  // ─── Subsystems ────────────────────────────────────────────────────────
  if (d.communities.length > 0) {
    out.push(SECTION_DIVIDER);
    out.push("## Subsystems");
    out.push("");

    // Pre-index spine + topFns + cross + externals by community id.
    const spineByCid = groupBy(d.spine, (s) => s.cid);
    const topFnsByCid = groupBy(d.topFns, (f) => f.cid);
    const crossByFromId = groupBy(d.cross, (c) => c.fromId);
    const crossByToId = groupBy(d.cross, (c) => c.toId);
    const externalsByCid = groupBy(d.externals, (e) => e.cid);

    for (const c of d.communities) {
      const heading = c.label
        ? `### \`${c.label}\` (community ${c.id}, ${c.size} files)`
        : `### community-${c.id} (UNLABELED, ${c.size} files)`;
      out.push(heading);
      out.push("");

      if (c.description) {
        out.push(`**Purpose:** ${c.description}`);
      } else {
        out.push("**Purpose:** [AGENT FILLS — 1 paragraph inferred from spine files below]");
      }
      out.push("");

      // Spine files (top by pagerank, then by name).
      const spine = (spineByCid.get(c.id) ?? [])
        .sort((a, b) => b.pagerank - a.pagerank)
        .slice(0, SPINE_PER_COMMUNITY);

      out.push("**Spine files (most central by PageRank):**");
      if (spine.length === 0) {
        out.push("- (none flagged is_core in this community)");
      } else {
        for (const s of spine) out.push(`- \`${s.name}\` — ${s.path}`);
      }
      out.push("");

      // Top functions (top by callCount in this community).
      const fns = (topFnsByCid.get(c.id) ?? [])
        .sort((a, b) => b.callCount - a.callCount)
        .slice(0, TOP_FNS_PER_COMMUNITY);

      out.push("**Top functions (most called within this codebase):**");
      if (fns.length === 0) {
        out.push("- (no internal callers)");
      } else {
        for (const f of fns) {
          const sig = f.signature
            ? f.signature.split("\n")[0].trim().slice(0, 100)
            : f.name;
          out.push(`- \`${sig}\` — ${f.path}:${f.startRow + 1} (called ${f.callCount}×)`);
        }
      }
      out.push("");

      // Cross-community.
      const importsFrom = (crossByFromId.get(c.id) ?? [])
        .map((e) => e.toLabel ?? `community-${e.toId}`)
        .filter((s, i, arr) => arr.indexOf(s) === i);
      const importedBy = (crossByToId.get(c.id) ?? [])
        .map((e) => e.fromLabel ?? `community-${e.fromId}`)
        .filter((s, i, arr) => arr.indexOf(s) === i);
      out.push(
        `**Imports from:** ${importsFrom.length > 0 ? importsFrom.join(", ") : "(self-contained)"}`,
      );
      out.push(
        `**Imported by:** ${importedBy.length > 0 ? importedBy.join(", ") : "(none — outermost layer)"}`,
      );

      // External dependencies (imports to :Unresolved nodes — packages or
      // out-of-scope paths). Surfaces what the agent would otherwise discover
      // by grepping `import` statements.
      const externals = (externalsByCid.get(c.id) ?? [])
        .sort((a, b) => b.uses - a.uses)
        .slice(0, EXTERNALS_PER_COMMUNITY);
      if (externals.length > 0) {
        const rendered = externals
          .map((e) => `\`${e.spec}\` (${e.uses}×)`)
          .join(", ");
        out.push(`**External deps (not indexed):** ${rendered}`);
      }
      out.push("");
    }
  }

  // ─── HTTP routes ───────────────────────────────────────────────────────
  if (d.routes.length > 0) {
    out.push(SECTION_DIVIDER);
    out.push(`## HTTP routes (${d.routes.length} detected)`);
    out.push("");
    out.push("| Method | Route | File |");
    out.push("|---|---|---|");
    for (const r of d.routes.slice(0, ROUTES_RENDER_CAP)) {
      const file = `${r.path}:${r.startRow + 1}`;
      out.push(`| ${r.method} | ${r.route || "(no path)"} | ${file} |`);
    }
    if (d.routes.length > ROUTES_RENDER_CAP) {
      out.push(`\n*… ${d.routes.length - ROUTES_RENDER_CAP} more routes truncated.*`);
    }
  }

  // ─── Entry points ──────────────────────────────────────────────────────
  out.push(SECTION_DIVIDER);
  out.push("## Entry points");
  out.push("");
  if (d.entries.length === 0) {
    out.push("(None detected — every indexed file is imported by another. Check whether `index.ts` etc. are picked up.)");
  } else {
    out.push("Files that nothing else in the indexed graph imports — likely application starts:");
    out.push("");
    for (const p of d.entries.slice(0, 20)) out.push(`- \`${p}\``);
    if (d.entries.length > 20) out.push(`\n*… ${d.entries.length - 20} more.*`);
  }

  // ─── Tests ─────────────────────────────────────────────────────────────
  out.push(SECTION_DIVIDER);
  out.push("## Test inventory");
  out.push("");
  if (d.tests.length === 0) {
    out.push("**No test files detected** in this codebase (no AST patterns matched and no path-based fallback hit).");
  } else {
    const byFramework: Record<string, number> = {};
    for (const t of d.tests) {
      const k = t.framework ?? "(unknown)";
      byFramework[k] = (byFramework[k] ?? 0) + 1;
    }
    out.push(`**${d.tests.length}** test file${d.tests.length === 1 ? "" : "s"} detected.`);
    out.push("");
    out.push("| Framework | Files |");
    out.push("|---|---|");
    for (const [k, v] of Object.entries(byFramework)) out.push(`| ${k} | ${v} |`);
    out.push("");
    out.push("**Files:**");
    for (const t of d.tests.slice(0, TESTS_RENDER_CAP)) {
      out.push(`- \`${t.path}\` (${t.framework ?? "?"})`);
    }
    if (d.tests.length > TESTS_RENDER_CAP) {
      out.push(`\n*… ${d.tests.length - TESTS_RENDER_CAP} more truncated.*`);
    }
  }

  // ─── How it fits together ──────────────────────────────────────────────
  out.push(SECTION_DIVIDER);
  out.push("## How it fits together");
  out.push("");
  out.push(
    "[AGENT FILLS — read 4-6 spine files (entry points + top spines from the largest community) " +
      "and write a 2-3 paragraph data-flow narrative. Cite specific files+lines.]",
  );
  if (d.cross.length > 0) {
    out.push("");
    out.push("**Top cross-community import edges (data-flow hints):**");
    out.push("");
    out.push("| From | → To | Imports |");
    out.push("|---|---|---|");
    const sortedCross = [...d.cross].sort((a, b) => b.count - a.count).slice(0, 15);
    for (const c of sortedCross) {
      const from = c.fromLabel ?? `community-${c.fromId}`;
      const to = c.toLabel ?? `community-${c.toId}`;
      out.push(`| ${from} | ${to} | ${c.count} |`);
    }
  }

  // ─── Glossary ──────────────────────────────────────────────────────────
  out.push(SECTION_DIVIDER);
  out.push(`## Glossary (top ${d.glossary.length} most-called symbols)`);
  out.push("");
  out.push("Useful as an index and to spot core abstractions:");
  out.push("");
  for (const g of d.glossary) {
    const sig = g.signature
      ? g.signature.split("\n")[0].trim().slice(0, 120)
      : g.name;
    out.push(`- **\`${g.name}\`** (${g.callCount}×) — \`${sig}\` — ${g.path}:${g.startRow + 1}`);
  }

  return out.join("\n");
}

/**
 * Lowercased + pluralized rendering of a node kind. Hand-tuned because the
 * naive +"s" rule mangles "TypeAlias" → "typealiass" and "Community" → "communitys".
 */
function pluralKind(kind: string, count: number): string {
  if (count === 1) {
    return kind.toLowerCase();
  }
  switch (kind) {
    case "TypeAlias":
      return "type aliases";
    case "Community":
      return "communities";
    case "Class":
      return "classes";
    case "Property":
      return "properties";
    default:
      return `${kind.toLowerCase()}s`;
  }
}

function groupBy<T, K>(xs: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k) ?? [];
    arr.push(x);
    m.set(k, arr);
  }
  return m;
}
