/* global Response, Request, Event, URL, fetch */
import { readFileSync } from 'node:fs';
import { resolveObjectURL } from 'node:buffer';
import { Worker as NodeWorker } from 'node:worker_threads';

// Web platform transport only. The production KTX2Loader generates its own worker body,
// calls the shipped Basis WASM and returns actual compressed mip payloads. No renderer exists.
export function cpuWebAdapter(publicRoot) {
  const saved = new Map(['Worker', 'fetch', 'Request', 'ProgressEvent', 'self'].map((k) => [k, globalThis[k]]));
  const workers = [];
  const terminations = [];
  const blobFetch = fetch;
  class BrowserWorker {
    constructor(url) {
      this.listeners = [];
      const blob = resolveObjectURL(url);
      if (!blob) throw new Error('Expected the production loader worker Blob');
      this.ready = blob.text().then((body) => {
        const prefix = `const { parentPort } = require('node:worker_threads');
          globalThis.self = globalThis;
          globalThis.location = {href:'http://t08.invalid/basis/worker.js'};
          globalThis.addEventListener = (kind, fn) => { if(kind==='message') parentPort.on('message', data=>fn({data})); };
          globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
        `;
        this.worker = new NodeWorker(prefix + body, { eval: true });
        this.exited = new Promise((resolve) => this.worker.once('exit', resolve));
        this.worker.on('message', (data) => this.listeners.forEach((fn) => fn({ data })));
        this.worker.on('error', (error) => this.listeners.forEach((fn) => fn({ data: { type: 'error', error: error.message } })));
        return this.worker;
      });
      workers.push(this);
    }
    addEventListener(kind, fn) {
      if (kind !== 'message') throw new Error(`Unsupported worker event ${kind}`);
      this.listeners.push(fn);
    }
    postMessage(data, transfer) {
      this.ready.then((worker) => worker.postMessage(data, transfer));
    }
    terminate() {
      const completion = this.ready.then(async (worker) => {
        await worker.terminate();
        await this.exited;
      });
      terminations.push(completion);
    }
  }
  globalThis.Worker = BrowserWorker;
  globalThis.self = globalThis;
  globalThis.ProgressEvent = class extends Event {
    constructor(type, values) {
      super(type);
      Object.assign(this, values);
    }
  };
  globalThis.Request = class extends Request {
    constructor(url, options) {
      super(typeof url === 'string' && url.startsWith('/') ? `http://t08.invalid${url}` : url, options);
    }
  };
  globalThis.fetch = async (request, options) => {
    const url = typeof request === 'string' ? request : request.url;
    if (url.startsWith('blob:')) return blobFetch(request, options);
    const parsed = new URL(url);
    if (parsed.origin !== 'http://t08.invalid' || !['/basis/basis_transcoder.js', '/basis/basis_transcoder.wasm'].includes(parsed.pathname)) {
      throw new Error(`CPU asset test refused external fetch: ${url}`);
    }
    const bytes = readFileSync(new URL('.' + parsed.pathname, publicRoot));
    return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
  };
  return async () => {
    for (const worker of workers) worker.terminate();
    await Promise.all(terminations);
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}
