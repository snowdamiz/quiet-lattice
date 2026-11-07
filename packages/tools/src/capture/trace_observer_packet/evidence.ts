import type { Stats } from 'node:fs';
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, writeFileSync, linkSync, unlinkSync, fsyncSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const sha256 = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
const stamp = (s: Stats) => [s.dev, s.ino, s.mode, s.uid, s.size, s.mtimeMs, s.ctimeMs].join(':');
export class SnapshotFailure extends Error {
  constructor(
    message: string,
    readonly facts: { path: string; rawBase64: string | null; bytesRead: number; primary: string | null; closing: string | null },
  ) {
    super(message);
  }
}
export function readSnapshot(path: string, expected: string | undefined, cap = 16 * 1024 * 1024, beforeOpen = () => {}) {
  const facts: SnapshotFailure['facts'] = { path, rawBase64: null, bytesRead: 0, primary: null, closing: null };
  let fd: number | undefined;
  let snapshot: { raw: Buffer; sha256: string; value: unknown } | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.size > cap || before.uid !== process.getuid?.()) throw new Error('Metadata type/owner/size refused');
    beforeOpen();
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (!opened.isFile() || stamp(opened) !== stamp(before)) throw new Error('Metadata descriptor differs');
    const bytes = Buffer.alloc(cap + 1);
    let count = 0;
    while (count < bytes.length) {
      const n = readSync(fd, bytes, count, bytes.length - count, null);
      if (!n) break;
      count += n;
      facts.bytesRead = count;
      facts.rawBase64 = bytes.subarray(0, count).toString('base64');
    }
    const raw = bytes.subarray(0, count);
    if (count > cap || count !== opened.size || stamp(fstatSync(fd)) !== stamp(opened) || stamp(lstatSync(path)) !== stamp(opened))
      throw new Error('Metadata changed/exceeded cap');
    if (expected !== undefined && sha256(raw) !== expected) throw new Error('Metadata digest differs');
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    snapshot = { raw, sha256: sha256(raw), value };
  } catch (error) {
    facts.primary = String(error);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch (error) {
        facts.closing = String(error);
      }
    }
  }
  if (facts.primary !== null || facts.closing !== null || !snapshot)
    throw new SnapshotFailure(facts.primary ?? facts.closing ?? 'Metadata snapshot absent', facts);
  return snapshot;
}
export function publish(path: string, raw: Buffer) {
  const temporary = path + '.writing';
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const errors: unknown[] = [];
  try {
    writeFileSync(fd, raw);
    fsyncSync(fd);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      closeSync(fd);
    } catch (closing) {
      errors.push(closing);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, `Evidence write and close failed: ${errors.map(String).join('; ')}`, { cause: errors[0] });
  linkSync(temporary, path);
  unlinkSync(temporary);
}
export class EvidenceStore {
  readonly raw = new Map<string, Buffer>();
  readonly failures: { path: string; error: string }[] = [];
  readonly durable = new Map<string, { path: string; sha256: string; bytes: number }>();
  private bytes = 0;
  constructor(
    private readonly roots: string[],
    private readonly writer = publish,
    private readonly cap = 128 * 1024 * 1024,
  ) {}
  put(name: string, value: unknown) {
    const raw = Buffer.isBuffer(value)
      ? Buffer.from(value)
      : Buffer.from(
          JSON.stringify(value, (_key, item) =>
            item === undefined ? { t13Undefined: true } : typeof item === 'number' && !Number.isFinite(item) ? { t13Nonfinite: String(item) } : item,
          ),
        );
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || this.raw.has(name) || this.raw.size >= 1200 || this.bytes + raw.length > this.cap)
      throw new Error('Evidence file/count/byte ceiling');
    this.raw.set(name, raw);
    this.bytes += raw.length;
    let failed = false;
    for (const root of this.roots) {
      const path = join(root, name);
      try {
        this.writer(path, raw);
      } catch (error) {
        failed = true;
        this.failures.push({ path, error: String(error) });
        continue;
      }
      this.durable.set(name, { path, sha256: sha256(raw), bytes: raw.length });
      if (failed) throw new Error('Primary evidence sink failed; fallback retained');
      return;
    }
    throw new Error('Evidence write failed; inspect durable/fallback receipt');
  }
  receipt() {
    return structuredClone({
      bytes: this.bytes,
      count: this.raw.size,
      durable: Object.fromEntries(this.durable),
      failures: this.failures,
      undurable: Object.fromEntries([...this.raw].filter(([name]) => !this.durable.has(name)).map(([name, raw]) => [name, raw.toString('base64')])),
    });
  }
}
