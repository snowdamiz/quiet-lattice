// Short digests the golden fixtures keep in place of bulky data (FNV-1a, as 8 hex digits).

/** FNV-1a over a string's UTF-16 code units. */
export function digestString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** FNV-1a over the bytes of typed arrays. */
export function digestArrays(...arrays: (Float32Array | Float64Array)[]): string {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A value as it reads back from JSON (drops undefined, turns -0 into 0), for comparing with a fixture. */
export function asJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
