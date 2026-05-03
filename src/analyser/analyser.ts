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

export interface AnalyzeOptions {
  /** Folder/file names to ignore. Defaults to common build artefacts. */
  ignore?: string[];
  /** Whether to attempt to resolve unresolved CALLS to local Function/Method nodes by name. */
  resolveCallsByName?: boolean;
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

  // Optional: collapse unresolved CALLS that match a Function/Method name in the same file or repo.
  if (opts.resolveCallsByName !== false) {
    resolveCallsByName(builder);
  }

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
