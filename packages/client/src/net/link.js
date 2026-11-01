// A bad network on demand, for dev builds (`?lag=<ms>&loss=<%>`) and the prediction smoke spec: a stand-in for the
// WebSocket class (Net takes it as `WebSocket`) whose sockets hold every message `latencyMs` each way and lose `loss` of
// them, each way, so play can be felt and tested under latency and loss against a local server. Loss starts at the
// welcome: the handshake always gets through, since a session that never starts tests nothing. Each way keeps its order.
// `now` is the page's clock (ms), so a spec that steps the page's clock steps the link with it; `pump()` delivers what is
// due by then. `stats` says how many input `seq`s went onto the wire and the newest `ack` a snapshot brought back over it
// (as it arrived, before it is held), so a spec stepping both clocks can wait for the server to have handled every input
// sent; `dropNext(type)` loses the next server message of that type.
import { decodeClientMessage, decodeSnapshot } from '@astra/shared/protocol';

const OPEN = 1;

export function linkConditioner({ latencyMs = 100, loss = 0.02, seed = 1, now = () => performance.now(), timers = globalThis, WebSocket = globalThis.WebSocket } = {}) {
  const random = mulberry32(seed);
  const sockets = new Set();
  const drops = new Set();
  const stats = { released: 0, answered: 0, lostOut: 0, lostIn: 0 };

  class LinkSocket {
    constructor(url) {
      this.ws = new WebSocket(url);
      /** what is held each way, in order: {at, data} (and on the way in, the socket's close as {at, close}) */
      this.out = [];
      this.in = [];
      this.armed = false;
      this.timer = null;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.ws.onopen = (e) => this.onopen?.(e);
      this.ws.onerror = (e) => this.onerror?.(e);
      this.ws.onmessage = (e) => this.arrive(e.data);
      this.ws.onclose = (e) => this.hold(this.in, { close: e });
      sockets.add(this);
    }

    get readyState() {
      return this.ws.readyState;
    }

    get binaryType() {
      return this.ws.binaryType;
    }

    set binaryType(v) {
      this.ws.binaryType = v;
    }

    send(data) {
      if (this.armed && random() < loss) stats.lostOut++;
      else this.hold(this.out, { data });
    }

    close(code, reason) {
      this.ws.close(code, reason);
    }

    arrive(data) {
      let type = null;
      if (typeof data === 'string') {
        type = /^\{"t":"(\w+)"/.exec(data)?.[1] ?? null;
        if (type === 'welcome') this.armed = true;
      } else {
        const snap = decodeSnapshot(new Uint8Array(data));
        if (snap) stats.answered = Math.max(stats.answered, snap.ack);
      }
      if (type !== null && drops.delete(type)) stats.lostIn++;
      else if (this.armed && type !== 'welcome' && random() < loss) stats.lostIn++;
      else this.hold(this.in, { data });
    }

    hold(queue, m) {
      m.at = now() + latencyMs;
      queue.push(m);
      this.pump();
    }

    pump() {
      const t = now();
      while (this.out.length && this.out[0].at <= t) {
        const { data } = this.out.shift();
        if (this.ws.readyState !== OPEN) continue;
        this.ws.send(data);
        const msg = typeof data === 'string' ? decodeClientMessage(data) : null;
        if (msg?.t === 'input') stats.released = Math.max(stats.released, msg.seq);
      }
      while (this.in.length && this.in[0].at <= t) {
        const m = this.in.shift();
        if (!m.close) this.onmessage?.({ data: m.data });
        else {
          sockets.delete(this);
          this.onclose?.(m.close);
        }
      }
      if (this.timer !== null) timers.clearTimeout(this.timer);
      this.timer = null;
      const next = Math.min(this.out[0]?.at ?? Infinity, this.in[0]?.at ?? Infinity);
      if (next < Infinity) this.timer = timers.setTimeout(() => this.pump(), Math.max(1, next - t));
    }
  }

  return {
    WebSocket: LinkSocket,
    stats,
    dropNext(type) {
      drops.add(type);
    },
    pump() {
      for (const s of sockets) s.pump();
    },
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
