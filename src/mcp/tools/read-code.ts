import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import type { ToolContext } from "../server";
import { textResult } from "../util";

// Matches Claude Code's built-in Read tool default.
const MAX_LINES = 2000;

const readCodeSchema: Record<string, any> = {
  file: z.string().describe("Absolute file path."),
  startLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-indexed start line. Omit for line 1."),
  endLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-indexed end line, inclusive. Omit for end of file."),
};

export function registerReadCode(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "read_code",
    {
      title: "Read source from a file",
      description:
        "Read a slice of source code directly from disk. Useful when get_definition's stored body " +
        "is truncated or you need surrounding context (imports, sibling functions, etc.). " +
        "Pass startLine + endLine (1-indexed, inclusive) to slice; omit both to read the whole file. " +
        "Caps output at 2000 lines per call (matches the built-in Read tool).",
      inputSchema: readCodeSchema,
    },
    async ({ file, startLine, endLine }) => {
      void ctx; // not needed; reads from disk directly
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch (err) {
        return textResult(
          `ERROR: cannot read ${file}: ${(err as Error).message}`,
        );
      }
      const lines = raw.split("\n");
      const start = Math.max(1, startLine ?? 1);
      const end = Math.min(lines.length, endLine ?? lines.length);
      const sliceLen = end - start + 1;
      if (sliceLen > MAX_LINES) {
        return textResult(
          `ERROR: requested ${sliceLen} lines, max per call is ${MAX_LINES}. ` +
            `Narrow the startLine/endLine range or call read_code multiple times.`,
        );
      }
      const slice = lines.slice(start - 1, end);
      // Prepend line numbers for the agent's reference.
      const numbered = slice
        .map((l, i) => `${String(start + i).padStart(5)}  ${l}`)
        .join("\n");
      return textResult(
        `${file} (lines ${start}-${end} of ${lines.length}):\n\n` + numbered,
      );
    },
  );
}
