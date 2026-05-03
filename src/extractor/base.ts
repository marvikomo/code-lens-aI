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
