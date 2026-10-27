// The UI screens `pnpm capture -- --ui <screen>` knows how to reach. Each later UI task adds its screen here, so the
// grader always gets its 16:9 and 21:9 captures and a 60 fps clip the same way.
import type { Page } from '@playwright/test';

export interface ScreenDef {
  /** dev scenario hash to open the client with */
  hash?: string;
  /** drive the page to the screen and let it settle */
  open(page: Page): Promise<void>;
  /**
   * Start the motion the clip should show (a panel opening, a hover, a toast), right before its frames are taken.
   * Without it the clip shows the settled screen.
   */
  motion?(page: Page): Promise<void>;
  /** Which clip frames go on the clip sheet (all are written to _frames/). Default: twenty spread evenly. */
  sheetFrames?: readonly number[];
  /** Extra 16:9 stills, taken after the main one and before the clip: `16x9-<name>.png` after `pose` drives the page. */
  stills16x9?: Record<string, (page: Page) => Promise<void>>;
  /** Draw scrollbars (headless Chromium hides them by default), for screens whose scroll affordance is being judged. */
  showScrollbars?: boolean;
  /** How long the clip runs (s; 60 frames a second): long enough for the whole motion. Default 1. */
  clipSeconds?: number;
  /** Run the HUD's clock and timers (game.hud.now / later / cancel) on the clip's clock, so toasts and fades last as long
   * in the clip as in play. */
  hudClock?: boolean;
}

/** Steps the game by hand, then waits out the HUD's CSS transitions (they run on real time, not game time). */
const settle = async (page: Page, frames = 60) => {
  await page.evaluate((n) => (window as unknown as { step(n: number): Promise<void> }).step(n), frames);
  await page.waitForTimeout(1200);
};

interface InventoryApi {
  state: { suit: unknown[]; pods: unknown[][] };
  restore(saved: unknown): boolean;
  add(id: string, n: number, to?: 'auto' | 'suit' | 'cargo'): number;
  setLoadout(l: { ship: { hull: string; modules: Record<string, string>; cargoPods: number; livery: number } | null; skills?: string[] }): boolean;
}

/** What the HUD captures drive of the game: the walker's multitool meter and the ship's Charge (P1.E07.T02). */
interface MeterGame {
  mode: string;
  multitool: { meter: { heat: number; overheated: boolean; charge: number } };
  ship: {
    charge: number;
    mode: string;
    speed: number;
    throttle: number;
    tryPulse(): void;
    state: { frame: unknown; pos: { set(x: number, y: number, z: number): void }; quat: { setFromRotationMatrix(m: { elements: number[] }): void } };
  };
  system: { homePlanet: { radius: number; position: { x: number; y: number; z: number } } };
  cam: { frame: unknown };
  hud: { toast(text: string, tone?: string): void };
}
interface MeterWindow {
  game: MeterGame;
  dev: { boot(): Promise<void>; button(b: number, down: boolean): void };
  THREE?: unknown;
}

/** The walker's heat meter at `heat`, locked out or not, with the beam held (the mouse button down) or let go. */
async function heatAt(page: Page, heat: number, overheated: boolean, held: boolean): Promise<void> {
  await page.evaluate(
    ({ heat, overheated, held }) => {
      const w = window as unknown as MeterWindow;
      w.game.multitool.meter = { heat, overheated, charge: 0 };
      w.dev.button(0, held);
    },
    { heat, overheated, held },
  );
}

/**
 * Parks the page's own frame loop (its requestAnimationFrame callbacks are dropped), so the game moves only as frames are
 * stepped: the meter a still is taken at is the one it was stepped to, however long the CSS waits run.
 */
async function parkLoop(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as { __holdRaf?: boolean };
    const raf = window.requestAnimationFrame.bind(window);
    w.__holdRaf = true;
    window.requestAnimationFrame = (cb) => (w.__holdRaf ? 0 : raf(cb));
    // (the callback already queued runs once more, then parks)
    await new Promise((r) => setTimeout(r, 100));
  });
}

/** On foot beside the landed ship on the home world: the #foot scenario, which lands the ship and steps out after 1.5 s of
 * real time, on foot for good, and settled. */
async function standingByShip(page: Page): Promise<void> {
  const onFoot = () =>
    page.waitForFunction(async () => {
      await (window as unknown as { step(n: number): Promise<void> }).step(4);
      return (window as unknown as { game: { mode: string } }).game.mode === 'foot';
    });
  await onFoot();
  await page.waitForTimeout(2500);
  await onFoot();
  await settle(page, 90);
}

/** The heat meter runs `k` times as fast as the game for the clip, so a whole overheat cycle fits a few seconds of it. */
async function hastenHeat(page: Page, k: number): Promise<void> {
  await page.evaluate((k) => {
    const mt = (window as unknown as { game: { multitool: { stepHeat(dt: number, held: boolean): void } } }).game.multitool;
    const step = mt.stepHeat.bind(mt);
    mt.stepHeat = (dt, held) => step(dt * k, held);
  }, k);
}

/**
 * The ship in open flight off the home world, nose just past it, `side` 1 on its day side (in sunlight, inside the habitable band:
 * Charge regenerates) or −1 on its night side (in its shadow: nothing), with Charge at `charge`.
 */
async function shipOffHome(page: Page, side: 1 | -1, charge: number): Promise<void> {
  await page.evaluate(
    ({ side, charge }) => {
      const w = window as unknown as MeterWindow;
      const g = w.game;
      const ship = g.ship;
      const home = g.system.homePlanet;
      const p = home.position;
      const l = Math.hypot(p.x, p.y, p.z);
      // three radii sunward of the planet (the star at the origin), a little to one side and above; on the night side close
      // enough to the sun line to stay in the planet's shadow
      const r = home.radius * 3;
      const sx = (-p.x / l) * side;
      const sz = (-p.z / l) * side;
      const across = side > 0 ? 0.35 : 0.12;
      const x = p.x + sx * r + sz * r * across;
      const y = p.y + r * (side > 0 ? 0.22 : 0.1);
      const z = p.z + sz * r - sx * r * across;
      ship.state.frame = null;
      ship.state.pos.set(x, y, z);
      // the nose (−Z forward) past the planet's limb, so the planet fills one side of the frame and the reticle and its
      // readouts sit over open space, as they do in flight
      const fx = p.x - sz * r * 0.75 - x;
      const fy = p.y - y;
      const fz = p.z + sx * r * 0.75 - z;
      const fl = Math.hypot(fx, fy, fz);
      const f = [fx / fl, fy / fl, fz / fl];
      // right = f × up(0,1,0), up' = right × f
      const rx = -f[2];
      const rz = f[0];
      const rl = Math.hypot(rx, rz);
      const right = [rx / rl, 0, rz / rl];
      const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
      // the rotation whose columns are right, up and −forward (a Matrix4's column-major elements: setFromRotationMatrix
      // reads nothing else)
      ship.state.quat.setFromRotationMatrix({ elements: [...right, 0, ...up, 0, -f[0]!, -f[1]!, -f[2]!, 0, 0, 0, 0, 1] });
      ship.mode = 'flying';
      ship.speed = 0;
      ship.charge = charge;
      g.cam.frame = undefined;
    },
    { side, charge },
  );
}

/** One inventory capture: the ship (its pods aboard), the skills, and what the cargo holds. */
interface InventoryScene {
  hull: string;
  pods: number;
  skills?: string[];
  /** The modules fitted, by hardpoint (default: Pulse Lasers on s1). */
  modules?: Record<string, string>;
  /** Added to the cargo pods in order, filling them pod by pod. */
  cargo: [string, number][];
  /** Or each pod's stacks laid out exactly, pod by pod. */
  podStacks?: [string, number][][];
}

/** A mining trip's haul in the suit, the same in every scene. */
const SUIT_HAUL: [string, number][] = [
  ['ferrite', 12480],
  ['carbon', 386],
  ['oxygen', 92],
  ['sodium', 45],
  ['dihydrogen', 210],
  ['copper', 64],
  ['tritium', 2200],
  ['cobalt', 18],
  ['gold', 31],
];

const INVENTORY_SCENES: Record<string, InventoryScene> = {
  // the Lark every pilot starts in: one pod
  lark: {
    hull: 'lark',
    pods: 1,
    cargo: [
      ['tritium', 9999],
      ['gold', 140],
      ['cobalt', 75],
      ['mining_laser', 1],
    ],
  },
  // the Lark with Pack Mule learned: a second pod in the bay it adds, and stacks of 15,000
  packMule: {
    hull: 'lark',
    pods: 2,
    skills: ['pack_mule'],
    cargo: [
      ['tritium', 15000 + 6400],
      ['gold', 140],
      ['cobalt', 75],
      ['mining_laser', 1],
      ['copper', 820],
      ['carbon', 2600],
      ['ferrite', 15000],
      ['dihydrogen', 900],
      ['flak_ammo', 300],
    ],
  },
  // a Mule hauler: four pods, two of them empty
  mule: {
    hull: 'mule',
    pods: 4,
    cargo: [
      ['tritium', 9999 * 3 + 4120],
      ['gold', 640],
      ['cobalt', 375],
      ['copper', 1210],
      ['ferrite', 9999 + 2760],
      ['carbon', 4400],
      ['mining_laser', 1],
      ['flak_ammo', 300],
    ],
  },
  // a Longhaul freighter with every pod in use: the pod list scrolls
  longhaulFull: {
    hull: 'longhaul',
    modules: { m1: 'flak_cannon' },
    pods: 16,
    cargo: [],
    podStacks: [
      [
        ['tritium', 9999],
        ['tritium', 9999],
        ['tritium', 9999],
        ['tritium', 4120],
      ],
      [
        ['ferrite', 9999],
        ['ferrite', 9999],
        ['ferrite', 3100],
      ],
      [
        ['carbon', 9999],
        ['carbon', 2600],
      ],
      [
        ['copper', 1210],
        ['cobalt', 375],
        ['gold', 640],
      ],
      [
        ['oxygen', 1800],
        ['sodium', 950],
      ],
      [
        ['dihydrogen', 9999],
        ['dihydrogen', 4200],
      ],
      [
        ['tritium', 9999],
        ['tritium', 9999],
        ['tritium', 6100],
      ],
      [
        ['ferrite', 9999],
        ['copper', 820],
      ],
      [
        ['gold', 210],
        ['cobalt', 160],
        ['copper', 400],
      ],
      [
        ['carbon', 9999],
        ['carbon', 9999],
        ['carbon', 1400],
      ],
      [
        ['frostglass', 120],
        ['cinderglass', 85],
      ],
      [
        ['tritium', 9999],
        ['tritium', 2500],
      ],
      [
        ['dihydrogen', 900],
        ['oxygen', 640],
        ['sodium', 300],
      ],
      [
        ['ferrite', 9999],
        ['ferrite', 9999],
        ['ferrite', 9999],
        ['ferrite', 750],
      ],
      [
        ['cobalt', 90],
        ['gold', 75],
      ],
      [
        ['mining_laser', 1],
        ['tritium', 3300],
        ['flak_ammo', 300],
      ],
    ],
  },
  // a Longhaul freighter: sixteen pods, two in use, the empty fourteen as one line
  longhaul: {
    hull: 'longhaul',
    modules: { m1: 'flak_cannon' },
    pods: 16,
    cargo: [
      ['tritium', 9999 * 6 + 5200],
      ['ferrite', 9999 * 2 + 3100],
      ['gold', 640],
      ['carbon', 4400],
      ['cobalt', 375],
      ['flak_ammo', 300],
    ],
  },
};

/** Boots a game, fits the scene's ship, loads the suit and the cargo, opens the inventory and hovers the ferrite stack:
 * the detail line names it, its count against the stack cap, and where it comes from. */
async function openInventory(page: Page, scene: InventoryScene): Promise<void> {
  await page.evaluate(() => (window as unknown as { dev: { boot(): Promise<void> } }).dev.boot());
  await page.evaluate(
    ({ scene, suit }) => {
      const g = (window as unknown as { game: { inventory: InventoryApi; menus: { openInventory(): void } } }).game;
      const inv = g.inventory;
      inv.setLoadout({
        ship: { hull: scene.hull, modules: scene.modules ?? { s1: 'pulse_lasers' }, cargoPods: scene.pods, livery: 0 },
        skills: scene.skills ?? [],
      });
      for (const [id, n] of suit) inv.add(id, n, 'suit');
      for (const [id, n] of scene.cargo) inv.add(id, n, 'cargo');
      if (scene.podStacks) {
        const pods = inv.state.pods.map((pod, p) =>
          pod.map((_, i) => (scene.podStacks![p]?.[i] ? { item: scene.podStacks![p]![i]![0], count: scene.podStacks![p]![i]![1] } : null)),
        );
        inv.restore({ ...inv.state, pods });
      }
      g.menus.openInventory();
    },
    { scene, suit: SUIT_HAUL },
  );
  await settle(page, 60);
  const slot = page.locator('.inv-slot[data-c="suit"][data-i="1"]');
  const box = await slot.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
}

/**
 * The inventory's motion for the clip: the panel opens again (it rises 8 px as it fades in, 0.36 s), then, 0.3 s of
 * animation time later, a click sends the carbon stack across to the cargo through the screen's own pointer handlers: a
 * tile flies from the suit slot to the cargo slot (0.18 s, ease-out), the slot it lands on settles back, and on a merge
 * (the Mule's and the Longhaul's carbon) the count ticks up to the new total. Page timers run on real time while the clip
 * slows CSS and Web Animations tenfold, hence 3000 ms: the flight spans about frames 18 to 29.
 */
async function inventoryMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const menus = (window as unknown as { game: { menus: { closeAll(): void; openInventory(): void } } }).game.menus;
    menus.closeAll();
    menus.openInventory();
    setTimeout(() => {
      const slot = document.querySelector('.inv-slot[data-c="suit"][data-i="3"]');
      if (!slot) return;
      const at = slot.getBoundingClientRect();
      const init = { bubbles: true, button: 0, clientX: at.x + at.width / 2, clientY: at.y + at.height / 2, pointerId: 1, isPrimary: true };
      slot.dispatchEvent(new PointerEvent('pointerdown', init));
      slot.dispatchEvent(new PointerEvent('pointerup', init));
    }, 3000);
  });
}

/** The open (every third frame), every frame of the flight, then the landing settling. */
const INVENTORY_SHEET = [0, 3, 6, 9, 12, 15, ...Array.from({ length: 13 }, (_, k) => 18 + k), 33, 36, 40, 45, 50, 59];

const inventoryScreen = (scene: InventoryScene, extra: Partial<ScreenDef> = {}): ScreenDef => ({
  open: (page) => openInventory(page, scene),
  motion: inventoryMotion,
  sheetFrames: INVENTORY_SHEET,
  ...extra,
});

/** All nineteen resources (DESIGN 15.3, P1.E13.T02), a stack of each, by family: the suit holds the warp cell, the plants,
 * the rock and deposit finds and the hostile worlds' six; the Lark's pod the asteroids' two, the Count's, the Hollow's
 * and the Cartographers' leavings, and the mining laser. */
const NINETEEN_SUIT: [string, number][] = [
  ['warp_cell', 1],
  ['carbon', 386],
  ['sodium', 45],
  ['oxygen', 92],
  ['ferrite', 9999],
  ['dihydrogen', 210],
  ['copper', 64],
  ['cobalt', 18],
  ['gold', 31],
  ['frostglass', 120],
  ['acidsalt', 85],
  ['cinderglass', 64],
  ['stormquartz', 38],
  ['gamma_crystal', 22],
  ['murkpearl', 12],
  ['ferrite', 2481],
];
const NINETEEN_POD: [string, number][] = [
  ['tritium', 9999],
  ['iridium', 46],
  ['count_residue', 140],
  ['husk_alloy', 6],
  ['glyphstone', 3],
  ['mining_laser', 1],
];

/** Lays the nineteen out (16x9-resources.png) and hovers the frostglass stack, so the detail line says where it comes
 * from. */
async function showNineteen(page: Page): Promise<void> {
  await page.evaluate(
    ({ suit, pod }) => {
      const g = (window as unknown as { game: { inventory: InventoryApi; menus: { renderInventory(): void } } }).game;
      const inv = g.inventory;
      // (no named functions in here: the bundler would wrap them in a helper the page does not have)
      inv.restore({
        ...inv.state,
        suit: inv.state.suit.map((_, i) => (suit[i] ? { item: suit[i]![0], count: suit[i]![1] } : null)),
        pods: inv.state.pods.map((p, k) => p.map((_, i) => (!k && pod[i] ? { item: pod[i]![0], count: pod[i]![1] } : null))),
      });
      g.menus.renderInventory();
    },
    { suit: NINETEEN_SUIT, pod: NINETEEN_POD },
  );
  await settle(page, 30);
  const slot = page.locator(`.inv-slot[data-c="suit"][data-i="${NINETEEN_SUIT.findIndex(([id]) => id === 'frostglass')}"]`);
  const box = await slot.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
}

/** The cargo list scrolled to its end: the last pod and the footer both in view. */
async function scrollPodsToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pods = document.querySelector('.inv-pods');
    if (pods) pods.scrollTop = pods.scrollHeight;
  });
  await page.waitForTimeout(300);
}

/** What the cutscene screens reach of the page. */
interface CutscenePage {
  game: {
    cutscenes: { load(id: string): Promise<unknown>; stage(def: unknown): boolean; play(id: string): Promise<unknown>; stop(): void };
    hud: { clearBanners(): void };
  };
  dev: { boot(): Promise<void> };
  step(n: number): Promise<void>;
  __holdRaf?: boolean;
}

/**
 * Boots a game with the ship where the cutscene stages it and the world settled, then parks the page's own frame loop
 * (its requestAnimationFrame callbacks are dropped), so the cutscene's clock moves only as frames are stepped: a still
 * is taken where it was stepped to, however long the CSS waits run.
 */
async function stageCutscene(page: Page, id: string): Promise<void> {
  await page.evaluate(() => (window as unknown as CutscenePage).dev.boot());
  await page.evaluate(async (id) => {
    const w = window as unknown as CutscenePage;
    w.game.cutscenes.stage(await w.game.cutscenes.load(id));
  }, id);
  await settle(page, 120);
  await page.evaluate(async () => {
    const w = window as unknown as CutscenePage & { requestAnimationFrame(cb: FrameRequestCallback): number };
    const raf = window.requestAnimationFrame.bind(window);
    w.__holdRaf = true;
    window.requestAnimationFrame = (cb) => (w.__holdRaf ? 0 : raf(cb));
    // (the callback already queued runs once more, then parks)
    await new Promise((r) => setTimeout(r, 100));
  });
}

/** Plays the cutscene from its start (ending one under way, and any banner) and steps `t` seconds into it. */
async function playCutsceneTo(page: Page, id: string, t: number): Promise<void> {
  await page.evaluate(
    async ({ id, t }) => {
      const w = window as unknown as CutscenePage;
      w.game.cutscenes.stop();
      w.game.hud.clearBanners();
      void w.game.cutscenes.play(id);
      await new Promise((r) => setTimeout(r, 0));
      await w.step(Math.round(t * 60));
    },
    { id, t },
  );
  // (a banner fades in on a CSS animation, which runs on real time)
  await page.waitForTimeout(1200);
}

export const SCREENS: Record<string, ScreenDef> = {
  title: {
    // the menu's sunrise runs 3 s after a 0.6 s delay (style.css .title-screen)
    clipSeconds: 3.6,
    async open(page) {
      await page.waitForFunction(async () => {
        await (window as unknown as { step(n: number): Promise<void> }).step(2);
        const b = document.querySelector<HTMLButtonElement>('.title-screen [data-act="start"]');
        return !!b && !b.disabled;
      });
      await settle(page, 30);
      // the menu fades in on CSS transitions, which run on real time
      await page.waitForTimeout(2500);
    },
    async motion(page) {
      // replay the title's fade-in: restart every CSS animation in the title screen
      await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('.title-screen');
        for (const a of el?.getAnimations({ subtree: true }) ?? []) {
          a.cancel();
          a.play();
        }
      });
    },
  },
  // In flight off the home world's day side, in sunlight inside the habitable band: Charge (the right arc and the readout
  // under the altitude) at 58 and regenerating, a bright dash climbing its arc (P1.E07.T02). `16x9-empty.png`: Charge run
  // out on the night side, in the planet's shadow (no regeneration), and the pulse drive refused. The clip: the regen
  // sheen's whole climb, the readout ticking up.
  // Boarding in play with Charge at 60 (the ship's, set while the pilot stood beside it on the home world's day side): the
  // stills are aboard and landed after the glide into the seat, the reticle not yet up; the clip starts as the ship
  // takes off, its first frame the first the reticle (and its Charge arc, readout and regen sheen) is drawn: the arc at 60
  // at once, lilac, the sheen from the next frame.
  'hud-ship-board': {
    hash: '#foot',
    hudClock: true,
    clipSeconds: 1.5,
    sheetFrames: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 89],
    async open(page) {
      await standingByShip(page);
      // the game moves only as it is stepped from here: Charge regenerates 2/s through the glide's 5 s, 50 to 60
      await parkLoop(page);
      await page.evaluate(() => {
        const g = (window as unknown as { game: { ship: { charge: number }; boardShip(): void } }).game;
        g.ship.charge = 50;
        g.boardShip();
      });
      // the glide into the seat (4.2 s)
      await settle(page, 300);
    },
    async motion(page) {
      await page.evaluate(() => (window as unknown as { game: { ship: { takeOff(): void } } }).game.ship.takeOff());
    },
  },
  'hud-ship': {
    hudClock: true,
    clipSeconds: 2,
    async open(page) {
      await page.evaluate(() => (window as unknown as { dev: { boot(): Promise<void> } }).dev.boot());
      await settle(page, 60);
      await shipOffHome(page, 1, 58);
      await settle(page, 90);
    },
    stills16x9: {
      async empty(page) {
        await shipOffHome(page, -1, 0);
        await settle(page, 90);
        await page.evaluate(() => (window as unknown as MeterWindow).game.ship.tryPulse());
        await settle(page, 6);
      },
    },
    async motion(page) {
      await shipOffHome(page, 1, 58);
      // (the empty still's refusal is not this scene's)
      await page.evaluate(() => (document.querySelector('.toasts') as HTMLElement).replaceChildren());
    },
  },
  // On foot on the home world, mining with the beam held: the heat arc (left of the dot) at 40 of 100, 40% of it lit, warm
  // (P1.E07.T02). `16x9-overheat.png`: the lockout at the top, the arc danger red with a tick where the lockout ends and
  // OVERHEAT under the dot. The clip: a whole cycle with the beam held throughout, the meter at three times the game's
  // pace: from cool it climbs, turns amber at 75, overheats at 100 (about 1.4 s in), cools through the lockout to the tick
  // at 25 (about 2.6 s) and the lockout lifts, the beam heating again.
  'hud-foot': {
    hash: '#foot',
    hudClock: true,
    clipSeconds: 3,
    async open(page) {
      await standingByShip(page);
      await parkLoop(page);
      // 38, and five frames of beam at 24/s: 40
      await heatAt(page, 38, false, true);
      await settle(page, 5);
    },
    stills16x9: {
      async overheat(page) {
        await heatAt(page, 100, true, true);
        await settle(page, 3);
      },
    },
    async motion(page) {
      // the overheat still's lockout cleared and settled before the first frame: cool, the button up, the HUD told, and
      // its fades run out (CSS runs at a tenth of real time while the clip records: OVERHEAT's 0.25 s, the arc's 0.4 s)
      await heatAt(page, 0, false, false);
      await page.evaluate(() => (window as unknown as { game: { hud: { update(dt: number): void } } }).game.hud.update(0));
      await page.waitForTimeout(5000);
      // then the beam held from cool
      await page.evaluate(() => (window as unknown as MeterWindow).dev.button(0, true));
      await hastenHeat(page, 3);
    },
  },
  // Leaving the ship on foot with the multitool still warm (heat 50): the stills are aboard and landed; the clip's first
  // frame is the foot HUD's first, the crosshair fading in (150 ms) with its heat arc already at 50 and cooling at 20/s.
  'hud-foot-exit': {
    hash: '#foot',
    hudClock: true,
    clipSeconds: 0.6,
    sheetFrames: [...Array.from({ length: 20 }, (_, i) => i), 24, 29, 35],
    async open(page) {
      await standingByShip(page);
      await parkLoop(page);
      await page.evaluate(() => (window as unknown as { game: { boardShip(): void } }).game.boardShip());
      // aboard: the glide into the seat (4.2 s)
      await settle(page, 300);
    },
    async motion(page) {
      await page.evaluate(() => {
        const g = (window as unknown as { game: MeterGame & { exitShip(): void } }).game;
        g.multitool.meter = { heat: 50, overheated: false, charge: 0 };
        g.exitShip();
      });
    },
  },
  map: {
    async open(page) {
      await page.evaluate(() => (window as unknown as { dev: { boot(): Promise<void> } }).dev.boot());
      await page.evaluate(() => (window as unknown as { game: { menus: { openMap(): void } } }).game.menus.openMap());
      await settle(page, 60);
    },
  },
  // the inventory (P1.E06.T04): suit stacks beside the ship's cargo pods after a mining trip, the ferrite stack hovered.
  // `inventory` is the Lark every pilot starts in (one pod); `inventory-pack-mule` the Lark with Pack Mule (two pods,
  // stacks of 15,000); `inventory-hauler` a Mule's four pods; `inventory-longhaul` a Longhaul's sixteen. `inventory` adds
  // a still of all nineteen resources' icons (16x9-resources.png, P1.E13.T02), which the clip then shows too.
  inventory: inventoryScreen(INVENTORY_SCENES.lark!, { stills16x9: { resources: showNineteen } }),
  'inventory-pack-mule': inventoryScreen(INVENTORY_SCENES.packMule!),
  'inventory-hauler': inventoryScreen(INVENTORY_SCENES.mule!),
  'inventory-longhaul': inventoryScreen(INVENTORY_SCENES.longhaul!),
  // every one of a Longhaul's sixteen pods in use: the pod list scrolls, with its scrollbar drawn, and a still of it
  // scrolled to the end (16x9-scrolled.png)
  'inventory-longhaul-full': inventoryScreen(INVENTORY_SCENES.longhaulFull!, { showScrollbars: true, stills16x9: { scrolled: scrollPodsToEnd } }),
  // the demo's box station, from outside and from a hangar pad (grader calibration, P1.E14.T09; later the kit-built
  // Waystation of P1.E11.T02)
  'station-exterior': {
    hash: '#station',
    async open(page) {
      await page.waitForFunction(async () => {
        await (window as unknown as { step(n: number): Promise<void> }).step(4);
        return (window as unknown as { game: { mode: string } }).game.mode === 'ship';
      });
      // the scenario parks the ship 200 m off the hangar mouth; hold it there
      await page.evaluate(() => {
        const g = (window as unknown as { game: { ship: { speed: number; throttle?: number } } }).game;
        g.ship.speed = 0;
      });
      await settle(page, 90);
    },
  },
  // the test cutscene (P1.E09.T04; packages/client/public/cutscenes/test.json from assets/blend/cutscenes/
  // test_cutscene.blend): the stills mid-dialogue 6.6 s in (the station shot, its banner, the second line), the approach
  // 2.6 s in and the return 10 s in; the clip the whole of it from the player's chase view, letterbox in, three shots,
  // three lines and the banner, to the letterbox out and the camera back on the ship (11.5 s, then 1.5 s back)
  'cutscene-test': {
    hudClock: true,
    clipSeconds: 13.4,
    // the glide in (every 14 frames), each cut and the frames either side, the banner, the exit (every 20)
    sheetFrames: [0, 14, 28, 42, 56, 96, 170, 240, 262, 268, 300, 340, 420, 476, 484, 560, 640, 688, 700, 720, 740, 760, 780, 803],
    async open(page) {
      await stageCutscene(page, 'test');
      await playCutsceneTo(page, 'test', 6.6);
    },
    stills16x9: {
      approach: (page) => playCutsceneTo(page, 'test', 2.6),
      return: (page) => playCutsceneTo(page, 'test', 10),
    },
    async motion(page) {
      await page.evaluate(async () => {
        const w = window as unknown as CutscenePage;
        w.game.cutscenes.stop();
        w.game.hud.clearBanners();
        void w.game.cutscenes.play('test');
        await new Promise((r) => setTimeout(r, 0));
      });
    },
  },
  // the test cutscene's keys (P1.E09.T04): Space on a line already read jumps to the next behind a short dip (the still
  // 2.2 s in, the first line read; the clip from the key press: the dip, the next shot, the next line revealing)
  'cutscene-test-jump': {
    hudClock: true,
    clipSeconds: 1.5,
    sheetFrames: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 21, 24, 30, 36, 42, 48, 56, 64, 72, 80, 89],
    async open(page) {
      await stageCutscene(page, 'test');
      await playCutsceneTo(page, 'test', 2.2);
    },
    async motion(page) {
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
      });
    },
  },
  // and Esc mid-line skips it (the still 2.6 s in, the first line showing; the clip from the key press: the letterbox
  // opening and the camera gliding back to the ship over 1.5 s)
  'cutscene-test-skip': {
    hudClock: true,
    clipSeconds: 1.8,
    sheetFrames: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100, 107],
    async open(page) {
      await stageCutscene(page, 'test');
      await playCutsceneTo(page, 'test', 2.6);
    },
    async motion(page) {
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })));
    },
  },
  'station-hangar': {
    hash: '#dock',
    async open(page) {
      await page.waitForFunction(async () => {
        await (window as unknown as { step(n: number): Promise<void> }).step(4);
        return (window as unknown as { game: { mode: string } }).game.mode === 'foot';
      });
      await settle(page, 90);
    },
  },
};
