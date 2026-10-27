// Plays cutscenes in-engine (DESIGN 8 "Cutscenes in-engine", 14.1, 19.2; docs/ARCHITECTURE.md §15): a
// definition exported from Blender (public/cutscenes/<id>.json) driving the camera through the camera-glide system
// (CameraDirector), the letterbox and the dialogue bar (ui/Cinematic.js) and the banners (HUD.showBanner) on game time.
//
// A cutscene always plays in a phase, and only when the server says so: online it asks the server through the game's
// Net (link.js NetCutsceneLink) and plays on `play`, never on a refusal or a silence; the offline link is the dev
// sandbox's only. While it plays, game.overlay is 'cutscene': the player's controls are locked like under any menu,
// except the cutscene's own keys (Space, Enter or a click for the next line; Esc skips it, in one press: through
// Menus.closeAll, or under pointer lock, where the browser takes Esc to release the lock, through that release). A skip
// fires every event still to come, so listeners end where watching would have left them, and the camera glides back to
// the player.
import { CUTSCENE_ID, EXIT_SECONDS, Timeline, canvasFov, letterboxBar, parseCutscene } from './timeline.js';
import { sampleShots, shotAt } from './curve.js';
import { anchorSpace, placeInSpace, resolveFrame } from './space.js';
import { NetCutsceneLink, OfflineCutsceneLink } from './link.js';
import { Cinematic } from '../ui/Cinematic.js';

/** Keys that show the rest of a line, then go on to the next. (Esc skips through Menus.closeAll.) */
const ADVANCE_KEYS = ['Space', 'Enter', 'NumpadEnter'];
/** Seconds of the dip a jump to the next line cuts behind. */
const JUMP_DIP = 0.35;
/** Seconds the camera takes to glide from the player's view into the cutscene. */
const GLIDE_IN = 1.6;
/** Opacity of the keys' hint in the lower bar (quiet, and still AA on black). */
const KEYS_ALPHA = 0.85;

export class CutscenePlayer {
  /** `link` overrides the link every cutscene asks through (tests); otherwise linkFor() picks it. */
  constructor(game, { link = null } = {}) {
    this.game = game;
    this.fixedLink = link;
    this.offline = new OfflineCutsceneLink();
    this.netLink = null;
    /** the link the last cutscene asked through */
    this.link = null;
    this.ui = new Cinematic(game.hudEl);
    /** definitions by id, as they load */
    this.defs = new Map();
    /** the cutscene playing: { def, timeline, space, phase, shot, line, sample, done } */
    this.current = null;
    this.listeners = { start: new Set(), line: new Set(), event: new Set(), end: new Set() };
    // Esc closes whatever overlay is up; the cutscene's closing is a skip
    game.menus.extraOverlays = [...(game.menus.extraOverlays || []), { name: 'cutscene', el: this.ui.el, onClose: () => this.skip() }];
    // Under pointer lock the browser takes Esc to release the lock, and the page never sees the key: a lock released
    // while a cutscene plays, with the window still focused (not an alt-tab), is that Esc, and skips at once.
    this.pointerLocked = false;
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (this.pointerLocked && !locked && document.hasFocus()) this.skip();
      this.pointerLocked = locked;
    });
  }

  /**
   * The link a cutscene asks through: the server's (through game.net) whenever the game is online, the offline one in
   * the dev sandbox (no game.net, a dev build), none otherwise.
   */
  linkFor() {
    if (this.fixedLink) return this.fixedLink;
    const net = this.game.net;
    if (net) {
      if (this.netLink?.net !== net) {
        this.netLink?.dispose();
        this.netLink = new NetCutsceneLink(net);
        this.netLink.onEnded = (id) => this.serverEnded(id);
      }
      return this.netLink;
    }
    return import.meta.env.DEV ? this.offline : null;
  }

  /** The server ended the cutscene playing (it took the player out of the phase): it ends here too, as a skip would. */
  serverEnded(id) {
    if (this.current?.def.id === id) this.skip();
  }

  /** Playing, or giving the camera back. */
  get active() {
    return !!this.current;
  }

  /** How closed the letterbox is, 0..1 (the HUD fades out as it closes). */
  get letterbox() {
    return this.current ? this.current.timeline.letterbox : 0;
  }

  /**
   * Listens for `start` ({id, phase}), `line` (each line as it first shows), `event` (each event as it fires, with
   * `skipped` when a skip fired it) or `end` ({id, skipped, phase, events}). Returns the way to stop listening.
   */
  on(type, fn) {
    this.listeners[type].add(fn);
    return () => this.listeners[type].delete(fn);
  }

  /** Loads (once) and checks a definition. */
  load(id) {
    if (!CUTSCENE_ID.test(id)) return Promise.reject(new Error(`no cutscene '${id}'`));
    let p = this.defs.get(id);
    if (!p) {
      p = fetch(`/cutscenes/${id}.json`)
        .then((r) => {
          if (!r.ok) throw new Error(`cutscene ${id}: ${r.status} ${r.statusText}`);
          return r.json();
        })
        .then(parseCutscene);
      this.defs.set(id, p);
      p.catch(() => this.defs.delete(id));
    }
    return p;
  }

  /**
   * Plays cutscene `id` where the player is. Resolves when it is over and the camera is back on the player, with
   * {id, skipped, phase, events}; or at once with {id, refused} when one is already playing, the game is not in play,
   * or the server refused it.
   */
  async play(id) {
    const g = this.game;
    const refuse = (why) => ({ id, refused: why });
    if (this.current) return refuse('busy');
    if (g.mode !== 'ship' && g.mode !== 'foot') return refuse('state');
    const link = this.linkFor();
    if (!link) return refuse('offline');
    const def = await this.load(id);
    this.link = link;
    // (refused, or no answer in time: nothing plays)
    const answer = await link.request(id);
    if (answer.refused) return refuse(answer.refused);
    if (this.current) {
      // (another began meanwhile: the server's placing is given back)
      link.done(id, true);
      return refuse('busy');
    }
    if (g.overlay) g.menus.closeAll();
    g.overlay = 'cutscene';
    const player = g.mode === 'foot' ? g.player.state : g.ship.state;
    const frame = resolveFrame(def.space.frame, { system: g.system, station: g.station, player });
    const c = (this.current = {
      def,
      timeline: new Timeline(def),
      space: anchorSpace(frame, def.space.anchor, player),
      phase: answer.phase,
      link,
      shot: 0,
      line: null,
      sample: { pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 50 },
      done: null,
    });
    const over = new Promise((resolve) => (c.done = resolve));
    this.emit('start', { id, phase: c.phase });
    g.director.takeOver(this, { enter: def.enter, dur: GLIDE_IN });
    this.fire(c.timeline.seek(0, false));
    this.render();
    return over;
  }

  /** The player's key: the rest of the line, or on to the next line (or the end). */
  advance() {
    const c = this.current;
    if (!c || c.timeline.phase !== 'play') return null;
    const r = c.timeline.advance();
    if (r.did === 'jumped') {
      this.game.director.startDip(JUMP_DIP);
      c.shot = shotAt(c.def.shots, c.timeline.clock);
      this.fire(r.events);
      if (c.timeline.phase === 'exit') this.leave();
    }
    return r.did;
  }

  /** Skips to the end: every event still to come fires (marked skipped, no banners) and the camera goes back. */
  skip() {
    const c = this.current;
    if (!c || c.timeline.phase !== 'play') return false;
    this.fire(c.timeline.skip());
    this.leave();
    return true;
  }

  /** Ends whatever is playing at once, with no events and no glide (the capture tool restarts with it). */
  stop() {
    const c = this.current;
    if (!c) return;
    const g = this.game;
    g.director.abort();
    if (c.timeline.phase === 'play') this.leave();
    this.current = null;
    if (g.overlay === 'cutscene') g.overlay = null;
    g.hud.clearBanners();
    this.render();
    c.done({ id: c.def.id, stopped: true, phase: c.phase, events: c.timeline.fired.map((e) => e.name) });
  }

  /** Dev builds only: puts the player's ship where the cutscene was staged in Blender (the dev scenario and captures; in
   * the game the server places the character). Only for cutscenes anchored on their frame's origin. */
  stage(def) {
    const p = def.stage?.player;
    const g = this.game;
    if (!import.meta.env.DEV || !p || def.space.anchor !== 'origin') return false;
    const s = g.ship.state;
    s.frame = resolveFrame(def.space.frame, { system: g.system, station: g.station, player: s });
    s.pos.fromArray(p.pos);
    s.quat.fromArray(p.quat);
    s.vel.set(0, 0, 0);
    g.ship.mode = 'flying';
    g.ship.speed = 0;
    g.ship.throttle = 0;
    g.cam.frame = undefined;
    return true;
  }

  /** What it shows now (tests and the capture tool). */
  state() {
    const c = this.current;
    if (!c) return null;
    const t = c.timeline;
    const line = t.line();
    return {
      id: c.def.id,
      phase: t.phase,
      clock: t.clock,
      letterbox: t.letterbox,
      shot: c.def.shots[c.shot].name,
      line: line ? { id: line.line.id, speaker: line.line.speaker, complete: line.complete } : null,
      events: t.fired.map((e) => e.name),
      storyPhase: c.phase,
    };
  }

  // ---------- each frame ----------

  /** Each frame, before the camera director: the keys, the clock, its events, and the letterbox and dialogue bar. */
  update(dt) {
    const c = this.current;
    if (!c) return;
    const inp = this.game.input;
    // (the controls are locked under the overlay: these keys are read past the lock)
    if (c.timeline.phase === 'play' && (ADVANCE_KEYS.some((k) => inp.pressed.has(k)) || inp.clicked.has(0))) this.advance();
    const was = c.timeline.phase;
    this.fire(c.timeline.update(dt));
    const shot = shotAt(c.def.shots, c.timeline.clock);
    if (shot !== c.shot) {
      c.shot = shot;
      if (c.def.shots[shot].transition === 'dip') this.game.director.startDip(JUMP_DIP);
    }
    if (was === 'play' && c.timeline.phase !== 'play') this.leave();
    if (c.timeline.phase === 'done') return this.finish();
    // (Esc's own handlers clear the overlay and may bring up the pause screen as they skip: the cutscene keeps the
    // screen, and the controls, until the camera is home)
    const g = this.game;
    if (!g.overlay) {
      g.overlay = 'cutscene';
      g.menus.updatePauseHint();
    }
    this.render();
  }

  /** The cutscene's camera now, for the director: into `out` (a FrameState); returns the screen's vertical fov. */
  pose(out) {
    const c = this.current;
    sampleShots(c.def.shots, c.timeline.clock, c.sample);
    placeInSpace(c.space, c.sample, out);
    const H = window.innerHeight;
    return canvasFov(c.sample.fov, H, letterboxBar(window.innerWidth, H, c.def.aspect).band);
  }

  // ---------- inside ----------

  /** The clock is done (or skipped): the camera starts back, the controls come back, and the server hears. */
  /** The clock is done (or skipped): the camera starts back, and the server hears. The controls stay with the cutscene
   * until the camera is home (finish). */
  leave() {
    const c = this.current;
    this.game.director.release({ exit: c.def.exit, dur: EXIT_SECONDS });
    c.link.done(c.def.id, c.timeline.skipped);
  }

  /** The camera is home: the controls come back (and, unlocked by Esc meanwhile, the pause screen comes up as after
   * any Esc). */
  finish() {
    const c = this.current;
    const g = this.game;
    this.current = null;
    if (g.overlay === 'cutscene') g.overlay = null;
    g.menus.updatePauseHint();
    this.render();
    const result = { id: c.def.id, skipped: c.timeline.skipped, phase: c.phase, events: c.timeline.fired.map((e) => e.name) };
    this.emit('end', result);
    c.done(result);
  }

  /** Events as they fire: to the listeners, and the banners they carry to the HUD (not when a skip fired them). */
  fire(events) {
    for (const e of events) {
      this.emit('event', e);
      if (e.banner && !e.skipped) this.game.hud.showBanner(this.fill(e.banner.title).toUpperCase(), this.fill(e.banner.sub));
    }
  }

  /** A banner's text with the places it names filled in: {station}, {system}, {home}, {planet} (the one below). */
  fill(text) {
    const g = this.game;
    const f = g.focusFrame;
    const names = { station: g.station.name, system: g.system.name, home: g.system.homePlanet.name, planet: (f?.sampler ? f : f?.parent ?? g.system.homePlanet).name };
    return text.replace(/\{(station|system|home|planet)\}/g, (_, k) => names[k]);
  }

  emit(type, value) {
    for (const fn of this.listeners[type]) fn(value);
  }

  render() {
    const c = this.current;
    const line = c ? c.timeline.line() : null;
    if (c && line && line.line !== c.line) {
      c.line = line.line;
      this.emit('line', line.line);
    }
    const { bar } = letterboxBar(window.innerWidth, window.innerHeight, c?.def.aspect);
    this.ui.render({ k: this.letterbox, bar, line, keys: KEYS_ALPHA });
  }
}
