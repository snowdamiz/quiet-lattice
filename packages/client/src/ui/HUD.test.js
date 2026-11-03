// The HUD's gauge arcs (P1.E07.T02, P1.E07.T03): a gauge drawn for the first time or turned on lands on its value at once,
// in its value's colours, with no tween from where it stood; a jump (a server sync, a refill, an ability's chunk of heat)
// eases onto its value over ARC_EASE_MS, fast then settling, in its new colours at once; a cast's cost eases on or off
// whatever its size, its chunk of the fill drawn bright while it does; frame-to-frame changes tween; and the regen sheen
// waits for the fill to be drawn. (On stand-ins for the gauge's SVG elements: the client's tests run without a DOM.)
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARC_EASE_MS, countdown, HUD } from './HUD.js';
import { CombatFeed } from '../net/combat.js';

/** One gauge as HUD.arc and HUD.sheen reach it: the root, its `<g class="gauge">`, the fill and the sheen paths. */
function gauge(name = 'charge') {
  const classes = new Set(['gauge']);
  const g = {
    classList: {
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    querySelector: (q) => (q === '.sheen' ? sheen : q === '.chunk' ? chunk : null),
  };
  const fill = { style: {}, parentNode: g };
  const sheen = { style: {}, parentNode: g };
  const chunk = { style: {}, parentNode: g };
  const root = { querySelector: (q) => (q === `.g-${name}` ? fill : null) };
  /** the bright chunk as drawn: from `at` for `len` of the arc, at `opacity` */
  const drawnChunk = () => ({
    len: Number(String(chunk.style.strokeDasharray ?? '0').split(' ')[0]),
    at: -Number(chunk.style.strokeDashoffset ?? 0),
    opacity: Number(chunk.style.opacity ?? 0),
  });
  return { root, g, fill, sheen, chunk: drawnChunk, has: (c) => classes.has(c) };
}

/** A HUD with nothing but its clock (from half way through the sheen's climb). */
function hud() {
  const h = Object.create(HUD.prototype);
  h.t = 950;
  h.now = () => h.t;
  return h;
}

/** A frame of the Charge gauge as HUD.update draws it. */
function frame(h, x, fill, { shown = true, regen = true } = {}) {
  h.arc(x.root, 'charge', fill, shown, { low: fill < 0.25, regen, empty: fill <= 0 });
  h.sheen(x.root, 'charge', regen && shown, fill);
}

describe('the gauge arcs', () => {
  it('turned on at 58 draw 58 at once, not red, the sheen waiting a frame', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 0.58);
    expect(x.fill.style.strokeDashoffset).toBe('0.420');
    expect(x.has('snap')).toBe(true);
    expect(x.has('on')).toBe(true);
    expect(x.has('low')).toBe(false);
    expect(x.has('empty')).toBe(false);
    expect(Number(x.sheen.style.opacity ?? 0)).toBe(0);
    // the next frame: transitions back on, the sheen climbing the drawn fill
    frame(h, x, 0.581);
    expect(x.has('snap')).toBe(false);
    expect(Number(x.sheen.style.opacity)).toBeGreaterThan(0.5);
    expect(Number(x.sheen.style.strokeDashoffset)).toBeGreaterThan(0.035 - 0.581);
  });

  it('eases a jump from empty and red onto its value, fast then settling, in its new colours at once', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 0, { regen: false });
    frame(h, x, 0, { regen: false });
    expect(x.has('low')).toBe(true);
    expect(x.has('snap')).toBe(false);
    frame(h, x, 0.58);
    // (from where it stood, the CSS transition off while the HUD eases it)
    expect(x.fill.style.strokeDashoffset).toBe('1.000');
    expect(x.has('snap')).toBe(true);
    expect(x.has('low')).toBe(false);
    expect(Number(x.sheen.style.opacity ?? 0)).toBe(0);
    h.t += ARC_EASE_MS / 2;
    frame(h, x, 0.58);
    const half = 1 - Number(x.fill.style.strokeDashoffset);
    expect(half).toBeGreaterThan(0.58 * 0.75);
    expect(half).toBeLessThan(0.58);
    h.t += ARC_EASE_MS / 2;
    frame(h, x, 0.58);
    expect(x.fill.style.strokeDashoffset).toBe('0.420');
    expect(x.has('snap')).toBe(false);
  });

  it('eases a chunk of heat on, following the meter as it cools meanwhile', () => {
    const h = hud();
    const x = gauge('heat');
    const heat = (v) => h.arc(x.root, 'heat', v, true, { hot: v >= 0.75, over: false });
    heat(0.2);
    heat(0.2);
    // a cast's 25 heat in one go, then cooling a little every frame
    const drawn = [];
    const n = Math.ceil(ARC_EASE_MS / 16);
    for (let i = 0; i <= n; i++) {
      heat(0.45 - i * 0.003);
      drawn.push(1 - Number(x.fill.style.strokeDashoffset));
      h.t += 16;
    }
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeGreaterThanOrEqual(drawn[i - 1] - 0.004);
    // more of the way in its first half than its second (an ease out), and on the meter once it has run
    const mid = Math.floor(n / 2);
    expect(drawn[mid] - drawn[0]).toBeGreaterThan(drawn[n] - drawn[mid]);
    expect(drawn[n]).toBeCloseTo(0.45 - n * 0.003, 3);
    expect(x.has('snap')).toBe(false);
  });

  it('eases a cast’s small cost of heat on, the new chunk drawn bright from the old level to the tip until it lands', () => {
    const h = hud();
    const x = gauge('heat');
    const heat = (v, costAt = null) => h.arc(x.root, 'heat', v, true, { hot: false, over: false }, costAt);
    heat(0.2);
    heat(0.2);
    // (5 heat: under a jump's size, so without the cast it would tween frame to frame)
    const cast = h.t;
    heat(0.25, cast);
    expect(x.has('snap')).toBe(true);
    expect(1 - Number(x.fill.style.strokeDashoffset)).toBeCloseTo(0.2, 3);
    h.t += ARC_EASE_MS / 2;
    heat(0.25, cast);
    const half = 1 - Number(x.fill.style.strokeDashoffset);
    expect(half).toBeGreaterThan(0.2 + 0.05 * 0.75);
    expect(half).toBeLessThan(0.25);
    expect(x.chunk()).toMatchObject({ opacity: 1 });
    expect(x.chunk().at).toBeCloseTo(0.2, 3);
    expect(x.chunk().len).toBeCloseTo(half - 0.2, 3);
    h.t += ARC_EASE_MS / 2;
    heat(0.25, cast);
    expect(x.fill.style.strokeDashoffset).toBe('0.750');
    expect(x.has('snap')).toBe(false);
    expect(x.chunk()).toMatchObject({ len: 0, opacity: 0 });
  });

  it('takes a cast’s Charge off over the same ease, the cost draining bright from the tip down to the new level', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 0.8, { regen: false });
    frame(h, x, 0.8, { regen: false });
    const cast = h.t;
    h.arc(x.root, 'charge', 0.68, true, null, cast);
    expect(x.chunk().at).toBeCloseTo(0.68, 3);
    expect(x.chunk().len).toBeCloseTo(0.12, 3);
    h.t += ARC_EASE_MS * 0.7;
    h.arc(x.root, 'charge', 0.68, true, null, cast);
    const tip = 1 - Number(x.fill.style.strokeDashoffset);
    expect(tip).toBeGreaterThan(0.68);
    expect(x.chunk().len).toBeCloseTo(tip - 0.68, 3);
    expect(x.chunk().opacity).toBeGreaterThan(0);
    expect(x.chunk().opacity).toBeLessThan(1);
  });

  it('counts a jump as a cast’s cost when the cast’s answer comes the frame after it, and draws no chunk for any other', () => {
    const h = hud();
    const x = gauge('heat');
    const heat = (v, costAt = null) => h.arc(x.root, 'heat', v, true, { hot: false, over: false }, costAt);
    heat(0.2);
    heat(0.2);
    heat(0.5);
    expect(x.chunk().len).toBe(0);
    h.t += 16;
    heat(0.5, h.t);
    expect(x.chunk().at).toBeCloseTo(0.2, 3);
    expect(x.chunk().len).toBeGreaterThan(0);
    // a jump long after the cast is none of its cost
    h.t += 2000;
    heat(0.1, h.t - 1900);
    expect(x.chunk().len).toBe(0);
  });

  it('lands as it turns on after resting off, and tweens small changes from frame to frame', () => {
    const h = hud();
    const x = gauge();
    frame(h, x, 1, { shown: false, regen: false });
    frame(h, x, 1, { shown: false, regen: false });
    expect(x.has('on')).toBe(false);
    frame(h, x, 0.96);
    expect(x.has('snap')).toBe(true);
    expect(x.has('on')).toBe(true);
    frame(h, x, 0.962);
    frame(h, x, 0.964);
    expect(x.has('snap')).toBe(false);
    expect(x.fill.style.strokeDashoffset).toBe('0.036');
  });

  it('applies the same first-draw rule to the heat arc', () => {
    const h = hud();
    const x = gauge('heat');
    h.arc(x.root, 'heat', 0.4, true, { hot: false, over: false });
    expect(x.fill.style.strokeDashoffset).toBe('0.600');
    expect(x.has('snap')).toBe(true);
    h.arc(x.root, 'heat', 0.404, true, { hot: false, over: false });
    expect(x.has('snap')).toBe(false);
  });
});

describe('the ability bar’s countdown', () => {
  it('shows whole seconds from ten up and tenths under, never a lone digit a key could be read as', () => {
    expect(countdown(20)).toBe('20');
    expect(countdown(10.2)).toBe('11');
    expect(countdown(9.96)).toBe('10');
    expect(countdown(9.94)).toBe('10');
    expect(countdown(9.86)).toBe('9.9');
    expect(countdown(4)).toBe('4.0');
    expect(countdown(0.01)).toBe('0.1');
  });
});

describe('where a hit number rises', () => {
  const was = globalThis.window;
  afterEach(() => {
    globalThis.window = was;
  });

  /** A HUD over a camera at the origin looking down −z at 1920×1080, and the creatures `records` (id → record). */
  function sighted(records) {
    globalThis.window = { innerWidth: 1920, innerHeight: 1080 };
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 1e5);
    camera.updateProjectionMatrix();
    const h = Object.create(HUD.prototype);
    h.game = {
      engine: { camera },
      camWorld: new THREE.Vector3(),
      camWorldQuatInv: new THREE.Quaternion(),
      remotes: { get: (id) => records[id] },
      fauna: { speciesOf: (r) => r.sp },
    };
    return h;
  }
  const creature = (x, y, z, extra = {}) => ({ drawn: true, world: new THREE.Vector3(x, y, z), frame: null, sp: { size: 2, kind: 'quad' }, ...extra });

  it('over the head of the creature the hit landed on, as it is drawn', () => {
    const h = sighted({ 7: creature(0, 0, -20), 8: creature(10, 0, -20) });
    const at = h.hitAnchor(7);
    // (a walker's feet are at the middle of the view; its head is 2.5 m over them: above the middle)
    expect(at.x).toBeCloseTo(960, 0);
    expect(at.y).toBeLessThan(540 - 40);
    expect(at.y).toBeGreaterThan(0);
    // the one to its right is right of it
    expect(h.hitAnchor(8).x).toBeGreaterThan(960);
  });

  it('nowhere for a creature that is not drawn, behind the camera or off the screen', () => {
    const h = sighted({
      1: creature(0, 0, -20, { drawn: false }),
      2: creature(0, 0, 20),
      3: creature(400, 0, -20),
    });
    for (const id of [1, 2, 3, 99]) expect(h.hitAnchor(id), `creature ${id}`).toBeNull();
  });
});

describe('the numbers a hit raises', () => {
  const was = { window: globalThis.window, document: globalThis.document };
  afterEach(() => {
    globalThis.window = was.window;
    globalThis.document = was.document;
  });

  /** An element as the HUD makes and fills one: no layout, only what it was given. */
  function fakeEl(tag = 'div') {
    return {
      tag,
      className: '',
      style: {},
      textContent: '',
      children: [],
      animations: [],
      isConnected: true,
      appendChild(c) {
        c.parent = this;
        this.children.push(c);
        return c;
      },
      get firstChild() {
        return this.children[0];
      },
      replaceChildren(...c) {
        this.children = c;
      },
      remove() {
        this.isConnected = false;
        if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
      },
      animate(frames, options) {
        this.animations.push({ frames, options });
      },
      classList: { add() {}, remove() {}, toggle() {} },
    };
  }

  /** A HUD over a 1920×1080 view with creatures `records` (id → record) drawn, its clock `h.t` in ms. */
  function rising(records = {}, width = 1920) {
    globalThis.window = { innerWidth: width, innerHeight: 1080 };
    globalThis.document = { createElement: fakeEl };
    const camera = new THREE.PerspectiveCamera(70, width / 1080, 0.1, 1e5);
    camera.updateProjectionMatrix();
    const h = Object.create(HUD.prototype);
    h.t = 0;
    h.now = () => h.t;
    h.timers = [];
    h.later = (fn, ms) => h.timers.push({ fn, at: h.t + ms });
    h.hitsEl = fakeEl();
    h.game = {
      engine: { camera },
      camWorld: new THREE.Vector3(),
      camWorldQuatInv: new THREE.Quaternion(),
      remotes: { get: (id) => records[id] },
      fauna: { speciesOf: (r) => r.sp },
    };
    return h;
  }
  const creature = (x, y, z) => ({ drawn: true, world: new THREE.Vector3(x, y, z), frame: null, sp: { size: 2, kind: 'quad' } });

  /** Where the number `e` is, px from the top of the view, `ms` after it was raised, read off the keyframes the browser runs. */
  function topAt(e, ms) {
    const { frames, options } = e.animations[0];
    const u = ms / options.duration;
    const y = (f) => Number(/translate\(-50%, (-?[\d.]+)px\)/.exec(f.transform)[1]);
    const next = frames.findIndex((f) => f.offset >= u);
    const [a, b] = [frames[Math.max(next - 1, 0)], frames[next]];
    const k = b.offset === a.offset ? 0 : (u - a.offset) / (b.offset - a.offset);
    return Number.parseFloat(e.style.top) + y(a) + (y(b) - y(a)) * k;
  }
  const sizeOf = (e) => Number.parseFloat(e.style.fontSize);

  it('stacks the numbers on one creature as a column that climbs, none sitting on another, kills included', () => {
    const h = rising({ 7: creature(0, 0, -20) });
    const raised = [];
    // (a burst, then a kill, then a late one: as the shots of a fight land)
    for (const [t, amount, killed] of [[0, 15, false], [60, 24, false], [120, 31, true], [180, 26, true], [300, 19, false], [520, 12, false]]) {
      h.t = t;
      h.hitNumber(amount, killed, 7);
      raised.push({ at: t, e: h.hitsEl.children.at(-1) });
    }
    let overlaps = 0;
    let closest = Infinity;
    for (let t = 0; t <= 1500; t += 8) {
      const showing = raised.filter((n) => t >= n.at && t - n.at < 880);
      for (const a of showing) {
        for (const b of showing) {
          if (a === b) continue;
          const [aTop, bTop] = [topAt(a.e, t - a.at), topAt(b.e, t - b.at)];
          // b is the younger, so it is the one above
          if (b.at <= a.at) continue;
          const gap = aTop - (bTop + sizeOf(b.e));
          closest = Math.min(closest, gap);
          if (gap < 0) overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
    // (and a few pixels clear of the one below, not touching it)
    expect(closest).toBeGreaterThanOrEqual(3.5);
    // a kill is larger, so its clearance is too
    expect(sizeOf(raised[2].e)).toBeGreaterThanOrEqual(26);
  });

  it('starts a fresh column when the numbers before have gone, and gives each creature its own', () => {
    const h = rising({ 7: creature(0, 0, -20), 8: creature(6, 0, -20) });
    h.hitNumber(10, false, 7);
    h.hitNumber(10, false, 8);
    const [a, b] = h.hitsEl.children;
    // (each over its own creature, at the same height: neither stacked on the other)
    expect(Number.parseFloat(a.style.top)).toBeCloseTo(Number.parseFloat(b.style.top), 3);
    expect(Number.parseFloat(b.style.left)).toBeGreaterThan(Number.parseFloat(a.style.left));
    h.t = 2000;
    h.hitNumber(10, false, 7);
    expect(Number.parseFloat(h.hitsEl.children.at(-1).style.top)).toBeCloseTo(Number.parseFloat(a.style.top), 3);
  });

  it.each([1920, 2520])('raises a number over the creature it hit and suppresses hits without a visible target at %i×1080', (width) => {
    const h = rising({ 7: creature(10, 0, -20), 8: { ...creature(0, 0, -20), drawn: false }, 9: creature(0, 0, 20), 10: creature(400, 0, -20) }, width);
    h.hitNumber(10, false, 7);
    const over = h.hitsEl.children[0];
    const at = h.hitAnchor(7);
    expect(Number.parseFloat(over.style.left)).toBeGreaterThan(width / 2 + 100);
    expect(Math.abs(Number.parseFloat(over.style.left) - at.x)).toBeLessThanOrEqual(8);
    expect(Number.parseFloat(over.style.top)).toBeCloseTo(at.y, 3);
    // All of these are real combat events, consumed even though none has a visible target.
    const feed = new CombatFeed({ on() {}, entityId: 1, now: () => h.t });
    for (const target of [8, 9, 10, 99]) feed.event({ kind: 'combat', source: 1, target, amount: 11, killed: false });
    h.updateHits(feed);
    expect(feed.take().dealt).toEqual([]);
    expect(h.hitsEl.children).toEqual([over]);
  });

  it.each([1920, 2520])('follows a visible target during a turn, then expires live numbers before they can sit over unrelated scenery at %i×1080', (width) => {
    const r = creature(0, 0, -20);
    const h = rising({ 7: r }, width);
    h.hitNumber(17, false, 7);
    h.t = 60;
    h.hitNumber(23, false, 7);
    const numbers = [...h.hitsEl.children];
    const before = numbers.map((e) => ({ x: Number.parseFloat(e.style.left), y: Number.parseFloat(e.style.top) }));
    const anchor = h.hitAnchor(7);
    h.t = 150;
    h.game.camWorldQuatInv.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 12);
    h.updateHits();
    const turned = h.hitAnchor(7);
    expect(Math.abs(turned.x - anchor.x)).toBeGreaterThan(100);
    expect(h.hitsEl.children).toEqual(numbers);
    numbers.forEach((e, i) => {
      expect(Number.parseFloat(e.style.left) - before[i].x).toBeCloseTo(turned.x - anchor.x, 3);
      expect(Number.parseFloat(e.style.top) - before[i].y).toBeCloseTo(turned.y - anchor.y, 3);
      expect(e.animations).toHaveLength(1);
    });
    h.game.camWorldQuatInv.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    h.t = 250;
    h.updateHits();
    expect(h.hitsEl.children).toEqual([]);
    expect(h.hitLive).toEqual([]);
    // Turning back before the original 900 ms lifetime does not resurrect expired values.
    h.game.camWorldQuatInv.identity();
    h.t = 350;
    h.updateHits();
    expect(h.hitsEl.children).toEqual([]);
  });

  it.each(['offscreen', 'not drawn', 'removed'])('expires a number when its target becomes %s', (reason) => {
    const r = creature(0, 0, -20);
    const records = { 7: r };
    const h = rising(records);
    h.hitNumber(11, false, 7);
    h.t = 100;
    if (reason === 'offscreen') r.world.x = 400;
    else if (reason === 'not drawn') r.drawn = false;
    else delete records[7];
    h.updateHits();
    expect(h.hitsEl.children).toEqual([]);
    expect(h.hitLive).toEqual([]);
  });

  it('keeps a visible killing blow on a drawn corpse, while a suppressed kill still pays its rewards and a blow still flashes', () => {
    const r = { ...creature(0, 0, -20), pose: { mode: 'dead' }, hp: 0 };
    const h = rising({ 7: r });
    h.toast = vi.fn();
    h.flash = vi.fn();
    const feed = new CombatFeed({ on() {}, entityId: 1, now: () => h.t });
    feed.event({ kind: 'combat', source: 1, target: 7, amount: 26, killed: true });
    feed.event({ kind: 'combat', source: 1, target: 99, amount: 31, killed: true });
    feed.event({ kind: 'combat', source: 99, target: 1, amount: 11, killed: false });
    feed.event({ kind: 'xp', amount: 30, level: 1 });
    feed.event({ kind: 'loot', item: 'units', count: 7 });
    h.updateHits(feed);
    expect(h.hitsEl.children).toHaveLength(1);
    const kill = h.hitsEl.children[0];
    expect(kill.textContent).toBe('26');
    expect(kill.style.color).toBe('var(--accent-hi)');
    expect(sizeOf(kill)).toBe(26);
    h.t = 400;
    h.updateHits(feed);
    expect(h.hitsEl.children).toEqual([kill]);
    expect(h.flash).toHaveBeenCalledWith('damage');
    expect(h.toast.mock.calls).toEqual([
      ['+30 XP', 'good', { repeat: true }],
      ['+7 units', 'good', { repeat: true }],
    ]);
  });

  it('drains expired and detached numbers, bounds a burst, and keeps an old removal timer from touching a newer number', () => {
    const r = creature(0, 0, -20);
    const h = rising({ 7: r });
    for (let i = 0; i < 20; i++) h.hitNumber(11, false, 7);
    expect(h.hitsEl.children).toHaveLength(12);
    h.hitsEl.children[0].remove();
    h.updateHits();
    expect(h.hitLive).toHaveLength(11);
    h.t = 900;
    h.updateHits();
    expect(h.hitsEl.children).toEqual([]);
    expect(h.hitLive).toEqual([]);
    h.hitNumber(12, false, 7);
    const newer = h.hitsEl.children[0];
    for (const timer of h.timers.filter((t) => t.at === 1000)) timer.fn();
    expect(h.hitsEl.children).toEqual([newer]);
  });

  it('stacks a number against any live one it would touch, whichever creature or lane that one is for', () => {
    // (two visible creatures just above the crosshair, hit in the same frame: they share no lane but their numbers touch)
    const h = rising({ 7: creature(0, 0, -30), 8: creature(0.2, 0, -30) });
    const anchor = h.hitAnchor(7);
    expect(anchor.y).toBeGreaterThan(1080 * 0.44 - 20);
    expect(anchor.y).toBeLessThan(1080 * 0.44 + 20);
    h.hitNumber(15, false, 7);
    h.hitNumber(17, false, 8);
    h.hitNumber(23, false, 7);
    const raised = [...h.hitsEl.children].map((e, i) => ({ e, at: 0, i }));
    let overlaps = 0;
    for (let t = 0; t <= 880; t += 8) {
      for (const a of raised) {
        for (const b of raised) {
          if (b.i <= a.i) continue;
          const xGap = Math.abs(Number.parseFloat(a.e.style.left) - Number.parseFloat(b.e.style.left)) - (String(a.e.textContent).length * sizeOf(a.e) * 0.62 + String(b.e.textContent).length * sizeOf(b.e) * 0.62) / 2;
          if (xGap >= 0) continue;
          const [aTop, bTop] = [topAt(a.e, t), topAt(b.e, t)];
          const [hi, lo] = aTop < bTop ? [[aTop, a.e], [bTop, b.e]] : [[bTop, b.e], [aTop, a.e]];
          if (lo[0] < hi[0] + sizeOf(hi[1])) overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
  });

  it('stacks a number turned to another creature against the one just hit, and leaves a number below it alone', () => {
    const h = rising({ 7: creature(0, 0, -30), 8: creature(0.2, 0, -30) });
    h.hitNumber(15, false, 7);
    h.t = 300;
    h.hitNumber(11, false, 8);
    const [a, b] = h.hitsEl.children;
    const aNow = Number.parseFloat(a.style.top) - 42 * (1 - (1 - 300 / 900) ** 2);
    expect(Number.parseFloat(b.style.top)).toBeLessThanOrEqual(aNow - 19 - 3.5);
    // a live number that has not reached this one's start (a lower creature's) pushes nothing
    const low = rising({ 7: creature(0, -6, -20), 8: creature(0, 6, -20) });
    low.hitNumber(15, false, 7);
    low.hitNumber(11, false, 8);
    const [c, d] = low.hitsEl.children;
    expect(Number.parseFloat(d.style.top)).toBeCloseTo(low.hitAnchor(8).y, 3);
    expect(Number.parseFloat(c.style.top)).toBeCloseTo(low.hitAnchor(7).y, 3);
  });

  it('pops in over about a tenth of a second, scaled up and fading in, then rises and fades out', () => {
    const h = rising({ 7: creature(0, 0, -20) });
    h.hitNumber(15, false, 7);
    const { frames, options } = h.hitsEl.children[0].animations[0];
    expect(options.duration).toBe(900);
    expect(frames[0]).toMatchObject({ offset: 0, opacity: 0 });
    expect(frames[0].transform).toMatch(/scale\(0\.7\)/);
    const popped = frames.find((f) => f.opacity === 1);
    expect(popped.offset * options.duration).toBeGreaterThanOrEqual(80);
    expect(popped.offset * options.duration).toBeLessThanOrEqual(120);
    expect(popped.transform).toMatch(/scale\(1\)/);
    expect(frames.at(-1).opacity).toBe(0);
  });

  it('shows what a frame of kills paid as one toast of each kind, not one per kill', () => {
    const h = rising({});
    h.toast = vi.fn();
    const gained = [
      { what: 'xp', count: 30 },
      { what: 'units', count: 5 },
      { what: 'xp', count: 30 },
      { what: 'xp', count: 30 },
      { what: 'units', count: 7 },
    ];
    h.updateHits({ take: () => ({ dealt: [], taken: [], gained }) });
    expect(h.toast.mock.calls).toEqual([
      ['+90 XP', 'good', { repeat: true }],
      ['+12 units', 'good', { repeat: true }],
    ]);
  });

  it('puts a third line under an analysis banner and keeps system and docking banners to two', () => {
    const h = rising({});
    h.banner = fakeEl();
    h.band = fakeEl();
    h.game.cutscenes = null;
    h.raiseBanner({ title: 'GANPHA BEAST', sub: 'New Species Analyzed', lines: [], detail: 'Grazer · Skittish · ★☆☆☆☆ · Bond: eligible' });
    expect(h.banner.children.map((c) => c.className)).toEqual(['b-sub', 'b-title', 'b-line']);
    expect(h.banner.children[2].textContent).toBe('Grazer · Skittish · ★☆☆☆☆ · Bond: eligible');
    h.raiseBanner({ title: 'SOL', sub: 'Star System', lines: ['dropped', 'too'], detail: '' });
    expect(h.banner.children.map((c) => c.className)).toEqual(['b-sub', 'b-title']);
  });
});
