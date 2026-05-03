/**
 * Local embedding via @xenova/transformers (ONNX in-process).
 *
 * The library is pure ESM, so we have to use the Function-wrapped dynamic
 * import to prevent TypeScript's CommonJS transpilation from rewriting
 * `import()` to `require()` — which would fail on ESM-only packages.
 */

type Pipeline = (input: string | string[], opts?: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>;

const DEFAULT_MODEL = "jinaai/jina-embeddings-v2-base-code";

let extractorPromise: Promise<Pipeline> | null = null;

// `eval` keeps this as a real dynamic import at runtime — tsc won't downlevel it.
const dynamicImport = eval("(m) => import(m)") as (m: string) => Promise<any>;

async function buildExtractor(model: string): Promise<Pipeline> {
  const { pipeline } = await dynamicImport("@xenova/transformers");
  return pipeline("feature-extraction", model) as Promise<Pipeline>;
}

/**
 * Returns the cached extractor, loading on first call. First call also triggers
 * a model download (~161 MB for jina-base-code) the first time on this machine.
 */
export function getExtractor(model: string = DEFAULT_MODEL): Promise<Pipeline> {
  if (!extractorPromise) {
    console.error(`[embed] loading model: ${model} (first run downloads ~161 MB)`);
    extractorPromise = buildExtractor(model);
  }
  return extractorPromise;
}

/** Embed a single text. Returns a normalized 768-dim vector for jina-base-code. */
export async function embed(
  text: string,
  model?: string,
): Promise<number[]> {
  const extractor = await getExtractor(model);
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

/** Batch-embed multiple texts. More efficient than calling `embed` in a loop. */
export async function embedBatch(
  texts: string[],
  model?: string,
): Promise<number[][]> {
  const extractor = await getExtractor(model);
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  // The output is a flat Float32Array of length `texts.length * dims`.
  const dims = out.dims[out.dims.length - 1];
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(Array.from(out.data.slice(i * dims, (i + 1) * dims)));
  }
  return result;
}

export const EMBEDDING_DIMS = 768; // jina-embeddings-v2-base-code
