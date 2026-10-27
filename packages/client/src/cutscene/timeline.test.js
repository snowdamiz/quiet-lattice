// A cutscene's timing: the exported test cutscene loads; broken definitions are refused with the reason; lines show,
// reveal and fade on game time; events fire in order as the clock passes them; the key reveals a line and then jumps to
// the next; a skip leaves the same events fired as watching to the end; the letterbox eases in and out without a jump;
// and the letterbox's bars and the field of view that frames the authored picture between them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASPECT,
  EXIT_SECONDS,
  LETTERBOX_IN,
  LETTERBOX_OUT,
  MIN_BAR,
  REVEAL_CPS,
  Timeline,
  canvasFov,
  letterboxBar,
  parseCutscene,
} from './timeline.js';

const exported = JSON.parse(readFileSync(new URL('../../public/cutscenes/test.json', import.meta.url), 'utf8'));

const still = (start, end) => ({ name: `s${start}`, start, end, fps: 1, pos: [0, 0, 0, 0, 0, 0], quat: [0, 0, 0, 1, 0, 0, 0, 1], fov: [40, 40] });
const def = (over = {}) =>
  parseCutscene({
    format: 'astra.cutscene',
    version: 1,
    id: 'unit',
    duration: 10,
    space: { frame: 'station' },
    shots: [still(0, 4), still(4, 10)],
    lines: [
      { id: 'one', t: 1, dur: 2, speaker: 'Waystation Control', voice: 'compact', text: 'Hold where you are.' },
      { id: 'two', t: 5, dur: 3, speaker: 'Quartermaster', voice: 'compact', text: 'Welcome back.' },
    ],
    events: [
      { t: 6, name: 'late', banner: { title: '{station}', sub: 'Inbound' } },
      { t: 0, name: 'begin' },
      { t: 4.5, name: 'mid' },
    ],
    ...over,
  });

/** Runs a timeline at 60 fps until `until` (cutscene time) or the end. */
function run(tl, until = Infinity) {
  const fired = [];
  while (tl.phase === 'play' && tl.clock < until - 1e-9) fired.push(...tl.update(1 / 60));
  return fired;
}

describe('parseCutscene', () => {
  it('loads the exported test cutscene', () => {
    const d = parseCutscene(exported);
    expect(d.id).toBe('test');
    expect(d.space).toEqual({ frame: 'station', anchor: 'origin' });
    expect(d.shots.map((s) => s.name)).toEqual(['approach', 'station', 'return']);
    expect(d.lines.map((l) => l.id)).toEqual(['hail', 'tow', 'welcome']);
    expect(d.events.find((e) => e.banner)?.banner).toEqual({ title: '{station}', sub: 'Inbound lane' });
    expect(d.shots.at(-1).end).toBeCloseTo(d.duration, 6);
    expect(d.stage.player.pos).toHaveLength(3);
  });

  it('orders events and lines by time', () => {
    expect(def().events.map((e) => e.name)).toEqual(['begin', 'mid', 'late']);
  });

  it('refuses a broken definition, saying what is wrong', () => {
    const base = def();
    const raw = { ...exported };
    expect(() => parseCutscene({ ...raw, format: 'gltf' })).toThrow(/not a cutscene/);
    expect(() => parseCutscene({ ...raw, version: 2 })).toThrow(/version 2/);
    expect(() => parseCutscene({ ...raw, id: '../up' })).toThrow(/bad id/);
    expect(() => parseCutscene({ ...raw, space: { frame: 'moon' } })).toThrow(/frame moon/);
    expect(() => parseCutscene({ ...raw, space: { frame: 'inertial' } })).toThrow(/anchored on the player/);
    expect(() => parseCutscene({ ...raw, shots: [] })).toThrow(/no shots/);
    expect(() => parseCutscene({ ...raw, shots: [{ ...raw.shots[0], fov: raw.shots[0].fov.slice(1) }] })).toThrow(/mismatched samples/);
    expect(() => parseCutscene({ ...raw, shots: [{ ...raw.shots[0], start: 0.5 }] })).toThrow(/starts at 0.5/);
    expect(() => parseCutscene({ ...raw, shots: [raw.shots[0], { ...raw.shots[1], start: 1 }] })).toThrow(/overlap/);
    const lines = base.lines.map((l) => ({ ...l }));
    lines[1].t = 2;
    expect(() => parseCutscene({ ...raw, lines })).toThrow(/lines one and two overlap/);
    expect(() => parseCutscene({ ...raw, lines: [{ ...lines[0], voice: 'pirate' }] })).toThrow(/voice pirate/);
    expect(() => parseCutscene({ ...raw, lines: [{ ...lines[0], t: 11, dur: 1 }] })).toThrow(/spans/);
    expect(() => parseCutscene({ ...raw, events: [{ t: 1, name: 'x', banner: { sub: 'no title' } }] })).toThrow(/no title/);
  });
});

describe('Timeline', () => {
  it('fires events in order as the clock passes them, and ends after the exit', () => {
    const tl = new Timeline(def());
    const fired = run(tl);
    expect(fired.map((e) => e.name)).toEqual(['begin', 'mid', 'late']);
    expect(fired.every((e) => !e.skipped)).toBe(true);
    expect(tl.phase).toBe('exit');
    expect(tl.clock).toBe(10);
    // the exit (letterbox out, the camera's glide back) takes EXIT_SECONDS
    let frames = 0;
    while (tl.phase === 'exit') {
      tl.update(1 / 60);
      frames++;
    }
    expect(tl.phase).toBe('done');
    expect(frames / 60).toBeCloseTo(EXIT_SECONDS, 1);
  });

  it('shows each line over its span, revealing it and fading at its ends', () => {
    const tl = new Timeline(def());
    run(tl, 0.9);
    expect(tl.line()).toBeNull();
    run(tl, 1.05);
    const l = tl.line();
    expect(l.line.id).toBe('one');
    expect(l.reveal).toBeCloseTo((tl.clock - 1) * REVEAL_CPS, 6);
    expect(l.complete).toBe(false);
    expect(l.alpha).toBeGreaterThan(0);
    expect(l.alpha).toBeLessThan(1);
    run(tl, 2);
    expect(tl.line().alpha).toBe(1);
    expect(tl.line().complete).toBe(true);
    run(tl, 2.95);
    expect(tl.line().alpha).toBeLessThan(0.3);
    run(tl, 3.01);
    expect(tl.line()).toBeNull();
    run(tl, 5.5);
    expect(tl.line().line.id).toBe('two');
  });

  it('reveals a line on the key, then jumps to the next line, firing what it passes', () => {
    const tl = new Timeline(def());
    run(tl, 1.1);
    expect(tl.advance()).toEqual({ did: 'revealed', events: [] });
    expect(tl.line().complete).toBe(true);
    const jump = tl.advance();
    expect(jump.did).toBe('jumped');
    expect(jump.events.map((e) => e.name)).toEqual(['mid']);
    expect(tl.clock).toBe(5);
    expect(tl.line().line.id).toBe('two');
    // between lines it jumps too; after the last, to the end
    tl.advance();
    const end = tl.advance();
    expect(end.events.map((e) => e.name)).toEqual(['late']);
    expect(tl.phase).toBe('exit');
    expect(tl.advance()).toEqual({ did: null, events: [] });
  });

  it('skips to the state watching would have left: every event fired once, in order, the rest marked skipped', () => {
    const watched = new Timeline(def());
    run(watched);
    const skipped = new Timeline(def());
    run(skipped, 4.6);
    const rest = skipped.skip();
    expect(rest.map((e) => [e.name, e.skipped])).toEqual([['late', true]]);
    expect(skipped.fired.map((e) => e.name)).toEqual(watched.fired.map((e) => e.name));
    expect({ phase: skipped.phase, clock: skipped.clock, line: skipped.line() }).toEqual({ phase: watched.phase, clock: watched.clock, line: watched.line() });
    expect(skipped.skipped).toBe(true);
    expect(watched.skipped).toBe(false);
    // a second skip, or a key, does nothing more
    expect(skipped.skip()).toEqual([]);
    expect(skipped.fired).toHaveLength(3);
  });

  it('eases the letterbox in, and out from wherever it was when the clock ended', () => {
    const tl = new Timeline(def());
    expect(tl.letterbox).toBe(0);
    tl.update(LETTERBOX_IN / 2);
    expect(tl.letterbox).toBeCloseTo(0.5, 6);
    tl.update(LETTERBOX_IN);
    expect(tl.letterbox).toBe(1);
    run(tl);
    expect(tl.letterbox).toBe(1);
    // eased out, not linear: a quarter of the way it has opened only 1/16 (linear would be a quarter), halfway half,
    // three quarters 15/16; never closing again
    const out = [];
    for (let i = 0; i < 4; i++) {
      tl.update(LETTERBOX_OUT / 4);
      out.push(tl.letterbox);
    }
    expect(out[0]).toBeCloseTo(1 - 1 / 16, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(1 / 16, 6);
    expect(out[3]).toBe(0);
    tl.update(LETTERBOX_OUT);
    expect(tl.letterbox).toBe(0);

    // skipped while it is still closing: it opens from there, no jump to closed
    const early = new Timeline(def());
    early.update(LETTERBOX_IN * 0.25);
    const k = early.letterbox;
    early.skip();
    expect(early.letterbox).toBeCloseTo(k, 9);
    early.update(1 / 60);
    expect(early.letterbox).toBeLessThan(k);
  });
});

describe('letterbox', () => {
  it('frames 2.39:1 on a 16:9 screen, and keeps a bar on an ultrawide one', () => {
    const wide = letterboxBar(1920, 1080);
    expect(wide.bar).toBeCloseTo((1080 - 1920 / DEFAULT_ASPECT) / 2, 6);
    expect(1920 / wide.band).toBeCloseTo(DEFAULT_ASPECT, 6);
    const ultra = letterboxBar(2520, 1080);
    expect(ultra.bar).toBeCloseTo(1080 * MIN_BAR, 6);
  });

  it('widens the screen’s field of view so the band shows exactly what was framed', () => {
    expect(canvasFov(40, 1080, 1080)).toBeCloseTo(40, 9);
    const { band } = letterboxBar(1920, 1080);
    const fov = canvasFov(24.3, 1080, band);
    // the band's share of the screen's height, through the tangent
    const bandHalf = Math.tan(((fov * Math.PI) / 360)) * (band / 1080);
    expect((Math.atan(bandHalf) * 360) / Math.PI).toBeCloseTo(24.3, 9);
  });
});
