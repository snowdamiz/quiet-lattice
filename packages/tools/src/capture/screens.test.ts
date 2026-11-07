import { afterEach, describe, expect, it, vi } from 'vitest';
import { faunaOffscreenHits, faunaTurnMotion, SCREENS } from './screens.ts';

// Load the actual JavaScript HUD, feed and three.js math; no renderer, browser, Vite or server is started.
const client = (path: string) => import(new URL(`../../../client/${path}`, import.meta.url).href);
const { HUD } = await client('src/ui/HUD.js');
const { CombatFeed } = await client('src/net/combat.js');
const { Vector3, Quaternion, PerspectiveCamera } = await client('node_modules/three/build/three.module.js');

interface Element {
  className: string;
  textContent: string;
  style: Record<string, string>;
  children: Element[];
  parent?: Element;
  isConnected: boolean;
  readonly firstChild: Element | undefined;
  appendChild(e: Element): void;
  remove(): void;
  animate(): void;
}

function element(): Element {
  return {
    className: '',
    textContent: '',
    style: {},
    children: [],
    isConnected: true,
    get firstChild() {
      return this.children[0];
    },
    appendChild(e) {
      e.parent = this;
      this.children.push(e);
    },
    remove() {
      this.isConnected = false;
      if (this.parent) this.parent.children = this.parent.children.filter((e) => e !== this);
    },
    animate() {},
  };
}

function stage(width = 1920) {
  const h = Object.create(HUD.prototype);
  h.hitsEl = element();
  const from = new Vector3(0, 1000, 0);
  const up = new Vector3(0, 1, 0);
  const records = new Map(
    [602, 603].map((id) => {
      const pos = new Vector3(id === 602 ? 0 : 2, 1000, -20);
      return [id, { id, drawn: true, pos, world: pos, anchor: pos.clone().add(new Vector3(0, 2.5, 0)), frame: null, sp: { size: 2, kind: 'quad' } }] as const;
    }),
  );
  const camera = new PerspectiveCamera(70, width / 1080, 0.1, 1e5);
  camera.updateProjectionMatrix();
  const game = {
    hud: h,
    player: { state: { pos: from } },
    engine: { camera },
    camWorld: new Vector3(0, 1001.7, 0),
    camWorldQuatInv: new Quaternion(),
    remotes: { get: (id: number) => records.get(id) },
    fauna: {
      speciesOf: (r: { sp: { size: number; kind: string } }) => r.sp,
      hitAnchor: (r: { drawn: boolean; anchor: unknown }) => (r.drawn ? r.anchor : null),
    },
  };
  h.game = game;
  const clip = {
    t: 0,
    frame(dt: number) {
      h.updateHits(feed);
      clip.t += dt;
    },
  };
  const feed = new CombatFeed({ on() {}, entityId: 1, now: () => clip.t * 1000 });
  h.now = () => clip.t * 1000;
  h.later = () => 0;
  let yaw = 0;
  const w = {
    game,
    dev: {
      // Same bounded yaw input as dev.footAim; only camera math, without the player's renderer or input DOM.
      footAim(local: { x: number; z: number }, gain: number) {
        const wanted = Math.atan2(local.x - from.x, -(local.z - from.z));
        const delta = Math.atan2(Math.sin(wanted - yaw), Math.cos(wanted - yaw));
        yaw += Math.max(-0.126, Math.min(0.126, delta * gain));
        game.camWorldQuatInv.setFromAxisAngle(up, yaw);
      },
    },
    async step(n: number) {
      for (let i = 0; i < n; i++) clip.frame(1 / 60);
    },
    __feed: feed,
    __herd: {
      stepTo: vi.fn(async () => {}),
      hit(target: number, amount: number) {
        feed.event({ kind: 'combat', source: 1, target, amount, killed: false });
      },
    },
    __clip: clip,
  };
  vi.stubGlobal('window', { ...w, innerWidth: width, innerHeight: 1080 });
  vi.stubGlobal('document', { createElement: element, querySelectorAll: () => h.hitsEl.children });
  return { w, h, feed, clip };
}

afterEach(() => vi.unstubAllGlobals());

describe('fauna hit-feedback capture fixtures without capture', () => {
  it.each([1920, 2520])('consumes actual combat events offscreen and demands zero numbers at %i×1080', async (width) => {
    const { w, h, feed } = stage(width);
    const event = vi.spyOn(feed, 'event');
    await faunaOffscreenHits(12);
    expect(w.__herd.stepTo).toHaveBeenCalledWith(12);
    expect(event.mock.calls.map(([e]) => e)).toEqual([
      { kind: 'combat', source: 1, target: 602, amount: 17, killed: false },
      { kind: 'combat', source: 1, target: 603, amount: 23, killed: false },
      { kind: 'combat', source: 1, target: 602, amount: 9, killed: false },
    ]);
    expect(feed.dealt).toEqual([]);
    expect(h.hitsEl.children).toEqual([]);
  });

  it('rejects an empty event injection instead of accepting the absence of numbers as evidence', async () => {
    const { w } = stage();
    w.__herd.hit = () => {};
    await expect(faunaOffscreenHits(12)).rejects.toThrow('did not enqueue its combat events');
  });

  it('rejects unconsumed combat events', async () => {
    const { h } = stage();
    h.updateHits = () => {};
    await expect(faunaOffscreenHits(12)).rejects.toThrow('were not consumed');
  });

  it('rejects reticle fallback numbers instead of retrying until they exist', async () => {
    const { h } = stage();
    h.hitNumber = () => h.hitsEl.appendChild(element());
    await expect(faunaOffscreenHits(12)).rejects.toThrow('without a visible target');
  });

  it.each([1920, 2520])(
    'drives 72 deterministic frames with live numbers, early suppression, offscreen hits and a fresh hit after returning at %i×1080',
    async (width) => {
      const { h, clip } = stage(width);
      const seen: { visible: boolean; values: string[]; ms: number }[] = [];
      faunaTurnMotion();
      for (let i = 0; i < 72; i++) {
        clip.frame(1 / 60);
        seen.push({ visible: !!h.hitAnchor(h.game.remotes.get(602)), values: h.hitsEl.children.map((e: Element) => e.textContent), ms: clip.t * 1000 });
      }
      expect(seen[10].values).toEqual(['17', '23', '9']);
      const lost = seen.find((f) => !f.visible);
      expect(lost).toBeDefined();
      expect(lost?.ms).toBeLessThan(900);
      expect(seen.filter((f) => !f.visible).every((f) => f.values.length === 0)).toBe(true);
      expect(seen[52]).toMatchObject({ visible: true, values: [] });
      expect(seen[60]).toMatchObject({ visible: true, values: ['11'] });
    },
  );

  it('rejects a live number left behind by a turn', () => {
    const { h, clip } = stage();
    h.updateHitNumbers = () => {};
    h.hitLive = [];
    faunaTurnMotion();
    expect(() => {
      for (let i = 0; i < 72; i++) clip.frame(1 / 60);
    }).toThrow('survived their target leaving view');
  });

  it('keeps new revision outputs in four fresh light/aspect namespaces, including a visible kill and offscreen stills', () => {
    for (const light of ['day', 'night']) {
      for (const aspect of ['16x9', '21x9']) {
        const def = SCREENS[`fauna-hit-turn-${light}-${aspect}`];
        expect(def.clipAspect).toBe(aspect);
        expect(def.clipSeconds).toBe(1.2);
        expect(def.hudClock).toBe(true);
        expect(Object.keys(def.stills ?? {})).toEqual(['kill', 'offscreen', 'start']);
      }
    }
  });
});
