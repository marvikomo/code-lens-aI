import fs from "fs";
import os from "os";
import path from "path";
import { gitClone, gitFetchReset } from "./git";

/**
 * Repo-source resolver: turns a CLI input (path or URL) into a local
 * filesystem path that the rest of the pipeline can walk.
 *
 *   - URL given → clone (or fetch+reset) into ~/.code-lens-aI/cache/<host>/<owner>/<name>/
 *   - Path given → return it as-is
 */

export interface ResolvedSource {
  /** Absolute local path ready for analysis. */
  localPath: string;
  /** Original git URL when input was a URL; undefined for direct paths. */
  sourceUrl?: string;
}

const URL_RE = /^(https?:\/\/|git@|ssh:\/\/)/;

export function looksLikeGitUrl(input: string): boolean {
  return URL_RE.test(input);
}

/**
 * Default cache root: ~/.code-lens-aI/cache/. Overridable via the
 * CODE_LENS_CACHE_DIR env var (mostly for tests).
 */
export function defaultCacheDir(): string {
  return (
    process.env.CODE_LENS_CACHE_DIR ??
    path.join(os.homedir(), ".code-lens-aI", "cache")
  );
}

/**
 * Resolve a CLI input to a local path. If `input` is a URL, ensures a clone
 * exists at the deterministic cache location, syncing if it already does.
 */
export function resolveSource(input: string): ResolvedSource {
  if (!looksLikeGitUrl(input)) {
    return { localPath: path.resolve(input) };
  }

  const url = input;
  const slug = sanitizeUrlToPath(url);
  const cacheDir = defaultCacheDir();
  const target = path.join(cacheDir, slug);

  if (fs.existsSync(target) && fs.existsSync(path.join(target, ".git"))) {
    console.error(`[repo-source] syncing cached clone at ${target}`);
    gitFetchReset(target);
  } else {
    console.error(`[repo-source] cloning ${url} → ${target}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    gitClone(url, target);
  }

  return { localPath: target, sourceUrl: url };
}

/**
 * Turn a git URL into a stable cache path slug. Examples:
 *   https://github.com/foo/bar.git    → github.com/foo/bar
 *   git@github.com:foo/bar.git        → github.com/foo/bar
 *   ssh://git@gitlab.com/group/proj   → gitlab.com/group/proj
 *
 * The slug is `<host>/<owner>/<name>`. Stripping `.git` keeps the path stable
 * across clone-form variants.
 */
export function sanitizeUrlToPath(url: string): string {
  let host = "unknown";
  let pathPart = url;

  // git@host:owner/repo.git
  const sshMatch = /^git@([^:]+):(.+)$/.exec(url);
  if (sshMatch) {
    host = sshMatch[1];
    pathPart = sshMatch[2];
  } else {
    // https://host/owner/repo[.git] | ssh://[user@]host/owner/repo
    const proto = /^([a-z]+:\/\/)([^/]+)\/(.+)$/.exec(url);
    if (proto) {
      const hostPart = proto[2];
      // Strip leading user@ if present (ssh://git@host).
      host = hostPart.includes("@") ? hostPart.split("@").pop()! : hostPart;
      pathPart = proto[3];
    }
  }

  pathPart = pathPart.replace(/\.git$/, "").replace(/\/+$/, "");
  // Defense: strip anything that could escape the cache dir.
  const safePath = pathPart
    .split("/")
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .join("/");
  return `${host}/${safePath}`;
}
