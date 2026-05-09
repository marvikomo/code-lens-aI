import fs from "fs";
import path from "path";
import {
  GraphBuilder,
  GraphNode,
  CodeGraph,
} from "../util/graph";
import { detectLanguage, SupportedLanguage } from "../util/language";
import { getParser } from "./../util/parserFactory";
import { ExtractContext, LanguageExtractor } from "../extractor/base";
import { JsTsExtractor } from "../extractor/jsts";
import { JavaExtractor } from "../extractor/java";
import { sha256OfFile } from "../util/hash";

export interface AnalyzeOptions {
  /** Folder/file names to ignore. Defaults to common build artefacts. */
  ignore?: string[];
  /** Whether to attempt to resolve unresolved CALLS to local Function/Method nodes by name. */
  resolveCallsByName?: boolean;
}

export interface ScanEntry {
  absPath: string;
  language: SupportedLanguage;
  /** sha256 hex; only populated when `withHashes` is true. */
  hash?: string;
}

export interface RepoScan {
  absRepo: string;
  files: ScanEntry[];
}

export interface IncrementalAnalyzeOptions extends AnalyzeOptions {
  /** File paths to actually parse + extract. Other files exist as path-only references. */
  extractOnly: Set<string>;
  /** Pre-computed sha256 hashes by absolute path (only stamped on extracted files). */
  hashes?: Map<string, string>;
  /** ISO timestamp to stamp on extracted File nodes' `lastIndexed`. */
  indexedAt: string;
}

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
  ".next",
  "coverage",
]);

export function analyzeRepository(
  repoPath: string,
  opts: AnalyzeOptions = {},
): CodeGraph {
  const absRepo = path.resolve(repoPath);
  const stat = fs.statSync(absRepo);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${absRepo}`);
  }

  const ignores = new Set([...DEFAULT_IGNORES, ...(opts.ignore ?? [])]);
  const builder = new GraphBuilder();

  // Repository node.
  const repoName = path.basename(absRepo);
  const repoNode = builder.addNode({
    id: `repo:${absRepo}`,
    kind: "Repository",
    name: repoName,
    path: absRepo,
  });

  // Walk filesystem.  Track folder→nodeId map so we can wire CONTAINS edges.
  const pendingImports: ExtractContext["pendingImports"] = [];
  const fileNodesByAbsPath = new Map<string, GraphNode>();

  const walkDir = (dir: string, parentNode: GraphNode): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignores.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const folder = builder.addNode({
          id: `folder:${full}`,
          kind: "Folder",
          name: entry.name,
          path: full,
        });
        builder.addEdge({
          kind: "CONTAINS",
          from: parentNode.id,
          to: folder.id,
        });
        walkDir(full, folder);
      } else if (entry.isFile()) {
        const lang = detectLanguage(full);
        if (!lang) continue;
        const fileNode = builder.addNode({
          id: `file:${full}`,
          kind: "File",
          name: entry.name,
          path: full,
          language: lang,
        });
        builder.addEdge({
          kind: "CONTAINS",
          from: parentNode.id,
          to: fileNode.id,
        });
        fileNodesByAbsPath.set(full, fileNode);
        analyzeFile(full, lang, fileNode, builder, pendingImports);
      }
    }
  };

  walkDir(absRepo, repoNode);

  // Resolve imports → File nodes when possible.
  resolveImports(pendingImports, fileNodesByAbsPath, builder);

  // Cross-file class/interface inheritance: bind unresolved EXTENDS/IMPLEMENTS
  // edges to real Class/Interface nodes by name lookup, disambiguated via
  // the IMPORTS edges we just resolved.
  resolveTypeRefsByName(builder);

  // Optional: collapse unresolved CALLS that match a Function/Method name in the same file or repo.
  if (opts.resolveCallsByName !== false) {
    resolveCallsByName(builder);
  }

  return builder.build();
}

/**
 * Walk the repo and enumerate every supported source file. No parsing — this
 * is the cheap pre-flight pass used by the incremental indexer to compute
 * the dirty set vs. stored hashes.
 */
export function scanRepository(
  repoPath: string,
  opts: { ignore?: string[]; withHashes?: boolean } = {},
): RepoScan {
  const absRepo = path.resolve(repoPath);
  const stat = fs.statSync(absRepo);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${absRepo}`);

  const ignores = new Set([...DEFAULT_IGNORES, ...(opts.ignore ?? [])]);
  const files: ScanEntry[] = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignores.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const lang = detectLanguage(full);
        if (!lang) continue;
        const e: ScanEntry = { absPath: full, language: lang };
        if (opts.withHashes) {
          try {
            e.hash = sha256OfFile(full);
          } catch {
            // Unreadable file — skip silently; it'll still be tracked by path.
          }
        }
        files.push(e);
      }
    }
  };

  walk(absRepo);
  return { absRepo, files };
}

/**
 * Incremental version of `analyzeRepository`: parses + extracts ONLY the
 * files in `opts.extractOnly`, while still emitting Repository + Folder
 * skeletons so CONTAINS edges resolve. Cross-file IMPORTS are resolvable
 * because we feed the resolver every File path in the repo (extracted
 * files own real builder nodes; unchanged files appear as phantom path-only
 * entries that map to Neo4j IDs which already exist from prior runs).
 */
export function analyzeIncremental(
  repoPath: string,
  opts: IncrementalAnalyzeOptions,
): CodeGraph {
  const absRepo = path.resolve(repoPath);
  const stat = fs.statSync(absRepo);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${absRepo}`);

  const ignores = new Set([...DEFAULT_IGNORES, ...(opts.ignore ?? [])]);
  const builder = new GraphBuilder();

  const repoNode = builder.addNode({
    id: `repo:${absRepo}`,
    kind: "Repository",
    name: path.basename(absRepo),
    path: absRepo,
  });

  const pendingImports: ExtractContext["pendingImports"] = [];
  const fileNodesByAbsPath = new Map<string, GraphNode>();

  // Walk the tree. For files in `extractOnly`: real File nodes + analyseFile.
  // For other files: phantom GraphNode (id+path only) for import resolution —
  // never added to the builder so they don't get re-written to Neo4j.
  const walk = (dir: string, parentNode: GraphNode): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignores.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const folder = builder.addNode({
          id: `folder:${full}`,
          kind: "Folder",
          name: entry.name,
          path: full,
        });
        builder.addEdge({
          kind: "CONTAINS",
          from: parentNode.id,
          to: folder.id,
        });
        walk(full, folder);
      } else if (entry.isFile()) {
        const lang = detectLanguage(full);
        if (!lang) continue;

        if (opts.extractOnly.has(full)) {
          const fileNode = builder.addNode({
            id: `file:${full}`,
            kind: "File",
            name: entry.name,
            path: full,
            language: lang,
            contentHash: opts.hashes?.get(full),
            lastIndexed: opts.indexedAt,
          });
          builder.addEdge({
            kind: "CONTAINS",
            from: parentNode.id,
            to: fileNode.id,
          });
          fileNodesByAbsPath.set(full, fileNode);
          analyzeFile(full, lang, fileNode, builder, pendingImports);
        } else {
          // Phantom — used for resolution lookups only.
          fileNodesByAbsPath.set(full, {
            id: `file:${full}`,
            kind: "File",
            name: entry.name,
            path: full,
            language: lang,
          });
        }
      }
    }
  };

  walk(absRepo, repoNode);

  resolveImports(pendingImports, fileNodesByAbsPath, builder);
  resolveTypeRefsByName(builder);
  if (opts.resolveCallsByName !== false) resolveCallsByName(builder);

  return builder.build();
}

function analyzeFile(
  filePath: string,
  language: SupportedLanguage,
  fileNode: GraphNode,
  builder: GraphBuilder,
  pendingImports: ExtractContext["pendingImports"],
): void {
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  let tree;
  try {
    const parser = getParser(language);
    // node-tree-sitter's default internal buffer is 32 KiB; pass an explicit
    // bufferSize so files larger than that still parse cleanly.
    tree = parser.parse(source, undefined, {
      bufferSize: Math.max(source.length + 1024, 32 * 1024),
    });
  } catch (err) {
    console.warn(`[ast-graph] parse failed for ${filePath}: ${(err as Error).message}`);
    return;
  }

  const extractor = pickExtractor(language);
  const ctx: ExtractContext = {
    builder,
    fileNode,
    filePath,
    language,
    pendingImports,
  };
  extractor.extract(tree.rootNode, ctx);
}

function pickExtractor(language: SupportedLanguage): LanguageExtractor {
  switch (language) {
    case "java":
      return new JavaExtractor();
    case "javascript":
    case "typescript":
    case "tsx":
      return new JsTsExtractor();
  }
}

const JS_EXT_PRIORITY = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

// TS NodeNext / "bundler" resolution: imports are written with the runtime
// extension (`.js`) but the on-disk file is `.ts`. Swap before falling back
// to extension-append candidates.
const JS_TO_TS_EXT_MAP: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx", ".ts"],
  ".mjs": [".mts", ".ts"],
  ".cjs": [".cts", ".ts"],
};

function resolveImports(
  pending: ExtractContext["pendingImports"],
  fileNodes: Map<string, GraphNode>,
  builder: GraphBuilder,
): void {
  for (const imp of pending) {
    const fromNode = builder.getNode(imp.from);
    if (!fromNode || !fromNode.path) continue;

    const targetFile = resolveSpec(fromNode, imp.spec, fileNodes);
    if (targetFile) {
      builder.addEdge({
        kind: "IMPORTS",
        from: fromNode.id,
        to: targetFile.id,
      });
    } else {
      builder.addEdge({
        kind: "IMPORTS",
        from: fromNode.id,
        to: `unresolved:module:${imp.spec}`,
        unresolved: imp.spec,
      });
    }
  }
}

function resolveSpec(
  fromFile: GraphNode,
  spec: string,
  fileNodes: Map<string, GraphNode>,
): GraphNode | null {
  if (!fromFile.path) return null;

  // Relative JS/TS specifier
  if (spec.startsWith(".") || spec.startsWith("/")) {
    const base = path.resolve(path.dirname(fromFile.path), spec);
    if (fileNodes.has(base)) return fileNodes.get(base)!;

    // NodeNext / bundler resolution: `./foo.js` → `./foo.ts` (or `.tsx`, …).
    const ext = path.extname(base);
    const swaps = JS_TO_TS_EXT_MAP[ext];
    if (swaps) {
      const stem = base.slice(0, -ext.length);
      for (const swap of swaps) {
        const candidate = stem + swap;
        if (fileNodes.has(candidate)) return fileNodes.get(candidate)!;
      }
    }

    for (const e of JS_EXT_PRIORITY) {
      const candidate = base + e;
      if (fileNodes.has(candidate)) return fileNodes.get(candidate)!;
    }
    return null;
  }

  // Java: dotted spec like `com.foo.Bar` -> look for a file path ending with `com/foo/Bar.java`
  if (fromFile.language === "java") {
    const cleaned = spec.replace(/\.\*$/, "");
    const sub = cleaned.split(".").join(path.sep) + ".java";
    for (const [p, node] of fileNodes) {
      if (p.endsWith(path.sep + sub) || p.endsWith(sub)) return node;
    }
  }

  return null;
}

function resolveCallsByName(builder: GraphBuilder): void {
  const graph = builder.build();
  // index callable nodes by name
  const byName = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.kind === "Function" || n.kind === "Method") {
      const arr = byName.get(n.name) ?? [];
      arr.push(n);
      byName.set(n.name, arr);
    }
  }

  for (const edge of graph.edges) {
    if (edge.kind !== "CALLS") continue;
    if (!edge.unresolved) continue;
    const candidates = byName.get(edge.unresolved);
    if (!candidates || candidates.length === 0) continue;

    // Prefer a callable defined in the same file as the caller.
    const fromNode = builder.getNode(edge.from);
    let target = candidates[0];
    if (fromNode?.path) {
      const same = candidates.find((c) => c.path === fromNode.path);
      if (same) target = same;
    }

    const oldTo = edge.to;
    edge.to = target.id;
    delete edge.unresolved;
    edge.id = `${edge.kind}:${edge.from}->${edge.to}`;
    builder.rekeyEdge(edge.from, oldTo, edge.kind, edge);
  }
}

/**
 * Strip generics + take last `.`-segment so the by-name lookup hits the
 * indexed simple name. Handles both JS/TS forms (`Foo<Bar>`, `module.Foo`)
 * and Java forms (`com.foo.Bar`, `Outer.Inner`, `Bar<T>`).
 */
function normalizeTypeRef(symbol: string): string | null {
  const noGenerics = symbol.split("<")[0].trim();
  if (!noGenerics) return null;
  const parts = noGenerics.split(".");
  return parts[parts.length - 1] || null;
}

/**
 * Cross-file resolution for EXTENDS / IMPLEMENTS edges. The extractors emit
 * `unresolved:class:<name>` placeholders when they can't tell at parse time
 * whether the parent type is local or external — same trick we use for CALLS.
 *
 * Strategy:
 *   1. Index all Class + Interface nodes by simple name.
 *   2. Build a file→imported-files map from existing IMPORTS edges so we can
 *      disambiguate when multiple candidates share a name.
 *   3. For each unresolved EXTENDS/IMPLEMENTS edge:
 *        - Normalize the symbol (strip generics, last `.`-segment).
 *        - Look up candidates in the right pool (Interface for IMPLEMENTS,
 *          Class for EXTENDS, with fallback to Interface for TS quirks).
 *        - If multiple candidates and we have IMPORTS info, prefer the one
 *          whose file the source actually imports.
 *        - Bind unique matches; leave ambiguous ones unresolved (better
 *          than silently picking wrong).
 *
 * No extractor changes needed — this just rebinds existing edges. Runs after
 * resolveImports (we need IMPORTS edges) and before resolveCallsByName for
 * deterministic ordering.
 */
function resolveTypeRefsByName(builder: GraphBuilder): void {
  const graph = builder.build();

  const classByName = new Map<string, GraphNode[]>();
  const interfaceByName = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.kind === "Class") {
      const arr = classByName.get(n.name) ?? [];
      arr.push(n);
      classByName.set(n.name, arr);
    } else if (n.kind === "Interface") {
      const arr = interfaceByName.get(n.name) ?? [];
      arr.push(n);
      interfaceByName.set(n.name, arr);
    }
  }

  // file id → set of imported file ids (file→file IMPORTS edges only)
  const fileImports = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== "IMPORTS") continue;
    const fromNode = builder.getNode(e.from);
    const toNode = builder.getNode(e.to);
    if (!fromNode || !toNode) continue;
    if (fromNode.kind !== "File" || toNode.kind !== "File") continue;
    const set = fileImports.get(e.from) ?? new Set<string>();
    set.add(e.to);
    fileImports.set(e.from, set);
  }

  for (const edge of graph.edges) {
    if (edge.kind !== "EXTENDS" && edge.kind !== "IMPLEMENTS") continue;
    if (!edge.unresolved) continue;

    const simpleName = normalizeTypeRef(edge.unresolved);
    if (!simpleName) continue;

    let candidates =
      edge.kind === "IMPLEMENTS"
        ? interfaceByName.get(simpleName)
        : classByName.get(simpleName);
    // TS quirk: `class X extends I` where I is actually an Interface.
    if (
      edge.kind === "EXTENDS" &&
      (!candidates || candidates.length === 0)
    ) {
      candidates = interfaceByName.get(simpleName);
    }
    if (!candidates || candidates.length === 0) continue;

    // Find the source file of this edge for disambiguation.
    const fromNode = builder.getNode(edge.from);
    const sourceFileId = fromNode?.path ? `file:${fromNode.path}` : null;

    let target: GraphNode | undefined;
    if (sourceFileId && candidates.length > 1) {
      const imports = fileImports.get(sourceFileId);
      if (imports) {
        target = candidates.find(
          (c) => c.path && imports.has(`file:${c.path}`),
        );
      }
    }
    if (!target && candidates.length === 1) target = candidates[0];
    if (!target) continue; // ambiguous AND no IMPORTS hint → safer to leave

    const oldTo = edge.to;
    edge.to = target.id;
    delete edge.unresolved;
    edge.id = `${edge.kind}:${edge.from}->${edge.to}`;
    builder.rekeyEdge(edge.from, oldTo, edge.kind, edge);
  }
}
