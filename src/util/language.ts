import path from "path";

export type SupportedLanguage = "javascript" | "typescript" | "tsx" | "java";

export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".java":
      return "java";
    default:
      return null;
  }
}
