// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Download-once storage for the big immutable data files (terrain grids, ephemeris years). URLs carry a
// content hash (?v=...), so a stored copy is never stale: a changed file gets a new URL. Uses the
// browser's Cache Storage, which survives reloads and later visits; anything unavailable (private
// mode, old browser, quota) falls back to a normal fetch. Only browser APIs are touched inside
// functions, so this module also imports cleanly under Node.

const STORE = "lunar-navigator-data-v1";

export type Progress = (loaded: number, total: number) => void;

async function open(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(STORE);
  } catch {
    return null;
  }
}

/** Body of `url`, streamed with progress on first download and served from local storage afterwards. */
export async function cachedBytes(url: string, onProgress?: Progress): Promise<ArrayBuffer> {
  const store = await open();
  const hit = await store?.match(url).catch(() => undefined);
  if (hit) {
    const b = await hit.arrayBuffer();
    onProgress?.(b.byteLength, b.byteLength);
    return b;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, Math.max(total, loaded));
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  if (store) {
    const headers = { "content-type": res.headers.get("content-type") ?? "application/octet-stream" };
    store.put(url, new Response(out.slice().buffer, { headers })).catch(() => {});  // best effort
  }
  return out.buffer;
}

/** zlib ("deflate") stream -> bytes, with the browser's native decompressor. */
export async function inflate(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).arrayBuffer();
}
