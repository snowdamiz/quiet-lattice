// A cutscene's clock and what it shows when (docs/ARCHITECTURE.md "Cutscenes"): the definition exported from Blender,
// checked as it loads, and the timeline that plays it on game time, so `window.step()` and captures are deterministic.
//
// The clock runs from 0 to the definition's duration while the cutscene plays; the letterbox eases in from the start
// and out once the clock is done (or skipped), while the camera returns to the player. Lines of dialogue show over
// their spans, revealed a few characters a frame; a key reveals the rest of a line, and pressed again jumps the clock
// to the next line (or the end). Events fire as the clock passes them, in order; a jump or a skip fires every event it
// passes, so whatever listens (the quest engine, the banners) ends in the state the cutscene would have left.
import { easeInOutCubic } from './curve.js';

export const CUTSCENE_FORMAT = 'astra.cutscene';
export const CUTSCENE_VERSION = 1;

/** Seconds the letterbox takes to close in, and to open out. */
export const LETTERBOX_IN = 0.9;
export const LETTERBOX_OUT = 0.9;
/** Seconds after the clock ends before the cutscene is done: the camera's glide back to the player. */
export const EXIT_SECONDS = 1.5;
/** Characters of a line revealed per second. */
export const REVEAL_CPS = 48;
/** Seconds a line takes to fade in and to fade out at the ends of its span. */
export const LINE_FADE_IN = 0.22;
export const LINE_FADE_OUT = 0.3;
/** The framing cameras are composed for, when a definition gives none (anamorphic widescreen). */
export const DEFAULT_ASPECT = 2.39;
/** Each bar is at least this fraction of the screen's height, so the letterbox reads on an ultrawide screen too. */
export const MIN_BAR = 0.075;

/** Who a speaker speaks for: the palette their name is drawn in (art bible §4). */
export const VOICES = ['compact', 'reaches', 'chorus', 'thalune', 'ixari', 'ulgani', 'hollow', 'cartographer', 'self'];
/** Where a cutscene is authored: the Waystation's frame, the player's (whichever it is in), the inertial frame, or a
 * planet or moon's (`home`, or `body:<index>` in the system's order). */
const FRAME = /^(station|player|inertial|home|body:(0|[1-9]\d{0,2}))$/;
/** Cutscene ids name files under public/cutscenes/. */
export const CUTSCENE_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const fail = (id, msg) => {
  throw new Error(`cutscene ${id}: ${msg}`);
};

/**
 * Checks an exported definition and returns it ready to play (shots, lines and events in time order). Throws with the
 * first thing wrong, naming it.
 */
export function parseCutscene(json) {
  const id = json?.id;
  if (json?.format !== CUTSCENE_FORMAT) fail(id, `not a cutscene (format ${json?.format})`);
  if (json.version !== CUTSCENE_VERSION) fail(id, `version ${json.version}; this client reads ${CUTSCENE_VERSION}`);
  if (typeof id !== 'string' || !CUTSCENE_ID.test(id)) fail(id, 'bad id');
  const duration = json.duration;
  if (!finite(duration) || duration <= 0 || duration > 600) fail(id, `duration ${duration}`);
  const space = { frame: json.space?.frame, anchor: json.space?.anchor ?? 'origin' };
  if (!FRAME.test(space.frame ?? '')) fail(id, `frame ${space.frame}`);
  if (space.anchor !== 'origin' && space.anchor !== 'player') fail(id, `anchor ${space.anchor}`);
  if ((space.frame === 'inertial' || space.frame === 'player') && space.anchor !== 'player') fail(id, `a ${space.frame} cutscene is anchored on the player`);
  const aspect = json.aspect ?? DEFAULT_ASPECT;
  if (!finite(aspect) || aspect < 1 || aspect > 4) fail(id, `aspect ${aspect}`);

  const shots = (json.shots ?? []).map((s, i) => {
    const n = s.fov?.length ?? 0;
    if (typeof s.name !== 'string' || !s.name) fail(id, `shot ${i} has no name`);
    if (!finite(s.start) || !finite(s.end) || s.end <= s.start) fail(id, `shot ${s.name} spans ${s.start}–${s.end}`);
    if (!finite(s.fps) || s.fps <= 0 || s.fps > 240) fail(id, `shot ${s.name} at ${s.fps} fps`);
    if (n < 1 || s.pos?.length !== n * 3 || s.quat?.length !== n * 4) fail(id, `shot ${s.name} has mismatched samples`);
    if (![...s.pos, ...s.quat, ...s.fov].every(finite)) fail(id, `shot ${s.name} has a sample that is not a number`);
    if (!s.fov.every((f) => f > 1 && f < 170)) fail(id, `shot ${s.name} has a field of view out of range`);
    const transition = s.transition ?? 'cut';
    if (transition !== 'cut' && transition !== 'dip') fail(id, `shot ${s.name} transition ${transition}`);
    return { name: s.name, start: s.start, end: s.end, fps: s.fps, pos: s.pos, quat: s.quat, fov: s.fov, transition };
  });
  if (!shots.length) fail(id, 'no shots');
  shots.sort((a, b) => a.start - b.start);
  if (Math.abs(shots[0].start) > 1e-6) fail(id, `the first shot starts at ${shots[0].start}, not 0`);
  for (let i = 1; i < shots.length; i++) if (shots[i].start < shots[i - 1].end - 1e-6) fail(id, `shots ${shots[i - 1].name} and ${shots[i].name} overlap`);

  const lines = (json.lines ?? []).map((l, i) => {
    const lid = l.id ?? `line${i + 1}`;
    if (!finite(l.t) || !finite(l.dur) || l.t < 0 || l.dur <= 0 || l.t + l.dur > duration + 1e-6) fail(id, `line ${lid} spans ${l.t}+${l.dur}`);
    if (typeof l.speaker !== 'string' || !l.speaker || l.speaker.length > 48) fail(id, `line ${lid} speaker`);
    if (typeof l.text !== 'string' || !l.text || l.text.length > 280) fail(id, `line ${lid} text`);
    const voice = l.voice ?? 'self';
    if (!VOICES.includes(voice)) fail(id, `line ${lid} voice ${voice}`);
    return { id: String(lid), t: l.t, dur: l.dur, speaker: l.speaker, voice, text: l.text };
  });
  lines.sort((a, b) => a.t - b.t);
  for (let i = 1; i < lines.length; i++) if (lines[i].t < lines[i - 1].t + lines[i - 1].dur - 1e-6) fail(id, `lines ${lines[i - 1].id} and ${lines[i].id} overlap`);

  const events = (json.events ?? []).map((e, i) => {
    if (!finite(e.t) || e.t < 0 || e.t > duration + 1e-6) fail(id, `event ${i} at ${e.t}`);
    if (typeof e.name !== 'string' || !e.name) fail(id, `event ${i} has no name`);
    const banner = e.banner ? { title: String(e.banner.title ?? ''), sub: String(e.banner.sub ?? '') } : null;
    if (banner && !banner.title) fail(id, `event ${e.name}'s banner has no title`);
    return { name: e.name, t: e.t, banner };
  });
  events.sort((a, b) => a.t - b.t);

  const enter = json.enter ?? 'glide';
  const exit = json.exit ?? 'glide';
  if (!['glide', 'dip', 'cut'].includes(enter) || !['glide', 'dip'].includes(exit)) fail(id, `enter ${enter} / exit ${exit}`);
  const stage = json.stage?.player ? { player: { pos: [...json.stage.player.pos], quat: [...json.stage.player.quat] } } : null;
  return { id, title: json.title ?? id, duration, space, aspect, shots, lines, events, enter, exit, stage };
}

/**
 * The letterbox for a screen: each bar's height in pixels when fully closed in, and what is left between them. Bars
 * frame the definition's aspect, and are never thinner than MIN_BAR of the height.
 */
export function letterboxBar(width, height, aspect = DEFAULT_ASPECT) {
  const bar = Math.max((height - width / aspect) / 2, height * MIN_BAR);
  return { bar, band: height - 2 * bar };
}

/**
 * The full screen's vertical field of view (degrees) that shows `fov` (the cameras' authored vertical field of view)
 * across the band between the closed bars: the picture the artist framed in Blender shows exactly in the band.
 */
export function canvasFov(fov, height, band) {
  const half = (fov * Math.PI) / 360;
  return (Math.atan(Math.tan(half) * (height / band)) * 360) / Math.PI;
}

/**
 * Plays a definition on game time. `update(dt)`, `advance()` and `skip()` return the events they fired, in order;
 * `fired` keeps every one.
 */
export class Timeline {
  constructor(def) {
    this.def = def;
    /** cutscene time (s), 0..duration */
    this.clock = 0;
    /** game time since it began (s); unlike the clock, never jumps */
    this.age = 0;
    /** 'play' while the clock runs; 'exit' once it is done (the letterbox opening, the camera going back); 'done' */
    this.phase = 'play';
    /** game time since the clock ended, and how closed the letterbox was then */
    this.exitAge = 0;
    this.exitFrom = 1;
    this.skipped = false;
    /** events fired so far, with how: { name, t, banner, skipped } */
    this.fired = [];
    this.nextEvent = 0;
    /** lines whose reveal a key completed */
    this.revealed = new Set();
  }

  /** How closed the letterbox is, 0..1, eased: closing from the start, opening from wherever it was when the clock
   * ended (a skip during the closing opens it from there). */
  get letterbox() {
    if (this.phase === 'play') return easeInOutCubic(this.age / LETTERBOX_IN);
    if (this.phase === 'exit') return this.exitFrom * (1 - easeInOutCubic(this.exitAge / LETTERBOX_OUT));
    return 0;
  }

  /** Advances by `dt` seconds of game time. */
  update(dt) {
    if (this.phase === 'done') return [];
    this.age += dt;
    if (this.phase === 'exit') {
      this.exitAge += dt;
      if (this.exitAge >= EXIT_SECONDS) this.phase = 'done';
      return [];
    }
    return this.seek(Math.min(this.def.duration, this.clock + dt), false);
  }

  /** The line showing now, if any: the line, its index, how far its reveal has come (characters), and its opacity. */
  line() {
    if (this.phase !== 'play') return null;
    const lines = this.def.lines;
    const t = this.clock;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (t < l.t) break;
      if (t >= l.t + l.dur) continue;
      const since = t - l.t;
      // (the reveal's position in characters; a key shows the whole line)
      const reveal = this.revealed.has(l.id) ? Infinity : since * REVEAL_CPS;
      const alpha = Math.min(1, since / LINE_FADE_IN, (l.t + l.dur - t) / LINE_FADE_OUT);
      return { line: l, index: i, reveal, since, alpha: Math.max(0, alpha), complete: reveal >= l.text.length };
    }
    return null;
  }

  /**
   * The player's key: shows the rest of a line still being revealed; otherwise jumps the clock to the next line's start
   * (or the end, when none is left), firing what it passes. Returns { did: 'revealed' | 'jumped' | null, events }.
   */
  advance() {
    if (this.phase !== 'play') return { did: null, events: [] };
    const now = this.line();
    if (now && !now.complete) {
      this.revealed.add(now.line.id);
      return { did: 'revealed', events: [] };
    }
    const next = this.def.lines.find((l) => l.t > this.clock + 1e-6);
    return { did: 'jumped', events: this.seek(next ? next.t : this.def.duration, false) };
  }

  /** Ends it now: fires every event still to come (marked skipped) and starts the exit. Returns those events. */
  skip() {
    if (this.phase !== 'play') return [];
    this.skipped = true;
    return this.seek(this.def.duration, true);
  }

  /** Moves the clock forward to `t`, firing the events it passes; the end of the clock starts the exit. */
  seek(t, skipped) {
    const out = [];
    const events = this.def.events;
    this.clock = Math.max(this.clock, Math.min(t, this.def.duration));
    while (this.nextEvent < events.length && events[this.nextEvent].t <= this.clock + 1e-9) {
      const e = { ...events[this.nextEvent++], skipped };
      out.push(e);
      this.fired.push(e);
    }
    if (this.clock >= this.def.duration && this.phase === 'play') {
      this.exitFrom = this.letterbox;
      this.phase = 'exit';
    }
    return out;
  }
}
