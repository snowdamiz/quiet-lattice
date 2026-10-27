// The server's clock as the client estimates it (docs/ARCHITECTURE.md §3). Each `pong` echoes the client time its ping
// left at and stamps the server's world time; taking the reply's way back as half the round trip, the offset between the
// two clocks is serverTime + rtt / 2 − (client time on arrival). Of the last few samples the one with the shortest round
// trip wins: a slow trip says least about when the server stamped it.

/** Samples kept: with a ping every 2 s, the best of the last 16 s. */
const KEEP = 8;

export class ClockSync {
  constructor(keep = KEEP) {
    this.keep = keep;
    this.samples = [];
    /** server time − client time, in seconds; null before the first sample */
    this.offset = null;
    /** the round trip of the sample the offset comes from, ms */
    this.rtt = null;
  }

  /** A round trip: the client time (ms) the request left at, the server's world time (s) in its reply, the client time
   * (ms) the reply arrived at. */
  sample(sentMs, serverTime, receivedMs) {
    if (!Number.isFinite(sentMs) || !Number.isFinite(serverTime) || !Number.isFinite(receivedMs)) return;
    const rtt = Math.max(0, receivedMs - sentMs);
    this.samples.push({ rtt, offset: serverTime + rtt / 2000 - receivedMs / 1000 });
    if (this.samples.length > this.keep) this.samples.shift();
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.offset = best.offset;
    this.rtt = best.rtt;
  }

  /** The server's world time (s) at client time `clientMs`, or null before the first sample. */
  now(clientMs) {
    return this.offset === null ? null : clientMs / 1000 + this.offset;
  }

  reset() {
    this.samples = [];
    this.offset = null;
    this.rtt = null;
  }
}
