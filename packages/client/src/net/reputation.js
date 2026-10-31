// The client's side of reputation (docs/ARCHITECTURE.md §24, DESIGN 14.4): standing is the server's. The client keeps the
// character's reputation as the server last sent it (`reputation` state: every faction's standing and rank, and the titles
// earned) and the rank and title events of each change, for the reputation screens (P2.E18.T02 on) to read and toast,
// and writes each change to the console until they do. Nothing here is ever sent: no client message changes standing.

/** How many rank and title events are kept for a screen to take. */
export const NEWS_KEPT = 16;

export class Reputation {
  /** `log` writes a line about each change (the console by default; tests catch it). */
  constructor(net, { log = (line) => console.info(line) } = {}) {
    this.net = net;
    this.log = log;
    /** The last `reputation` view: `{factions: [{faction, rep, rank}], titles: [{title, faction?, quest?}]}`, or null before
     * the first. */
    this.view = null;
    /** Rank and title events since a screen last took them, oldest first. */
    this.news = [];
    /** Bumped whenever the view changes, so screens can tell when to redraw. */
    this.rev = 0;
    net.on('reputation', (m) => this.receive(m.reputation));
    net.on('event', ({ event }) => {
      if (event.kind === 'rank' || event.kind === 'title') this.note(event);
    });
  }

  /** The server's view replaces the one held; each faction whose standing moved is logged. */
  receive(view) {
    const before = this.view;
    this.view = view;
    this.rev++;
    // (the first view is the state as loaded, not a change; one after a reconnect logs what moved while away)
    if (!before) return;
    for (const f of view.factions) {
      const was = before.factions.find((x) => x.faction === f.faction)?.rep ?? 0;
      if (f.rep !== was) this.log(`reputation: ${f.faction} ${was} -> ${f.rep}${f.rank ? ` (${f.rank})` : ''}`);
    }
  }

  note(event) {
    this.news.push(event);
    if (this.news.length > NEWS_KEPT) this.news.shift();
    if (event.kind === 'rank') this.log(`reputation: ${event.faction} rank ${event.from ?? 'none'} -> ${event.rank ?? 'none'}`);
    else this.log(`reputation: title earned: ${event.title.title}${event.title.faction ? ` (${event.title.faction})` : ''}`);
  }

  /** A faction's standing, 0–1000 (0 before the first view). */
  standing(faction) {
    return this.view?.factions.find((f) => f.faction === faction)?.rep ?? 0;
  }

  /** A faction's rank id, or null (below its first threshold, or before the first view). */
  rank(faction) {
    return this.view?.factions.find((f) => f.faction === faction)?.rank ?? null;
  }

  /** The titles earned, in the order earned. */
  get titles() {
    return this.view?.titles ?? [];
  }

  /** Takes the rank and title events that arrived since the last call. */
  take() {
    return this.news.splice(0);
  }
}
