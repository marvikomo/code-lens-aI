import type { SyntaxNode } from "tree-sitter";
import {
  ExtractContext,
  LanguageExtractor,
  rangeOf,
  fieldText,
  bodyFields,
  signatureOf,
  detectJsTestFile,
  isTestPath,
} from "./base";
import type { GraphNode } from "../util/graph";

/**
 * Extractor for tree-sitter-javascript and tree-sitter-typescript trees.
 * They share the vast majority of node types; TS-only nodes (interface_declaration,
 * implements_clause, abstract_class_declaration, public_field_definition) are handled
 * additionally and simply ignored if absent.
 */
export class JsTsExtractor implements LanguageExtractor {
  extract(root: SyntaxNode, ctx: ExtractContext): void {
    // AST-based test detection. Mutates the file node in place — GraphBuilder
    // stores nodes by reference, so this is reflected in the materialized graph.
    const framework =
      detectJsTestFile(root) ?? (isTestPath(ctx.filePath) ? "unknown" : null);
    if (framework) {
      ctx.fileNode.isTest = true;
      ctx.fileNode.testFramework = framework;
    }

    this.visit(root, ctx, /*enclosing*/ null);
  }

  private visit(
    node: SyntaxNode,
    ctx: ExtractContext,
    enclosing: GraphNode | null,
  ): void {
    switch (node.type) {
      case "import_statement": {
        const src = node.childForFieldName("source");
        if (src) {
          const spec = stripQuotes(src.text);
          ctx.pendingImports.push({ from: ctx.fileNode.id, spec });
        }
        return;
      }

      case "export_statement": {
        // Re-export with source: `export { foo } from './bar'` or `export * from './bar'`.
        // Otherwise it wraps a declaration (function/class/interface/type/enum) — fall through to recurse.
        for (const child of node.namedChildren) {
          if (child.type === "string") {
            const spec = stripQuotes(child.text);
            ctx.pendingImports.push({ from: ctx.fileNode.id, spec });
            return;
          }
        }
        break;
      }

      case "call_expression": {
        // Dynamic import — `import("./x")` — emits an IMPORTS edge so file-to-file
        // dependency information isn't lost as a CALLS to "import".
        const fn = node.childForFieldName("function");
        if (fn?.type === "import") {
          const args = node.childForFieldName("arguments");
          const arg = args?.namedChildren?.[0];
          if (arg?.type === "string") {
            const spec = stripQuotes(arg.text);
            ctx.pendingImports.push({ from: ctx.fileNode.id, spec });
          }
          break;
        }

        // Anonymous arrow / function-expression arguments become Function nodes
        // ("handlers"). Critical for Express/Koa/Fastify-style routers where the
        // real logic lives inside `router.post("/x", async (req, res) => {...})`.
        this.captureHandlerArgs(node, ctx);
        break;
      }

      case "class_declaration":
      case "abstract_class_declaration": {
        const cls = this.makeClass(node, ctx);
        ctx.builder.addEdge({
          kind: "DEFINES",
          from: ctx.fileNode.id,
          to: cls.id,
        });
        this.handleHeritage(node, cls, ctx);
        const body = node.childForFieldName("body");
        if (body) {
          for (const member of body.namedChildren) {
            this.handleClassMember(member, cls, ctx);
          }
        }
        return;
      }

      case "interface_declaration": {
        const name = fieldText(node, "name") ?? "<anonymous>";
        const id = `${ctx.fileNode.id}#interface:${name}`;
        const iface = ctx.builder.addNode({
          id,
          kind: "Interface",
          name,
          path: ctx.filePath,
          language: ctx.language,
          range: rangeOf(node),
          signature: signatureOf(node),
          ...bodyFields(node),
        });
        ctx.builder.addEdge({
          kind: "DEFINES",
          from: ctx.fileNode.id,
          to: iface.id,
        });
        return;
      }

      case "type_alias_declaration": {
        const name = fieldText(node, "name") ?? "<anonymous>";
        const id = `${ctx.fileNode.id}#type:${name}`;
        const t = ctx.builder.addNode({
          id,
          kind: "TypeAlias",
          name,
          path: ctx.filePath,
          language: ctx.language,
          range: rangeOf(node),
          signature: signatureOf(node),
          ...bodyFields(node),
        });
        ctx.builder.addEdge({
          kind: "DEFINES",
          from: ctx.fileNode.id,
          to: t.id,
        });
        return;
      }

      case "enum_declaration": {
        const name = fieldText(node, "name") ?? "<anonymous>";
        const id = `${ctx.fileNode.id}#enum:${name}`;
        const e = ctx.builder.addNode({
          id,
          kind: "Enum",
          name,
          path: ctx.filePath,
          language: ctx.language,
          range: rangeOf(node),
          signature: signatureOf(node),
          ...bodyFields(node),
        });
        ctx.builder.addEdge({
          kind: "DEFINES",
          from: ctx.fileNode.id,
          to: e.id,
        });
        return;
      }

      case "function_declaration":
      case "generator_function_declaration": {
        const name = fieldText(node, "name") ?? "<anonymous>";
        const id = `${ctx.fileNode.id}#fn:${name}@${node.startPosition.row}`;
        const fn = ctx.builder.addNode({
          id,
          kind: "Function",
          name,
          path: ctx.filePath,
          language: ctx.language,
          range: rangeOf(node),
          signature: signatureOf(node),
          ...bodyFields(node),
        });
        ctx.builder.addEdge({
          kind: "DEFINES",
          from: ctx.fileNode.id,
          to: fn.id,
        });
        this.collectCalls(node, fn, ctx);
        // Recurse into body to find nested declarations (inner functions, types, etc.).
        const body = node.childForFieldName("body");
        if (body) {
          for (const child of body.namedChildren) {
            this.visit(child, ctx, fn);
          }
        }
        return;
      }

      case "lexical_declaration":
      case "variable_declaration": {
        // Capture `const foo = () => {}` / `function expression` assigned to a name.
        let handledAny = false;
        for (const decl of node.namedChildren) {
          if (decl.type !== "variable_declarator") continue;
          const nameNode = decl.childForFieldName("name");
          const value = decl.childForFieldName("value");
          if (
            nameNode &&
            value &&
            (value.type === "arrow_function" ||
              value.type === "function_expression" ||
              value.type === "function")
          ) {
            const name = nameNode.text;
            const id = `${ctx.fileNode.id}#fn:${name}@${decl.startPosition.row}`;
            const fn = ctx.builder.addNode({
              id,
              kind: "Function",
              name,
              path: ctx.filePath,
              language: ctx.language,
              range: rangeOf(decl),
              signature: signatureOf(decl),
              ...bodyFields(decl),
            });
            ctx.builder.addEdge({
              kind: "DEFINES",
              from: ctx.fileNode.id,
              to: fn.id,
            });
            this.collectCalls(value, fn, ctx);
            // Recurse into the body to find nested declarations.
            const body = value.childForFieldName("body");
            if (body) {
              for (const child of body.namedChildren) {
                this.visit(child, ctx, fn);
              }
            }
            handledAny = true;
          } else if (
            // Top-level `const X = someBuilder(...)` — captures state objects,
            // schemas, configs, routers, etc. that are hidden from the structural
            // index because their value is a call_expression rather than a class
            // or function declaration. Examples:
            //   export const PlanAgentState = Annotation.Root({...})
            //   export const UserSchema = z.object({...})
            //   const router = Router()
            //   const prisma = new PrismaClient()
            //
            // We add the Variable node but deliberately do NOT set handledAny —
            // the bottom-of-method recursion still needs to walk the call's
            // arguments so captureHandlerArgs can find anonymous handler fns.
            enclosing === null &&
            nameNode &&
            value &&
            (value.type === "call_expression" || value.type === "new_expression")
          ) {
            const name = nameNode.text;
            const id = `${ctx.fileNode.id}#var:${name}`;
            const v = ctx.builder.addNode({
              id,
              kind: "Variable",
              name,
              path: ctx.filePath,
              language: ctx.language,
              range: rangeOf(decl),
              signature: signatureOf(decl),
              ...bodyFields(decl),
              builder: builderNameOf(value) ?? undefined,
            });
            ctx.builder.addEdge({
              kind: "DEFINES",
              from: ctx.fileNode.id,
              to: v.id,
            });
          }
        }
        if (handledAny) return;
        break;
      }
    }

    for (const child of node.namedChildren) {
      this.visit(child, ctx, enclosing);
    }
  }

  private makeClass(node: SyntaxNode, ctx: ExtractContext): GraphNode {
    const name = fieldText(node, "name") ?? "<anonymous>";
    const id = `${ctx.fileNode.id}#class:${name}`;
    return ctx.builder.addNode({
      id,
      kind: "Class",
      name,
      path: ctx.filePath,
      language: ctx.language,
      range: rangeOf(node),
      signature: signatureOf(node),
      ...bodyFields(node),
    });
  }

  private handleHeritage(
    node: SyntaxNode,
    cls: GraphNode,
    ctx: ExtractContext,
  ): void {
    // tree-sitter-javascript: `class_heritage` node containing an `extends` clause.
    // tree-sitter-typescript: `class_heritage` may include `extends_clause` and `implements_clause`.
    for (const child of node.namedChildren) {
      if (child.type !== "class_heritage") continue;
      for (const part of child.namedChildren) {
        if (part.type === "extends_clause") {
          // TS form
          for (const value of part.namedChildren) {
            if (value.type === "implements_clause") continue;
            const symbol = value.text;
            ctx.builder.addEdge({
              kind: "EXTENDS",
              from: cls.id,
              to: `unresolved:class:${symbol}`,
              unresolved: symbol,
            });
          }
        } else if (part.type === "implements_clause") {
          for (const value of part.namedChildren) {
            const symbol = value.text;
            ctx.builder.addEdge({
              kind: "IMPLEMENTS",
              from: cls.id,
              to: `unresolved:interface:${symbol}`,
              unresolved: symbol,
            });
          }
        } else {
          // JS form: identifier directly under class_heritage
          const symbol = part.text;
          ctx.builder.addEdge({
            kind: "EXTENDS",
            from: cls.id,
            to: `unresolved:class:${symbol}`,
            unresolved: symbol,
          });
        }
      }
    }
  }

  private handleClassMember(
    member: SyntaxNode,
    cls: GraphNode,
    ctx: ExtractContext,
  ): void {
    switch (member.type) {
      case "method_definition": {
        const name = fieldText(member, "name") ?? "<anonymous>";
        const id = `${cls.id}.method:${name}@${member.startPosition.row}`;
        const m = ctx.builder.addNode({
          id,
          kind: "Method",
          name,
          path: ctx.filePath,
          language: ctx.language,
          range: rangeOf(member),
          signature: signatureOf(member),
          ...bodyFields(member),
        });
        ctx.builder.addEdge({ kind: "HAS_METHOD", from: cls.id, to: m.id });
        this.collectCalls(member, m, ctx);
        return;
      }
      case "field_definition":
      case "public_field_definition": {
        const nameNode = member.childForFieldName("name") ?? member.namedChild(0);
        const name = nameNode?.text ?? "<anonymous>";
        const id = `${cls.id}.prop:${name}`;
        const p = ctx.builder.addNode({
          id,
          kind: "Property",
          name,
          path: ctx.filePath,
          language: ctx.language,
          range: rangeOf(member),
          signature: signatureOf(member),
          ...bodyFields(member),
        });
        ctx.builder.addEdge({ kind: "HAS_PROPERTY", from: cls.id, to: p.id });
        return;
      }
    }
  }

  private captureHandlerArgs(callNode: SyntaxNode, ctx: ExtractContext): void {
    const args = callNode.childForFieldName("arguments");
    if (!args) return;
    const handlers = args.namedChildren.filter(
      (c) =>
        c.type === "arrow_function" ||
        c.type === "function_expression" ||
        c.type === "function",
    );
    if (handlers.length === 0) return;

    const fn = callNode.childForFieldName("function");
    const calleeLabel = fn ? handlerLabelFor(fn) : "<call>";
    const firstString = args.namedChildren.find((c) => c.type === "string");
    const tag = firstString ? stripQuotes(firstString.text) : null;

    // Detect HTTP-handler shape (router.post("/x", handler) etc) so cypher
    // queries can match on httpMethod/route directly without parsing the
    // composite display name.
    const httpInfo = fn ? extractHttpInfo(fn, args) : null;

    handlers.forEach((arg, idx) => {
      const suffix = handlers.length > 1 ? `#${idx}` : "";
      const name = tag
        ? `<${calleeLabel}:"${tag}">${suffix}`
        : `<${calleeLabel}@${arg.startPosition.row}>${suffix}`;
      const id = `${ctx.fileNode.id}#handler:${calleeLabel}@${arg.startPosition.row}:${arg.startPosition.column}`;
      const handler = ctx.builder.addNode({
        id,
        kind: "Function",
        name,
        path: ctx.filePath,
        language: ctx.language,
        range: rangeOf(arg),
        signature: signatureOf(arg),
        ...bodyFields(arg),
        ...(httpInfo
          ? {
              httpMethod: httpInfo.method,
              route: httpInfo.route,
              routerObject: httpInfo.routerObject,
            }
          : {}),
      });
      ctx.builder.addEdge({
        kind: "DEFINES",
        from: ctx.fileNode.id,
        to: handler.id,
      });
      this.collectCalls(arg, handler, ctx);
    });
  }

  private collectCalls(
    node: SyntaxNode,
    enclosing: GraphNode,
    ctx: ExtractContext,
  ): void {
    // Walk descendants but stop at boundaries that will produce their own
    // Function/Method scope, so calls aren't double-attributed.
    const stack: SyntaxNode[] = [node];
    while (stack.length) {
      const n = stack.pop()!;
      if (
        n !== node &&
        (n.type === "function_declaration" ||
          n.type === "generator_function_declaration" ||
          n.type === "method_definition")
      ) {
        continue;
      }
      // Anonymous arrow / function-expression — own Function node via
      // captureHandlerArgs (or via variable_declarator below). Skip body.
      if (
        n !== node &&
        (n.type === "arrow_function" ||
          n.type === "function_expression" ||
          n.type === "function")
      ) {
        continue;
      }
      // Arrow / function-expression bound to a `const`/`let` becomes its own
      // Function node — skip its body to avoid double counting.
      if (
        n !== node &&
        n.type === "variable_declarator"
      ) {
        const value = n.childForFieldName("value");
        if (
          value &&
          (value.type === "arrow_function" ||
            value.type === "function_expression" ||
            value.type === "function")
        ) {
          continue;
        }
      }
      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function");
        if (fn) {
          // Dynamic import is handled as IMPORTS in visit(), not as CALLS.
          if (fn.type !== "import") {
            const symbol = calleeName(fn);
            if (symbol) {
              ctx.builder.addEdge({
                kind: "CALLS",
                from: enclosing.id,
                to: `unresolved:callable:${symbol}`,
                unresolved: symbol,
              });
            }
          }
        }
      }
      for (const c of n.namedChildren) stack.push(c);
    }
  }
}

const HTTP_VERBS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "all",
  "use",
]);

/**
 * If the call shape is `<obj>.<verb>(<route>, <handler>)` where verb is an
 * Express-style HTTP method, returns the structured form. Otherwise null.
 * Used to attach httpMethod/route/routerObject props to handler nodes so
 * cypher queries don't have to parse the display name.
 */
function extractHttpInfo(
  fn: SyntaxNode,
  args: SyntaxNode,
): { method: string; route?: string; routerObject?: string } | null {
  if (fn.type !== "member_expression") return null;
  const verb = fn.childForFieldName("property")?.text?.toLowerCase();
  if (!verb || !HTTP_VERBS.has(verb)) return null;
  const obj = fn.childForFieldName("object")?.text;
  const firstString = args.namedChildren.find((c) => c.type === "string");
  const route = firstString ? stripQuotes(firstString.text) : undefined;
  return {
    method: verb.toUpperCase(),
    route,
    routerObject: obj,
  };
}

/**
 * For a call_expression or new_expression, return a readable label for the
 * thing being called: "Annotation.Root", "z.object", "Router", "PrismaClient".
 * Used to tag Variable nodes so cypher can filter by builder pattern.
 */
function builderNameOf(value: SyntaxNode): string | null {
  // new X() — extract the constructor name
  if (value.type === "new_expression") {
    const ctor = value.childForFieldName("constructor");
    return ctor ? handlerLabelFor(ctor) : null;
  }
  // X(...) or X.Y(...)
  if (value.type === "call_expression") {
    const fn = value.childForFieldName("function");
    return fn ? handlerLabelFor(fn) : null;
  }
  return null;
}

function handlerLabelFor(fn: SyntaxNode): string {
  switch (fn.type) {
    case "identifier":
      return fn.text;
    case "member_expression": {
      const obj = fn.childForFieldName("object")?.text ?? "?";
      const prop = fn.childForFieldName("property")?.text ?? "?";
      return `${obj}.${prop}`;
    }
    default:
      return fn.text || "<call>";
  }
}

function calleeName(node: SyntaxNode): string | null {
  switch (node.type) {
    case "identifier":
    case "property_identifier":
      return node.text;
    case "member_expression": {
      const prop = node.childForFieldName("property");
      return prop?.text ?? node.text;
    }
    default:
      return node.text || null;
  }
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' || a === "'" || a === "`") && a === b) {
      return s.slice(1, -1);
    }
  }
  return s;
}
