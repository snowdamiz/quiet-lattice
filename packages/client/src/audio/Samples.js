// Recorded sound: the effects and ambiences in public/audio (decoded once, played and looped
// through WebAudio) and the music (streamed from <audio> elements: decoded whole, a few minutes of
// stereo music would take hundreds of MB). public/audio/manifest.json says which files fill which
// slot, whether they loop and how loud they sit; CREDITS.md says where they come from. Anything
// without a recording falls back to the synthesized voices in Audio.js.

// the game's sound names, and the slots that play them
const ALIASES = {
  ui: 'ui_click',
  hover: 'ui_hover',
  error: 'ui_back',
  sell: 'ui_confirm',
  shipLaser: 'laser',
  landing: 'gear',
  pulse: 'pulse_engage',
  pulseExit: 'pulse_exit',
  warpArrive: 'warp_arrive',
  rcs: 'rcs_puff',
};
// small random detune per one-shot, so repeats do not machine-gun
const VARY = { step: 0.06, rcs_puff: 0.08, laser: 0.05, impact: 0.06, break: 0.05, land: 0.05, creak: 0.08, hiss: 0.06, jump: 0.05 };

export class SampleBank {
  constructor(ctx, out, reverb) {
    this.ctx = ctx;
    this.out = out;
    this.reverb = reverb;
    this.slots = {};
    this.loops = {};
    this.ready = false;
  }

  async load(url) {
    let man;
    try {
      man = await (await fetch(url)).json();
    } catch {
      return;
    }
    this.manifest = man;
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    await Promise.all(
      Object.entries(man)
        .filter(([slot, def]) => !slot.startsWith('music') && def?.files?.length)
        .map(async ([slot, def]) => {
          const bufs = await Promise.all(
            def.files.map((f) =>
              fetch(base + f)
                .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(f))))
                .then((a) => this.ctx.decodeAudioData(a))
                .catch(() => null),
            ),
          );
          const ok = bufs.filter(Boolean);
          if (!ok.length) return;
          this.slots[slot] = { bufs: ok, gain: def.gain ?? 0.8, loop: !!def.loop, last: -1 };
          if (def.loop) this.startLoop(slot);
        }),
    );
    this.ready = true;
  }

  has(slot) {
    return !!this.slots[slot];
  }

  // a looping bed, silent until update() turns it up
  startLoop(slot) {
    const s = this.slots[slot];
    const src = this.ctx.createBufferSource();
    src.buffer = s.bufs[0];
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.out);
    src.start(0, Math.random() * src.buffer.duration);
    this.loops[slot] = { src, g, base: s.gain };
  }

  // level 0..1 (times the slot's own gain) and playback rate, eased over `tc` seconds
  setLoop(slot, level, rate = 1, tc = 0.15) {
    const l = this.loops[slot];
    if (!l) return false;
    const t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(Math.max(0, level) * l.base, t, tc);
    l.src.playbackRate.setTargetAtTime(rate, t, tc);
    return true;
  }

  // a one-shot; false when there is no recording for it (the synth plays it instead)
  play(name, opts = {}) {
    let slot = ALIASES[name] || name;
    if (name === 'step') {
      const s = opts.surface;
      const pick = s === 'metal' ? 'step_metal' : s === 'snow' ? 'step_snow' : s === 'sand' ? 'step_sand' : s === 'rock' ? 'step_rock' : Math.random() < 0.5 ? 'step_grass' : 'step_dirt';
      slot = this.slots[pick] ? pick : ['step_dirt', 'step_grass', 'step_rock'].find((k) => this.slots[k]);
      if (!slot) return false;
    }
    if (name === 'thunder') {
      const far = (opts.dist ?? 3000) > 2500;
      const want = far ? ['thunder_far', 'thunder_close'] : ['thunder_close', 'thunder_far'];
      slot = want.find((k) => this.slots[k] || this.prefixed(k));
      if (!slot) return false;
      if (!this.slots[slot]) slot = this.prefixed(slot);
    }
    if (!this.slots[slot] && this.prefixed(slot)) slot = this.prefixed(slot);
    const s = this.slots[slot];
    if (!s) return false;
    // a different take from last time, where there are several
    let i = Math.floor(Math.random() * s.bufs.length);
    if (s.bufs.length > 1 && i === s.last) i = (i + 1) % s.bufs.length;
    s.last = i;
    const src = this.ctx.createBufferSource();
    src.buffer = s.bufs[i];
    const vary = VARY[name] ?? VARY[slot] ?? 0;
    src.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    const g = this.ctx.createGain();
    g.gain.value = s.gain * (opts.gain ?? 1);
    src.connect(g).connect(this.out);
    if (opts.rev) g.connect(this.reverb);
    src.start(this.ctx.currentTime + (opts.delay || 0));
    return true;
  }

  // numbered takes saved as their own slots (thunder_close_1, thunder_close_2…): fold them together
  prefixed(slot) {
    const keys = Object.keys(this.slots).filter((k) => k.startsWith(slot + '_') && /_\d+$/.test(k));
    if (!keys.length) return null;
    if (!this.slots[slot]) this.slots[slot] = { bufs: keys.flatMap((k) => this.slots[k].bufs), gain: this.slots[keys[0]].gain, loop: false, last: -1 };
    return slot;
  }
}

// Music: a track for the moment (the title, flying in space, out on a world), a long quiet gap
// after it, then another; a change of scene that lasts fades the playing track out early.
export class MusicPlayer {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.tracks = {};
    this.cur = null;
    this.context = null;
    this.nextAt = 0;
  }

  setTracks(manifest, base) {
    for (const [slot, def] of Object.entries(manifest)) {
      if (!slot.startsWith('music') || !def?.files?.length) continue;
      // music_title, music_space_1, music_planet_2 → title, space, planet
      const kind = slot.replace(/^music_/, '').replace(/_\d+$/, '');
      (this.tracks[kind] ||= []).push(...def.files.map((f) => ({ url: base + f, gain: def.gain ?? 1 })));
    }
  }

  get available() {
    return Object.keys(this.tracks).length > 0;
  }

  start(kind) {
    const list = this.tracks[kind] || this.tracks.space || Object.values(this.tracks)[0];
    if (!list?.length) return;
    // not the same piece twice running
    let pick = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && this.lastUrl === pick.url) pick = list[(list.indexOf(pick) + 1) % list.length];
    this.lastUrl = pick.url;
    const el = document.createElement('audio');
    el.src = pick.url;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    const src = this.ctx.createMediaElementSource(el);
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.out);
    g.gain.setTargetAtTime(pick.gain, this.ctx.currentTime, 1.5);
    el.play().catch(() => {});
    this.cur = { el, g, kind, startedAt: this.ctx.currentTime };
  }

  stop(fade = 4) {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    c.g.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    setTimeout(() => {
      c.el.pause();
      c.el.removeAttribute('src');
      c.el.load();
    }, fade * 1000 + 200);
  }

  update(kind) {
    const t = this.ctx.currentTime;
    if (kind !== this.context) {
      this.context = kind;
      this.changedAt = t;
    }
    const c = this.cur;
    if (c) {
      if (c.el.ended) {
        this.cur = null;
        // a quiet stretch before the next piece (short on the title screen)
        this.nextAt = t + (kind === 'title' ? 4 : 40 + Math.random() * 70);
      } else if (c.kind !== kind && t - this.changedAt > (c.kind === 'title' ? 0.5 : 12)) {
        // the scene has changed for good: let this one go
        this.stop(c.kind === 'title' ? 3 : 6);
        this.nextAt = t + (c.kind === 'title' ? 18 : 25);
      }
      return;
    }
    if (t >= this.nextAt) this.start(kind);
  }

  pause(on) {
    if (this.cur) {
      if (on) this.cur.el.pause();
      else this.cur.el.play().catch(() => {});
    }
  }
}
