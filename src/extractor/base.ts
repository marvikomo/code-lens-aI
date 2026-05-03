import type { SyntaxNode } from "tree-sitter";
import type { GraphBuilder, GraphNode, SourceRange } from "../util/graph";
import type { SupportedLanguage } from "../util/language";

export interface ExtractContext {
  builder: GraphBuilder;
  fileNode: GraphNode;
  filePath: string;
  language: SupportedLanguage;
  /** Pending unresolved imports: raw module specifier → list of "files we should link to". Resolved at the end. */
  pendingImports: { from: string; spec: string }[];
}

export interface LanguageExtractor {
  extract(root: SyntaxNode, ctx: ExtractContext): void;
}

export function rangeOf(n: SyntaxNode): SourceRange {
  return {
    start: { row: n.startPosition.row, column: n.startPosition.column },
    end: { row: n.endPosition.row, column: n.endPosition.column },
  };
}

/** Walk all named descendants depth-first, invoking `visit`.  Returning `false` skips children. */
export function walk(
  node: SyntaxNode,
  visit: (n: SyntaxNode) => boolean | void,
): void {
  const cont = visit(node);
  if (cont === false) return;
  for (const child of node.namedChildren) walk(child, visit);
}

/** Get text of a child field if it exists. */
export function fieldText(n: SyntaxNode, name: string): string | undefined {
  return n.childForFieldName(name)?.text;
}

/** Soft cap on stored node bodies. Larger nodes are truncated, not dropped. */
export const MAX_BODY_BYTES = 50_000;

/**
 * Spreadable fields for a node's body. Truncates at a newline boundary near
 * the cap when the source exceeds `max`, and sets `bodyTruncated: true` so
 * downstream consumers (FTS, embeddings, MCP tools) know the content is partial.
 *
 * Returns `{}` only for empty/zero-length nodes.
 */
export function bodyFields(
  n: SyntaxNode,
  max = MAX_BODY_BYTES,
): { body?: string; bodyTruncated?: true } {
  const len = n.endIndex - n.startIndex;
  if (len <= 0) return {};
  if (len <= max) return { body: n.text };

  // Truncate at the last newline in the upper portion of the slice for a
  // readable cut. Fall back to a hard cut if no newline is found near the end.
  const slice = n.text.slice(0, max);
  const lastNewline = slice.lastIndexOf("\n");
  const body = lastNewline > max * 0.8 ? slice.slice(0, lastNewline) : slice;
  return { body, bodyTruncated: true };
}

/**
 * Declaration text up to the body — for callables/classes that have a body
 * field. For nodes without a body (TypeAlias, Enum, Property), returns the
 * full text. Returned strings are trimmed of trailing whitespace only.
 */
export function signatureOf(n: SyntaxNode): string {
  const body = n.childForFieldName("body");
  if (body) {
    const offset = body.startIndex - n.startIndex;
    if (offset > 0 && offset <= n.text.length) {
      return n.text.slice(0, offset).trimEnd();
    }
  }
  return n.text.trimEnd();
}
