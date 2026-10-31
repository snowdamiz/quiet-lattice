// The client's side of world events (docs/ARCHITECTURE.md §25, DESIGN 14.6): the server announces each event to its star
// system, puts a player who goes to its place in one of its instances and pays by contribution when it ends. The feed
// keeps the events the server has told of (`events`, by id), the player's standing in the one it is in (`status`: the
// instance, its scaling level, the wave, the enemies left, its contribution and share) and its last reward, and queues
// what the HUD shows: a banner as an event is announced, starts and ends, and toasts as the player joins an instance, as
// its level changes and as it is paid. Nothing here decides anything; a full event panel is later work.

/** Banners and toasts waiting for the HUD, at most (a hidden page's backlog is bounded). */
const QUEUE_MAX = 8;

export class WorldEvents {
  constructor(net) {
    this.net = net;
    /** events told of, by id: their view and the last news ('announced', 'started') */
    this.events = new Map();
    /** the player's last status in an event instance, or null */
    this.status = null;
    /** the last reward it was paid, or null */
    this.reward = null;
    this.queue = [];
    /** names the world a frame id is (set by the game, which knows the system's bodies); null when it knows none */
    this.worldName = () => null;
    net.on('world_event', (m) => this.news(m));
    net.on('event_status', (m) => this.standing(m));
    net.on('event_reward', (m) => this.paid(m));
    net.on('welcome', () => {
      this.events.clear();
      this.status = null;
      this.queue.length = 0;
    });
  }

  news(m) {
    const e = m.event;
    if (m.op === 'ended') {
      this.events.delete(e.id);
      if (this.status?.id === e.id) this.status = null;
      this.push({ banner: true, title: e.name.toUpperCase(), sub: this.eyebrow(e, m.outcome === 'completed' ? 'cleared' : 'over') });
      return;
    }
    const known = this.events.get(e.id);
    this.events.set(e.id, { ...e, op: m.op });
    if (known?.op === m.op) return;
    if (m.op === 'announced') this.push({ banner: true, title: e.name.toUpperCase(), sub: this.eyebrow(e, until(e.starts - (this.net.serverTime() ?? e.starts))) });
    else this.push({ banner: true, title: e.name.toUpperCase(), sub: this.eyebrow(e, 'under way') });
  }

  /** The banner's eyebrow: what it is, where (the event's world, once the game can name it) and how it stands. */
  eyebrow(e, state) {
    return ['World event', this.worldName(e.frame), state].filter(Boolean).join(' · ');
  }

  standing(m) {
    const before = this.status;
    this.status = m;
    const name = this.events.get(m.id)?.name ?? 'World event';
    if (!before || before.id !== m.id || before.phase !== m.phase) this.push({ text: `${name}: you are in · scaled for ${m.level}`, tone: 'info' });
    else if (before.level !== m.level) this.push({ text: `${name}: scaled for ${m.level}`, tone: 'info' });
  }

  paid(m) {
    this.reward = m;
    if (this.status?.id === m.id) this.status = null;
    const parts = [];
    if (m.xp > 0) parts.push(`+${m.xp} XP`);
    if (m.units > 0) parts.push(`+${m.units} units`);
    for (const x of m.items) parts.push(`+${x.count} ${x.item.replace(/_/g, ' ')}`);
    this.push(parts.length ? { text: `Event reward · ${parts.join(' · ')}`, tone: 'good' } : { text: 'Event over · too little done for a share', tone: 'warn' });
  }

  push(x) {
    this.queue.push(x);
    if (this.queue.length > QUEUE_MAX) this.queue.shift();
  }

  /** Takes what the HUD has not shown yet: `{banner, title, sub}` and `{text, tone}`. */
  take() {
    return this.queue.splice(0);
  }
}

/** "starting now", "in under a minute", "in 2 minutes": under 30 s it is not yet a minute, and 90 s rounds to two. */
function until(seconds) {
  if (seconds <= 0) return 'starting now';
  if (seconds < 30) return 'in under a minute';
  const m = Math.round(seconds / 60);
  return m <= 1 ? 'in a minute' : `in ${m} minutes`;
}
