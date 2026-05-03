import { Graph } from "graphlib";

/**
 * Graph schema
 *
 *   Repository ─CONTAINS─► Folder ─CONTAINS─► Folder|File
 *   File ─DEFINES─► Class | Function | Interface
 *   Class ─HAS_METHOD─► Method
 *   Class ─HAS_PROPERTY─► Property
 *   Function|Method ─CALLS─► Function|Method
 *   File ─IMPORTS─► File
 *   Class ─EXTENDS─► Class
 *   Class ─IMPLEMENTS─► Interface
 */

export type NodeKind =
  | "Repository"
  | "Folder"
  | "File"
  | "Class"
  | "Interface"
  | "TypeAlias"
  | "Enum"
  | "Function"
  | "Method"
  | "Property"
  | "Variable";

export type EdgeKind =
  | "CONTAINS"
  | "DEFINES"
  | "HAS_METHOD"
  | "HAS_PROPERTY"
  | "CALLS"
  | "IMPORTS"
  | "EXTENDS"
  | "IMPLEMENTS";

export interface Position {
  row: number;
  column: number;
}

export interface SourceRange {
  start: Position;
  end: Position;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** Absolute path for File/Folder/Repository, otherwise containing file. */
  path?: string;
  language?: "javascript" | "typescript" | "tsx" | "java";
  range?: SourceRange;
  /** Declaration line(s) — function up to body, full text for type/enum/property. */
  signature?: string;
  /** Source text for the node. May be truncated; see bodyTruncated. */
  body?: string;
  /** True when body is a partial cut at MAX_BODY_BYTES. Absent when full. */
  bodyTruncated?: boolean;
  /** HTTP verb for handler-arg Function nodes (`router.post(...)` etc). */
  httpMethod?: string;
  /** Route path string for handler-arg Function nodes (first string arg). */
  route?: string;
  /** The router/object the handler was attached to (e.g. "projectsRouter"). */
  routerObject?: string;
  /** For Variable nodes: the builder/factory call (e.g. "Annotation.Root"). */
  builder?: string;
  /** Free-form metadata (modifiers, parameters, etc.) */
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  /** When `to` could not be resolved to a real node id, the raw symbol/path. */
  unresolved?: string;
  meta?: Record<string, unknown>;
}

export interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Underlying graphlib graph (directed multigraph). */
  graph: Graph;
}

/**
 * Wraps a `graphlib.Graph` (directed, multigraph).
 *
 * - Nodes carry their `GraphNode` payload via `setNode(id, data)`.
 * - Edges are keyed by `kind` (the `name` parameter of a graphlib edge) so
 *   multiple kinds of edges can co-exist between the same two nodes
 *   (e.g. `EXTENDS` + `CALLS`).
 */
export class GraphBuilder {
  readonly g: Graph;

  constructor() {
    this.g = new Graph({ directed: true, multigraph: true, compound: false });
  }

  addNode(node: GraphNode): GraphNode {
    const existing = this.g.node(node.id) as GraphNode | undefined;
    if (existing) return existing;
    this.g.setNode(node.id, node);
    return node;
  }

  hasNode(id: string): boolean {
    return this.g.hasNode(id);
  }

  getNode(id: string): GraphNode | undefined {
    return this.g.node(id) as GraphNode | undefined;
  }

  addEdge(edge: Omit<GraphEdge, "id">): GraphEdge {
    const id = `${edge.kind}:${edge.from}->${edge.to}`;
    const existing = this.g.edge({
      v: edge.from,
      w: edge.to,
      name: edge.kind,
    }) as GraphEdge | undefined;
    if (existing) return existing;

    const e: GraphEdge = { id, ...edge };
    this.g.setEdge({ v: edge.from, w: edge.to, name: edge.kind }, e);
    return e;
  }

  /**
   * Replace an edge's endpoint (used after CALLS resolution rewrites `to`).
   */
  rekeyEdge(
    oldFrom: string,
    oldTo: string,
    kind: EdgeKind,
    edge: GraphEdge,
  ): void {
    this.g.removeEdge(oldFrom, oldTo, kind);
    this.g.setEdge({ v: edge.from, w: edge.to, name: edge.kind }, edge);
  }

  build(): CodeGraph {
    const nodes: GraphNode[] = this.g
      .nodes()
      .map((id) => this.g.node(id) as GraphNode | undefined)
      .filter((n): n is GraphNode => n !== undefined);
    const edges: GraphEdge[] = this.g
      .edges()
      .map((e) => this.g.edge(e) as GraphEdge | undefined)
      .filter((e): e is GraphEdge => e !== undefined);
    return { nodes, edges, graph: this.g };
  }
}
