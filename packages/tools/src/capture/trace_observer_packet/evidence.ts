import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const sha256 = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
/** Detached producer facts; never invokes getters or toJSON on an exception. */
export function failureSnapshot(error: unknown) {
  let remaining = 256 * 1024;
  let nodes = 2048;
  let complete = true;
  const seen = new Map<object, number>();
  const omitted = (reason: string) => {
    complete = false;
    return { type: 'omitted', reason };
  };
  const take = (bytes: number) => {
    if (bytes > remaining) return false;
    remaining -= bytes;
    return true;
  };
  function copy(value: unknown, depth: number): unknown {
    if (--nodes < 0 || depth > 16 || !take(64)) return omitted('Failure snapshot node/depth/byte ceiling');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') return take(value.length * 6) ? value : omitted('String byte ceiling');
    if (typeof value === 'number') return Number.isFinite(value) ? value : { type: 'number', value: String(value) };
    if (typeof value === 'bigint') {
      const decimal = String(value);
      return take(decimal.length) ? { type: 'bigint', decimal } : omitted('Integer byte ceiling');
    }
    if (typeof value === 'undefined') return { type: 'undefined' };
    if (typeof value !== 'object') return omitted('Non-data attribute');
    const prior = seen.get(value);
    if (prior !== undefined) return { reference: prior };
    const id = seen.size;
    seen.set(value, id);
    if (types.isUint8Array(value))
      return take(Math.ceil(value.byteLength / 3) * 4)
        ? { id, type: 'bytes', base64: Buffer.from(value).toString('base64') }
        : { ...omitted('Raw byte ceiling'), bytes: value.byteLength };
    const attributes: [string, unknown][] = [];
    try {
      for (const key of Reflect.ownKeys(value)) {
        if (nodes <= 0 || remaining < 128) {
          attributes.push(['t13Incomplete', omitted('Attribute ceiling')]);
          break;
        }
        if (typeof key !== 'string' || !take(key.length * 6)) {
          attributes.push(['t13Incomplete', omitted('Attribute key unavailable')]);
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        attributes.push([key, descriptor && 'value' in descriptor ? copy(descriptor.value, depth + 1) : omitted('Accessor not invoked')]);
      }
    } catch {
      attributes.push(['t13Incomplete', omitted('Attribute inspection failed')]);
    }
    return { id, type: types.isNativeError(value) ? 'Error' : 'Object', attributes: Object.fromEntries(attributes) };
  }
  const value = copy(error, 0);
  return { complete, value };
}
const evidenceCap = 128 * 1024 * 1024;
const bridgeRequestCap = Math.ceil(evidenceCap / 3) * 4 + 65536;
const python = '/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14';
// macOS /dev/fd/<directory fd>/leaf does not support relative lookup, and Node has no openat.
// The task's pinned Python owns the entire descriptor-relative operation, including closure.
const bridgeSource = `
import base64, json, sys
sys.path.insert(0, sys.argv[1])
import metadata
try:
    wire = sys.stdin.buffer.read(${bridgeRequestCap + 1})
    if len(wire) > ${bridgeRequestCap}:
        raise ValueError('Bridge request ceiling')
    request = json.loads(wire)
    if request['operation'] == 'admit':
        result = {'stampJson': json.dumps(metadata.admit(request['path'], request['cap'])['stamp'])}
    elif request['operation'] == 'read':
        admitted = json.loads(request['stampJson']) if request.get('stampJson') is not None else None
        result = metadata.read_bytes(request['path'], request['cap'], expected_stamp=admitted)
        raw = result.pop('raw')
        result['facts'].pop('raw_base64', None)
        result['rawBase64'] = base64.b64encode(raw).decode('ascii')
    elif request['operation'] == 'publish':
        raw = base64.b64decode(request['rawBase64'], validate=True)
        if len(raw) > 134217728:
            raise ValueError('Evidence byte ceiling')
        metadata.atomic(request['path'], raw)
        result = {}
    else:
        raise ValueError('Unknown metadata operation')
    reply = {'ok': True, 'result': result}
except BaseException as error:
    reply = {'ok': False, 'error': metadata.failure(error)}
sys.stdout.write(json.dumps(reply, allow_nan=False, separators=(',', ':')))
`;
export class SnapshotFailure extends Error {
  constructor(
    message: string,
    readonly facts: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
type BridgeRequest =
  | { operation: 'admit'; path: string; cap: number }
  | { operation: 'read'; path: string; cap: number; stampJson?: string }
  | { operation: 'publish'; path: string; rawBase64: string };
function bridge(request: BridgeRequest, outputCap: number): Record<string, unknown> {
  if (Buffer.byteLength(request.path) > 4096) throw new Error('Evidence path ceiling');
  const result = spawnSync(python, ['-I', '-B', '-c', bridgeSource, fileURLToPath(new URL('.', import.meta.url))], {
    input: JSON.stringify(request),
    timeout: 15000,
    killSignal: 'SIGKILL',
    maxBuffer: Math.ceil((outputCap * 4) / 3) + 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.signal)
    throw new SnapshotFailure('Metadata bridge did not complete', failureSnapshot(result), { cause: result.error });
  let reply: unknown;
  try {
    reply = JSON.parse(result.stdout.toString('utf8'));
  } catch (error) {
    throw new SnapshotFailure('Metadata bridge reply invalid', failureSnapshot(result), { cause: error });
  }
  if (!reply || typeof reply !== 'object' || !('ok' in reply)) throw new SnapshotFailure('Metadata bridge reply absent', reply);
  if (reply.ok !== true) {
    const facts = 'error' in reply ? reply.error : reply;
    throw new SnapshotFailure('Metadata bridge refused: ' + JSON.stringify(facts), facts);
  }
  if (!('result' in reply) || !reply.result || typeof reply.result !== 'object' || Array.isArray(reply.result))
    throw new SnapshotFailure('Metadata bridge result absent', reply);
  return Object.fromEntries(Object.entries(reply.result));
}
export function readBytes(path: string, expected: string | undefined, cap: number, beforeOpen?: () => void) {
  if (!Number.isSafeInteger(cap) || cap < 0 || cap > evidenceCap) throw new Error('Read byte ceiling');
  let stampJson: string | undefined;
  if (beforeOpen) {
    const admitted = bridge({ operation: 'admit', path, cap }, 65536);
    if (typeof admitted.stampJson !== 'string') throw new SnapshotFailure('Metadata admission absent', admitted);
    stampJson = admitted.stampJson;
    beforeOpen();
  }
  const result = bridge({ operation: 'read', path, cap, stampJson }, cap);
  if (typeof result.rawBase64 !== 'string' || typeof result.sha256 !== 'string') throw new SnapshotFailure('Metadata bytes absent', result);
  const raw = Buffer.from(result.rawBase64, 'base64');
  const hash = sha256(raw);
  if (raw.length > cap || raw.toString('base64') !== result.rawBase64 || hash !== result.sha256 || (expected !== undefined && hash !== expected))
    throw new SnapshotFailure('Metadata digest/byte ceiling differs', result);
  return { raw, sha256: hash };
}
export function readSnapshot(path: string, expected: string | undefined, cap = 16 * 1024 * 1024, beforeOpen?: () => void) {
  const snapshot = readBytes(path, expected, cap, beforeOpen);
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.raw));
    return { ...snapshot, value };
  } catch (error) {
    throw new SnapshotFailure(
      'Metadata JSON snapshot invalid',
      { path, rawBase64: snapshot.raw.toString('base64'), error: failureSnapshot(error) },
      { cause: error },
    );
  }
}
export function publish(path: string, raw: Buffer) {
  if (raw.length > evidenceCap) throw new Error('Evidence byte ceiling');
  bridge({ operation: 'publish', path, rawBase64: raw.toString('base64') }, 65536);
}
export class EvidenceStore {
  readonly raw = new Map<string, Buffer>();
  readonly failures: { path: string; error: ReturnType<typeof failureSnapshot> }[] = [];
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
    const errors: unknown[] = [];
    for (const root of this.roots) {
      const path = join(root, name);
      try {
        this.writer(path, raw);
      } catch (error) {
        failed = true;
        errors.push(error);
        this.failures.push({ path, error: failureSnapshot(error) });
        continue;
      }
      this.durable.set(name, { path, sha256: sha256(raw), bytes: raw.length });
      if (failed) throw new AggregateError(errors, 'Primary evidence sink failed; fallback retained', { cause: errors[0] });
      return;
    }
    throw new AggregateError(errors, 'Evidence write failed; inspect durable/fallback receipt', { cause: errors[0] });
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
