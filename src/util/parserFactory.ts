import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import Java from "tree-sitter-java";
import TS from "tree-sitter-typescript";
import { SupportedLanguage } from "./language";

// The grammar packages declare `Language.language` as `unknown` (correct: it's
// an opaque native pointer), while the `tree-sitter` package declares it as
// recursively `Language` — structurally impossible. Cast through unknown so
// TypeScript stops rejecting the assignment.
const asLang = (g: unknown): Parser.Language => g as Parser.Language;

const cache = new Map<SupportedLanguage, Parser>();

export function getParser(language: SupportedLanguage): Parser {
  let p = cache.get(language);
  if (p) return p;
  p = new Parser();
  switch (language) {
    case "javascript":
      p.setLanguage(asLang(JavaScript));
      break;
    case "typescript":
      p.setLanguage(asLang(TS.typescript));
      break;
    case "tsx":
      p.setLanguage(asLang(TS.tsx));
      break;
    case "java":
      p.setLanguage(asLang(Java));
      break;
  }
  cache.set(language, p);
  return p;
}
