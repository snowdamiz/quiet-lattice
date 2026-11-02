import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HUD } from './HUD.js';
import { makeRoom } from '../remote/markers.js';

afterEach(() => vi.unstubAllGlobals());

function element() {
  const classes = new Set();
  return {
    style: {}, dataset: {}, innerHTML: '',
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => on ? classes.add(c) : classes.delete(c),
    },
    appendChild() {}, remove() {},
    querySelector() { return this.lbl ??= element(); },
  };
}

function stage() {
  vi.stubGlobal('document', { createElement: element });
  const h = Object.create(HUD.prototype);
  Object.assign(h, {
    t: 1000, now: () => h.t, pilots: new Map(), pilotsSeen: new Set(), pilotsShown: [], room: makeRoom(), markersEl: element(),
    game: { engine: { camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 1e7) }, camWorldQuatInv: new THREE.Quaternion() },
  });
  const frame = (list, keepOut = [], ms = 1000 / 60, taken = []) => { h.t += ms; h.updatePilots(list, keepOut, taken, 1920, 1080); };
  return { h, frame };
}

const marker = (id, x, y = 0, dist = 500) => ({ id, label: `Pilot ${id}`, dist, rel: new THREE.Vector3(x, y, -500), quat: new THREE.Quaternion() });

describe('pilot marker polish through HUD.updatePilots', () => {
  for (const departed of [false, true])
    it(`counts a ${departed ? 'departing' : 'still in-view'} pilot's nonzero fading name before admitting its crosshair replacement`, () => {
      const { h, frame } = stage();
      const list = Array.from({ length: 12 }, (_, i) => marker(i + 1, (i % 6 - 2.5) * 140, i < 6 ? 130 : -130, 100 + i * 100));
      list[11].rel.set(0, 0, -500);
      list[8].rel.set(-30, 0, -500);
      frame(list); frame(list); frame(list, [], 200);
      const p = h.pilots.get(12);
      const b = { ...p.box };
      frame(list, [], 1000 / 60, [b.x0, b.y0, b.x1, b.y1]);
      expect(p.shown).toBe(false);
      const blocked = { box: { ...p.box }, x: p.x };
      if (departed) list.pop();
      else list[11].rel.set(40, 0, -500);
      frame(list, [], 100);
      const visibleNames = () => [...h.pilots.values()].filter((q) => q.lbl.innerHTML.startsWith('Pilot') && Number(q.lbl.style.opacity) * Number(q.e.style.opacity) > 0).map((q) => q.m.id);
      expect(visibleNames()).toHaveLength(9);
      expect(visibleNames()).toContain(12);
      expect(visibleNames()).not.toContain(9);
      expect(Number(p.lbl.style.opacity)).toBeGreaterThan(0);
      if (!departed) expect(p.box.x0 - blocked.box.x0).toBeCloseTo(p.x - blocked.x, 6);
      frame(list, [], 50);
      if (departed) frame(list, [], 100);
      expect(Number(p.lbl.style.opacity)).toBe(0);
      expect(visibleNames()).toHaveLength(9);
      expect(visibleNames()).toContain(9);
    });

  it('names the nearest eight and one crosshair pilot, deduplicating a crosshair pilot already among the eight', () => {
    const { h, frame } = stage();
    const list = Array.from({ length: 12 }, (_, i) => marker(i + 1, (i % 6 - 2.5) * 140, i < 6 ? 130 : -130, 100 + i * 100));
    list[11].rel.set(0, 0, -500);
    frame(list); frame(list);
    expect([...h.pilots.values()].filter((p) => p.named).map((p) => p.m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 12]);
    const far = h.pilots.get(10);
    expect(far.shown).toBe(true);
    expect(far.lbl.innerHTML).toBe('<small>1.0 km</small>');
    list[11].rel.set(350, -200, -500);
    list[0].rel.set(0, 0, -500);
    frame(list);
    expect([...h.pilots.values()].filter((p) => p.named).map((p) => p.m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('grades label ink by sensor distance over the opaque halo, from full inside 500 m to 70% at 1 km', () => {
    const { h, frame } = stage();
    const m = marker(1, 0, 0, 499);
    frame([m]); frame([m]);
    expect(h.pilots.get(1).lbl.style.color).toBe('rgb(233, 231, 226)');
    m.dist = 750; frame([m]);
    expect(h.pilots.get(1).lbl.style.color).toBe('rgb(200, 198, 194)');
    m.dist = 4000; frame([m]);
    expect(h.pilots.get(1).lbl.style.color).toBe('rgb(166, 165, 162)');
  });

  it('fades a blocked label to zero in 150 ms on the HUD clock while its box moves with the diamond', () => {
    const { h, frame } = stage();
    const m = marker(1, -150);
    frame([m]); frame([m]); frame([m], [], 200);
    const p = h.pilots.get(1);
    expect(Number(p.lbl.style.opacity)).toBe(1);
    const start = { ...p.box, x: p.x, y: p.y };
    const block = [start.x1 + 8, start.y0 - 20, start.x1 + 100, start.y1 + 20];
    m.rel.x += 6;
    frame([m], block);
    expect(p.shown).toBe(false);
    expect(Number(p.lbl.style.opacity)).toBe(1);
    const at = h.t;
    for (const elapsed of [25, 50, 75, 100, 125, 149, 150]) {
      m.rel.x += 1;
      frame([m], block, at + elapsed - h.t);
      if (elapsed < 150) {
        expect(p.box.x0 - start.x0).toBeCloseTo(p.x - start.x, 6);
        expect(p.box.y0 - start.y0).toBeCloseTo(p.y - start.y, 6);
      }
      expect(p.lbl.style.translate ?? '').toBe('');
      if (elapsed < 150) expect(Number(p.lbl.style.opacity)).toBeGreaterThan(0);
    }
    expect(Number(p.lbl.style.opacity)).toBe(0);
    expect(p.e.classList.contains('out')).toBe(false);
  });

  it('drops only the name when a nearer drawn hull covers the diamond, keeping its range and mark', () => {
    const { h, frame } = stage();
    h.game.remotes = { occludesMarker: (id) => id === 2 };
    frame([marker(1, -200, 0, 100), marker(2, 200, 0, 1000)]);
    frame([marker(1, -200, 0, 100), marker(2, 200, 0, 1000)]);
    expect(h.pilots.get(1).named).toBe(true);
    expect(h.pilots.get(2).named).toBe(false);
    expect(h.pilots.get(2).lbl.innerHTML).toBe('<small>1.0 km</small>');
    expect(h.pilots.get(2).e.classList.contains('out')).toBe(false);
  });
});
