import crypto from "crypto";
import fs from "fs";

/**
 * sha256 hex digest of a file's contents. Used by the hash-mode (non-git)
 * incremental indexer to detect changed files vs. the hashes stored on
 * `:File.contentHash` from the previous run.
 *
 * Synchronous to keep the walker simple; for stiche-scale this hashes 123
 * files in ~50ms. Streamed reads aren't needed at typical source-file sizes.
 */
export function sha256OfFile(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}
