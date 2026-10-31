// The UI screens `pnpm capture -- --ui <screen>` knows how to reach. Each later UI task adds its screen here, so the
// grader always gets its 16:9 and 21:9 captures and a 60 fps clip the same way.
import type { Page } from '@playwright/test';
import { GALAXY_SEED, Galaxy, homeSystems } from '@astra/shared/world';

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
  /** Console errors the screen causes on purpose (the browser reports a refused request, say), not counted against it. */
  expectedErrors?: RegExp[];
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
 * real time, on foot for good, out of the camera's glide, and settled. */
async function standingByShip(page: Page): Promise<void> {
  // (on the world: getting out of the sandbox's first ship, still by the Waystation, is on foot too, in its hangar)
  const onFoot = () =>
    page.waitForFunction(async () => {
      const w = window as unknown as { step(n: number): Promise<void>; game: { mode: string; player: { state: { frame?: { sampler?: unknown } } } } };
      await w.step(4);
      return w.game.mode === 'foot' && !!w.game.player.state.frame?.sampler;
    });
  await onFoot();
  await page.waitForTimeout(2500);
  await onFoot();
  // the camera's ease from the ship into the walker's head (4 s of game time) can outlast that on a loaded machine: stepped
  // out, so the multitool is up and the view still before anything is taken
  for (let i = 0; i < 60; i++) {
    const gliding = await page.evaluate(async () => {
      const w = window as unknown as { step(n: number): Promise<void>; game: { director: { pose: unknown; blend: unknown } } };
      await w.step(10);
      return !!(w.game.director.pose || w.game.director.blend);
    });
    if (!gliding) break;
  }
  await settle(page, 90);
  // and the arrival banner run out (it and the band under it last 7 s of the page's own time), the multitool raised
  await page.waitForFunction(
    async () => {
      const w = window as unknown as { step(n: number): Promise<void>; game: { hud: { bannerUntil?: number }; multitool: { raise?: number } } };
      await w.step(4);
      return performance.now() > (w.game.hud.bannerUntil ?? 0) + 1000 && (w.game.multitool.raise ?? 0) >= 1;
    },
    null,
    { timeout: 60_000, polling: 100 },
  );
}

/**
 * Turns the walker to the heading nearest its own (5° steps either way) whose crosshair is on a plant or rock under 3 m tall,
 * 4 to 25 m off, so the beam's impact glare sits right behind the crosshair. Where the #foot scenario leaves the walker
 * facing varies with how fast the machine runs its landing, and the flora's hit spheres miss a tall tree's trunk at eye
 * level, so the beam can strike a rock hidden behind one.
 */
async function faceFlora(page: Page): Promise<void> {
  const found = await page.evaluate(async () => {
    type V = { copy(v: V): V; clone(): V; normalize(): V; applyAxisAngle(axis: V, a: number): V; distanceTo(v: V): number };
    const w = window as unknown as {
      step(n: number): Promise<void>;
      game: {
        player: { heading: V; state: { pos: V } };
        cam: { pos: V };
        multitool: { target: { point: V; scale: number; sp: { height: number } } | null };
      };
    };
    const g = w.game;
    const up = g.player.state.pos.clone().normalize();
    const start = g.player.heading.clone();
    for (let i = 0; i <= 72; i++) {
      const turn = (((i + 1) >> 1) * (i % 2 ? 1 : -1) * Math.PI) / 36;
      g.player.heading.copy(start).applyAxisAngle(up, turn);
      await w.step(2);
      const t = g.multitool.target;
      const d = t ? t.point.distanceTo(g.cam.pos) : 0;
      if (t && t.sp.height * t.scale < 3 && d >= 4 && d <= 25) return true;
    }
    return false;
  });
  if (!found) throw new Error('no plant or rock 4 to 25 m off in any direction from where the walker stands');
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

/** What the fabricator screens reach of the page. */
interface FabricatorPage {
  game: {
    inventory: InventoryApi;
    fabricator: { open(at: 'station' | 'ship'): void };
    station: { pads: { x: number; z: number }[] };
    ship: { state: { pos: { clone(): { set(x: number, y: number, z: number): unknown } } } };
    player: { spawn(frame: unknown, at: unknown, heading: unknown): void };
    system: { homePlanet: unknown };
    dockOnPad(near: unknown): void;
    debugGoto(planet: unknown, opts: { sunAngle: number; alt: number; azimuth: number }): void;
    mode: string;
    cam: { frame: unknown };
  };
  dev: { boot(): Promise<void> };
}

/** A mining trip's haul as it reaches a fabricator: enough for a warp cell, a pulse fuel cell and two sodium cartridges,
 * short of oxygen and of ferrite for flak, and a torpedo recipe found on the way (to learn). */
const FAB_SUIT: [string, number][] = [
  ['dihydrogen', 64],
  ['tritium', 41],
  ['cobalt', 7],
  ['oxygen', 12],
  ['sodium', 46],
  ['ferrite', 18],
  ['carbon', 37],
  ['copper', 22],
  ['recipe_torpedo', 1],
];

/** Lays the haul out in the suit (the Lark's pod holding a little more), then opens fabricator `at`. */
async function stockAndOpen(page: Page, at: 'station' | 'ship', suit: [string, number][], pod: [string, number][]): Promise<void> {
  await page.evaluate(
    ({ at, suit, pod }) => {
      const g = (window as unknown as FabricatorPage).game;
      const inv = g.inventory;
      // (no named functions in here: the bundler would wrap them in a helper the page does not have)
      inv.restore({
        ...inv.state,
        suit: inv.state.suit.map((_, i) => (suit[i] ? { item: suit[i]![0], count: suit[i]![1] } : null)),
        pods: inv.state.pods.map((p, k) => p.map((_, i) => (!k && pod[i] ? { item: pod[i]![0], count: pod[i]![1] } : null))),
      });
      g.fabricator.open(at);
    },
    { at, suit, pod },
  );
  await settle(page, 30);
}

/** Clicks a control of the fabricator screen (a recipe row, Craft, a stepper button) through its own click handler. */
async function fabClick(page: Page, selector: string): Promise<void> {
  await page.evaluate((s) => document.querySelector<HTMLElement>(s)?.click(), selector);
  await page.waitForTimeout(400);
}

/**
 * The Waystation's fabricator (P1.E13.T05): the pilot on foot at the fabricator terminal on the trade deck, its ship on
 * a pad behind, after a mining trip. The five recipes it starts with: three it can make, two short of materials; a
 * torpedo recipe to learn. The oxygen cartridge selected and Craft pressed: refused, "not enough oxygen", the short
 * material flashing.
 */
async function openStationFabricator(page: Page): Promise<void> {
  await stationFabricator(page);
  await fabClick(page, '.fab-row[data-recipe="oxygen_cartridge"]');
  await fabClick(page, '[data-make]');
  await page.waitForTimeout(800);
}

/** The same scene at the Waystation, the fabricator opened on the warp cell it can make, nothing pressed yet. */
async function stationFabricator(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as FabricatorPage).dev.boot());
  await page.evaluate(() => {
    const g = (window as unknown as FabricatorPage).game;
    const pad = g.station.pads[3]!;
    g.dockOnPad(g.ship.state.pos.clone().set(pad.x, 0, pad.z));
    // a couple of metres back from the terminal (the kiosk at x −30, z −80 on the 7 m deck), turned to it
    g.player.spawn(g.station, g.ship.state.pos.clone().set(-28.6, 7.05, -77.4), g.ship.state.pos.clone().set(-0.5, 0, -0.866));
    g.mode = 'foot';
    g.cam.frame = undefined;
  });
  await settle(page, 120);
  await stockAndOpen(page, 'station', FAB_SUIT, [
    ['tritium', 380],
    ['carbon', 240],
  ]);
}

/** The ship's fabricator: in the Lark landed on the home world, the haul aboard, flak ammo selected, three crafts. */
async function openShipFabricator(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as FabricatorPage).dev.boot());
  await page.evaluate(() => {
    const g = (window as unknown as FabricatorPage).game;
    g.debugGoto(g.system.homePlanet, { sunAngle: 40, alt: 0, azimuth: 20 });
    g.mode = 'ship';
    g.cam.frame = undefined;
  });
  await settle(page, 150);
  await stockAndOpen(
    page,
    'ship',
    FAB_SUIT.map(([id, n]) => [id, id === 'ferrite' ? 96 : n]),
    [
      ['tritium', 380],
      ['carbon', 240],
    ],
  );
  await fabClick(page, '.fab-row[data-recipe="flak_ammo"]');
  await fabClick(page, '[data-q="1"]');
  await fabClick(page, '[data-q="1"]');
}

/**
 * A craft's motion for the clip: 0.2 s of animation time after the clip starts, Craft is pressed through the screen's
 * own handler; the fabrication runs across the button (0.56 s, ease-in-out), then what was made shows in the line under
 * the columns, the material counts drop and the rows that changed settle back (0.7 s). Page timers run on real time while
 * the clip slows CSS and Web Animations tenfold, hence 2000 ms.
 */
const fabricatorMotion =
  (select: string | null) =>
  async (page: Page): Promise<void> => {
    if (select) await fabClick(page, `.fab-row[data-recipe="${select}"]`);
    await page.evaluate(() => setTimeout(() => document.querySelector<HTMLElement>('[data-make]')?.click(), 2000));
  };

/**
 * A lesson's motion for the clip: 0.2 s in, LEARN is pressed on the torpedo recipe (the haul's find); its row eases up out
 * of "Recipes to learn" into the recipe list (0.38 s) and flashes once, the heading fades out (0.2 s), the controls
 * dimmed by the press come back, and the torpedo's details come in beside it (0.28 s).
 */
async function learnMotion(page: Page): Promise<void> {
  await page.evaluate(() => setTimeout(() => document.querySelector<HTMLElement>('[data-learn="torpedo"]')?.click(), 2000));
}

/**
 * The stepper at its limits, then a refusal, for the clip (each step 0.15 s of animation time apart; page timers run on
 * real time while the clip slows CSS and Web Animations tenfold, hence 1500 ms): + and MAX pressed on the warp cell at 1
 * of 1 (both dimmed: nothing happens), the flak ammo picked (it can make none), + and MAX pressed there (nothing), then
 * Enter: refused, "not enough ferrite", the line under the columns cross-fading to it and the short ferrite flashing red.
 */
async function limitsMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const press = [
      () => document.querySelector<HTMLElement>('[data-q="1"]')?.click(),
      () => document.querySelector<HTMLElement>('[data-q="max"]')?.click(),
      () => document.querySelector<HTMLElement>('.fab-row[data-recipe="flak_ammo"]')?.click(),
      () => document.querySelector<HTMLElement>('[data-q="1"]')?.click(),
      () => document.querySelector<HTMLElement>('[data-q="max"]')?.click(),
      () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true })),
    ];
    press.forEach((fn, k) => setTimeout(fn, 2000 + k * 1500));
  });
}

/** The stepper at a maximum above one: the pulse fuel cell (the haul makes six) set to 6 of 6 with MAX, + and MAX dimmed
 * and − lit. */
async function stepperAtSix(page: Page): Promise<void> {
  await stationFabricator(page);
  await fabClick(page, '.fab-row[data-recipe="pulse_fuel_cell"]');
  await fabClick(page, '[data-q="max"]');
}

/**
 * Its clip, each step 0.2 s of animation time apart (page timers run on real time, the clip's animations tenfold slower):
 * − to 5 (+ and MAX light up), + back to 6 (they dim), then + and MAX pressed at 6, which do nothing.
 */
async function stepperMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const press = ['[data-q="-1"]', '[data-q="1"]', '[data-q="1"]', '[data-q="max"]'];
    press.forEach((sel, k) => setTimeout(() => document.querySelector<HTMLElement>(sel)?.click(), 2000 + k * 2000));
  });
}

/** The press (every third frame), the fabrication's run across the button, the result and the rows settling. */
const FABRICATOR_SHEET = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96, 104, 112, 119];

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

// ---------- the sign-in and character screens (P1.E04.T05) ----------
// Hermetic: the gateway's answers are recorded here and served by the page's own routes (no game server runs), and the
// game socket is answered in the page too: silent (the entering step waits on it), or a welcome after a while.

const ACCOUNT_ID = '5d0c2b7e-8a41-4c39-9f0e-2b6f1d7c9a10';
/** A session token shaped as the server's (only its expiry is read by the client), good until 2100. */
const TOKEN = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ sub: ACCOUNT_ID, exp: 4102444800 })).toString('base64url')}.capture`;
const LOOK = { palette: 0, pattern: 0, head: 0, suit: 0 };
const homeOf = (people: string) => homeSystems(GALAXY_SEED).find((h) => h.people === people)!.systemIndex;
const CHARACTERS = [
  { id: '0b6e4f1a-3c2d-4e5f-8a9b-1c2d3e4f5a61', name: 'Tess Arlo', people: 'thalune', look: LOOK, level: 7, homeSystem: homeOf('thalune') },
  { id: '0b6e4f1a-3c2d-4e5f-8a9b-1c2d3e4f5a62', name: 'Quill Ventrasse', people: 'ixari', look: LOOK, level: 3, homeSystem: homeOf('ixari') },
  { id: '0b6e4f1a-3c2d-4e5f-8a9b-1c2d3e4f5a63', name: 'Odo Marrow-Kell', people: 'ulgani', look: LOOK, level: 12, homeSystem: homeOf('ulgani') },
];
const NEW_ID = '0b6e4f1a-3c2d-4e5f-8a9b-1c2d3e4f5a64';
/** A full account: the three above and three more, six of six. */
const SIX = [
  ...CHARACTERS,
  { id: '0b6e4f1a-3c2d-4e5f-8a9b-1c2d3e4f5a65', name: 'Mira Okonta', people: 'thalune', look: LOOK, level: 22, homeSystem: homeOf('thalune') },
  { id: '0b6e4f1a-3c2d-4e5f-8a9b-1c2d3e4f5a66', name: 'Sefa Lune', people: 'ixari', look: LOOK, level: 15, homeSystem: homeOf('ixari') },
  { id: '0b6e4f1a-3c2d-4e5f-8a9b-1c2d3e4f5a67', name: "Bram O'Hollow", people: 'ulgani', look: LOOK, level: 9, homeSystem: homeOf('ulgani') },
];
/** What the browser logs for the wrong password, and the taken username, these screens send on purpose. */
const REFUSED_SIGN_IN = /Failed to load resource: the server responded with a status of 401/;
const REFUSED_SIGN_UP = /Failed to load resource: the server responded with a status of 409/;

interface AccountServer {
  /** Sign-ins the server refuses before it takes one (a wrong password). */
  refuseLogins?: number;
  /** How long each answer takes, ms of real time (the clip runs animations ten times slower). */
  delayMs?: number;
  /** The game socket: silent, or a welcome this long (real ms) after the join. */
  welcomeAfterMs?: number | null;
  /** The account's characters (by default the three above). */
  characters?: typeof CHARACTERS;
  /** Usernames another account holds: signing up as one is refused. */
  taken?: string[];
}

/** Serves the account screens' requests from the recorded answers above, and the game socket in the page. */
async function serveAccount(
  page: Page,
  { refuseLogins = 0, delayMs = 0, welcomeAfterMs = null, characters = CHARACTERS, taken = [] }: AccountServer = {},
): Promise<void> {
  const later = () => new Promise((r) => setTimeout(r, delayMs));
  let refused = 0;
  const made: typeof CHARACTERS = [];
  await page.route('**/auth/login', async (route) => {
    await later();
    if (refused++ < refuseLogins) await route.fulfill({ status: 401, json: { error: 'login_failed', message: 'Wrong username or password.' } });
    else await route.fulfill({ status: 200, json: { token: TOKEN, accountId: ACCOUNT_ID } });
  });
  await page.route('**/auth/register', async (route) => {
    await later();
    const body = route.request().postDataJSON() as { username: string };
    if (taken.includes(body.username.toLowerCase()))
      await route.fulfill({ status: 409, json: { error: 'username_taken', message: 'That username is taken.' } });
    else await route.fulfill({ status: 201, json: { token: TOKEN, accountId: ACCOUNT_ID } });
  });
  await page.route('**/characters', async (route) => {
    await later();
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string; people: string };
      const c = { id: NEW_ID, name: body.name, people: body.people, look: LOOK, level: 1, homeSystem: homeOf(body.people) };
      made.push(c);
      await route.fulfill({ status: 201, json: c });
    } else await route.fulfill({ status: 200, json: { characters: [...characters, ...made], max: 6 } });
  });
  const galaxy = new Galaxy(GALAXY_SEED);
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw)) as { t: string; characterId?: string };
      if (m.t !== 'join' || welcomeAfterMs === null) return;
      const character = [...characters, ...made].find((c) => c.id === m.characterId)!;
      const seed = galaxy.systems[character.homeSystem]!.seed;
      const welcome = {
        t: 'welcome',
        accountId: ACCOUNT_ID,
        character,
        entityId: 7,
        serverTime: 3.15e7,
        zone: { id: `sys:${character.homeSystem}`, systemSeed: seed },
        // docked on a hangar pad of its home Waystation, as a new character starts
        pose: { frame: `${seed}:station`, pos: [30, 2.4, 22], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
        mode: 'docked',
      };
      setTimeout(() => ws.send(JSON.stringify(welcome)), welcomeAfterMs);
    });
  });
}

/** The title, ready to play, Play focused (as the title leaves it), the HUD's audio off. */
async function titleReady(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { game: { audio: { start(): void } } }).game.audio.start = () => {};
  });
  await page.waitForFunction(async () => {
    await (window as unknown as { step(n: number): Promise<void> }).step(2);
    const b = document.querySelector<HTMLButtonElement>('.title-screen [data-act="start"]');
    return !!b && !b.disabled;
  });
  await settle(page, 30);
  await page.waitForTimeout(2500);
  await page.focus('.title-screen [data-act="start"]');
}

/** Steps a few frames and waits out the flow's CSS (it runs on real time outside a clip). */
async function settleFlow(page: Page, ms = 1600): Promise<void> {
  await settle(page, 10);
  await page.waitForTimeout(ms);
}

/** Play → sign in as tess_arlo (`password`) → Enter. */
async function signIn(page: Page, password: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.waitForSelector('.acct [data-form="signin"] input[name="username"]');
  await page.waitForTimeout(400);
  await page.keyboard.type('tess_arlo');
  await page.keyboard.press('Tab');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
}

/** Back to the title as a new browser would show it: signed out, the flow closed, nothing typed, Play focused. */
async function resetFlow(page: Page, settleMs = 800): Promise<void> {
  await page.evaluate(() => {
    const flow = (window as unknown as { game: { menus: { account: { flow: { close(): void; set(p: object): void } } } } }).game.menus.account.flow;
    sessionStorage.removeItem('astra-session');
    flow.close();
    flow.set({ username: '' });
  });
  await page.waitForTimeout(settleMs);
  await page.focus('.title-screen [data-act="start"]');
}

/** The mouse captured, as a player's click grants it (headless Chromium refuses the real pointer lock: the game's own
 * fallback), so the world shows without the pause menu. */
async function grantLock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const input = (window as unknown as { game: { input: { fallbackLock: boolean; locked: boolean } } }).game.input;
    input.fallbackLock = true;
    input.locked = true;
    document.dispatchEvent(new Event('pointerlockchange'));
  });
}

/** Play → Create an account → `username` and a password → Enter. */
async function signUpAs(page: Page, username: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.click('.acct [data-form="signin"] [data-do="to-register"]');
  await page.waitForSelector('.acct [data-form="register"] input[name="username"]');
  await page.waitForTimeout(400);
  await page.keyboard.type(username);
  await page.keyboard.press('Tab');
  await page.keyboard.type('correct-horse');
  await page.keyboard.press('Enter');
}

/** Runs `steps` in the background, each `at` seconds of clip time in (the clip slows the page's animations tenfold, so
 * a clip second is ten real ones): the page is driven as a player drives it, by keys, while the frames are taken. */
function timeline(page: Page, steps: [number, () => Promise<unknown>][]): void {
  const t0 = Date.now();
  void (async () => {
    for (const [at, run] of steps) {
      const wait = t0 + at * 10_000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await run();
    }
  })().catch((e) => console.error(`clip timeline: ${e instanceof Error ? e.message : e}`));
}

/** Types as a player does in the clip: `perChar` seconds of clip time a letter. */
const typeIn = (page: Page, text: string, perChar = 0.045) => page.keyboard.type(text, { delay: perChar * 10_000 });
const key = (page: Page, k: string) => () => page.keyboard.press(k);

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
  // The sign-in and character screens (P1.E04.T05), each still on its step, each clip its motion. `login-error`: a wrong
  // password refused (the clip: back to the title, Play, the password retyped and refused again).
  'login-error': {
    clipSeconds: 2.6,
    expectedErrors: [REFUSED_SIGN_IN],
    async open(page) {
      await serveAccount(page, { refuseLogins: 99, delayMs: 300 });
      await titleReady(page);
      await signIn(page, 'not-my-password');
      await page.waitForSelector('.acct-msgwrap.on');
      await settleFlow(page);
    },
    async motion(page) {
      timeline(page, [
        [0.05, key(page, 'Escape')],
        [0.55, key(page, 'Enter')],
        [1.25, () => typeIn(page, 'still-wrong', 0.035)],
        [1.8, key(page, 'Enter')],
      ]);
    },
  },
  // `register`: a fresh account, its first username refused as taken, landed on its empty character list (a still of the
  // refusal too, 16x9-refused.png; the clip: the whole sign-up from the title, by keyboard but the one link)
  register: {
    clipSeconds: 6.2,
    expectedErrors: [REFUSED_SIGN_UP],
    async open(page) {
      await serveAccount(page, { characters: [], taken: ['tess_arlo'], delayMs: 3000 });
      await titleReady(page);
      await signUpAs(page, 'tess_arlo');
      await page.waitForSelector('.acct-msgwrap.on');
      await page.waitForTimeout(600);
      await page.keyboard.type('ilya_sarn');
      await page.keyboard.press('Tab');
      await page.keyboard.type('correct-horse');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.acct-step:not(.leaving) .acct-list [data-do="new"]');
      await settleFlow(page);
    },
    stills16x9: {
      async refused(page) {
        await resetFlow(page);
        await signUpAs(page, 'tess_arlo');
        await page.waitForSelector('.acct-msgwrap.on');
        await settleFlow(page);
      },
    },
    async motion(page) {
      // (the clip slows the page's animations tenfold already: the title has a while to come back before the first frame)
      await resetFlow(page, 7000);
      timeline(page, [
        [0.3, key(page, 'Enter')],
        [1.0, () => page.click('.acct [data-form="signin"] [data-do="to-register"]')],
        [1.6, () => typeIn(page, 'tess_arlo')],
        [2.1, key(page, 'Tab')],
        [2.2, () => typeIn(page, 'correct-horse', 0.03)],
        [2.7, key(page, 'Enter')],
        [3.6, () => typeIn(page, 'ilya_sarn')],
        [4.1, key(page, 'Tab')],
        [4.2, () => typeIn(page, 'correct-horse', 0.03)],
        [4.7, key(page, 'Enter')],
      ]);
    },
  },
  // `characters`: the account's three, one of each people (the clip: the list loading and rising in, the arrows walking it)
  characters: {
    clipSeconds: 2.6,
    async open(page) {
      await serveAccount(page, { delayMs: 300 });
      await titleReady(page);
      await signIn(page, 'correct-horse');
      await page.waitForSelector('.acct-char[data-id]');
      await settleFlow(page);
    },
    async motion(page) {
      timeline(page, [
        [0.05, key(page, 'Escape')],
        [0.55, key(page, 'Enter')],
        [1.7, key(page, 'ArrowDown')],
        [2.05, key(page, 'ArrowDown')],
      ]);
    },
  },
  // `characters-full`: an account at six of six, New character disabled (the clip: the picked row moving down two and
  // back one, its bar, indent and tint easing together)
  'characters-full': {
    clipSeconds: 1.6,
    async open(page) {
      await serveAccount(page, { characters: SIX });
      await titleReady(page);
      await signIn(page, 'correct-horse');
      await page.waitForSelector('.acct-step:not(.leaving) .acct-char[data-id]');
      await settleFlow(page);
    },
    async motion(page) {
      timeline(page, [
        [0.05, key(page, 'ArrowDown')],
        [0.5, key(page, 'ArrowDown')],
        [1.0, key(page, 'ArrowUp')],
      ]);
    },
  },
  // `create`: a new character named, the Ixari picked and opened on its body, home and saying (the clip: down to the
  // Ulgani and back)
  create: {
    clipSeconds: 1.6,
    async open(page) {
      await serveAccount(page);
      await titleReady(page);
      await signIn(page, 'correct-horse');
      await page.waitForSelector('.acct-char[data-id]');
      await page.waitForTimeout(800);
      await page.keyboard.press('n');
      await page.waitForSelector('.acct [data-form="create"] input[name="name"]');
      await page.waitForTimeout(400);
      await page.keyboard.type('Ilya Sarn');
      await page.keyboard.press('ArrowDown');
      await settleFlow(page);
    },
    async motion(page) {
      timeline(page, [
        [0.05, key(page, 'ArrowDown')],
        [0.8, key(page, 'ArrowUp')],
      ]);
    },
  },
  // `entering`: the character picked, the game socket open and the welcome not yet in (the clip: Esc back to the list,
  // and Enter again)
  entering: {
    clipSeconds: 1.8,
    async open(page) {
      await serveAccount(page);
      await titleReady(page);
      await signIn(page, 'correct-horse');
      await page.waitForSelector('.acct-char[data-id]');
      await page.waitForTimeout(800);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.acct-step[data-step="entering"]');
      await settleFlow(page);
    },
    async motion(page) {
      timeline(page, [
        [0.05, key(page, 'Escape')],
        [0.75, key(page, 'Enter')],
      ]);
    },
  },
  // `account-flow`: the whole of it by keyboard, the still the title it starts from; the clip: Play, a sign-in refused and
  // retried, the list, a new character named and its people picked, made, entered, and the welcome's cut into the world
  'account-flow': {
    clipSeconds: 13,
    expectedErrors: [REFUSED_SIGN_IN],
    sheetFrames: [
      0, 30, 60, 84, 108, 126, 138, 150, 174, 204, 228, 252, 276, 300, 330, 354, 378, 402, 432, 462, 492, 522, 546, 570, 596, 604, 612, 620, 628, 636, 644, 660,
      680, 700, 720, 750, 779,
    ],
    async open(page) {
      await serveAccount(page, { refuseLogins: 1, delayMs: 3000, welcomeAfterMs: 14_000 });
      await titleReady(page);
    },
    async motion(page) {
      timeline(page, [
        [0.3, key(page, 'Enter')],
        [0.9, () => typeIn(page, 'tess_arlo')],
        [1.4, key(page, 'Tab')],
        [1.5, () => typeIn(page, 'wrong-pass', 0.03)],
        [1.9, key(page, 'Enter')],
        [2.8, () => typeIn(page, 'correct-horse', 0.03)],
        [3.3, key(page, 'Enter')],
        [4.9, key(page, 'ArrowDown')],
        [5.2, key(page, 'ArrowDown')],
        [5.6, key(page, 'n')],
        [6.2, () => typeIn(page, 'Ilya Sarn')],
        [6.8, key(page, 'ArrowDown')],
        [7.5, key(page, 'Enter')],
        // (the mouse captured, as the player's click on Resume would: the clip arrives in the world itself)
        [8.4, () => grantLock(page)],
        [8.6, key(page, 'Enter')],
      ]);
    },
  },
  // `arrival`: a new Ixari character arrived, docked in its home Waystation's hangar. The stills: the pause menu that
  // entering leaves up (the mouse is captured only from a click), on its shade over the lit hangar; and 16x9-resumed.png,
  // the mouse captured, the world as the player then sees it, its arrival banner over the top band; 16x9-settled.png, the
  // banner gone, the top line on its own. The clip: that world going on (the hangar's traffic).
  arrival: {
    clipSeconds: 2,
    async open(page) {
      await serveAccount(page, { welcomeAfterMs: 400 });
      await titleReady(page);
      await signIn(page, 'correct-horse');
      await page.waitForSelector('.acct-step:not(.leaving) .acct-char[data-id]');
      await page.waitForTimeout(800);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForFunction(async () => {
        await (window as unknown as { step(n: number): Promise<void> }).step(2);
        return (window as unknown as { game: { mode: string } }).game.mode !== 'title';
      });
      await settle(page, 120);
      await page.waitForTimeout(1500);
    },
    stills16x9: {
      async resumed(page) {
        await grantLock(page);
        await settle(page, 60);
      },
      // the arrival banner gone (it and the band under it last 7 s): the top line on its own over the hangar's lights
      async settled(page) {
        await page.waitForTimeout(7500);
        await settle(page, 30);
      },
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
  // On foot on the home world, mining a plant or rock a few metres off with the beam held, its impact glare behind the
  // crosshair: the heat arc (left of the dot) at 40 of 100, 40% of it lit, warm
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
      await faceFlora(page);
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
  // On foot after mining, the beam let go at 30 heat: the arc cooling idle (20/s on the home world by day). The stills: 30,
  // warm, the button up. The clip: from 30 down to 2 (1.4 s, frame 84), where the empty arc fades out (0.4 s, to frame
  // 108), the crosshair's dot left alone.
  'hud-foot-cool': {
    hash: '#foot',
    hudClock: true,
    clipSeconds: 2,
    sheetFrames: [0, 12, 24, 36, 48, 60, 72, 78, 82, 84, 86, 88, 90, 93, 96, 99, 102, 105, 108, 119],
    async open(page) {
      await standingByShip(page);
      await parkLoop(page);
      // 31, and three frames idle at 20/s: 30
      await heatAt(page, 31, false, false);
      await settle(page, 3);
    },
    async motion(page) {
      await heatAt(page, 30, false, false);
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
  // the fabricators (P1.E13.T05, DESIGN 15.7): `fabricator` the Waystation's, at its terminal on the trade deck, with a
  // refusal shown (the oxygen cartridge, short of oxygen), a still of a recipe it can make (16x9-craftable.png), and the
  // clip of a warp cell crafted; `fabricator-learn` the same, and the clip of the torpedo recipe learned;
  // `fabricator-ship` the ship's own, landed on the home world: ammo and cartridges only (the warp cell listed as made at
  // a Waystation), and the clip of three crafts of flak ammo
  fabricator: {
    clipSeconds: 2,
    sheetFrames: FABRICATOR_SHEET,
    open: openStationFabricator,
    stills16x9: { craftable: (page) => fabClick(page, '.fab-row[data-recipe="warp_cell"]') },
    motion: fabricatorMotion('warp_cell'),
  },
  // the stepper at its limits (+ and MAX dimmed at the most the materials make, as − is at one) and a refusal on Enter
  'fabricator-limits': {
    clipSeconds: 2,
    sheetFrames: [0, 12, 21, 30, 39, 48, 57, 60, 62, 64, 66, 68, 70, 74, 80, 88, 96, 104, 112, 119],
    open: stationFabricator,
    motion: limitsMotion,
  },
  // the stepper at a maximum above one: the pulse fuel cell at 6 of 6 (+ and MAX dimmed, − lit), then −, + and + and
  // MAX pressed at the maximum
  'fabricator-limits-max': {
    clipSeconds: 1.2,
    sheetFrames: [0, 6, 11, 12, 13, 15, 20, 23, 24, 25, 27, 32, 35, 36, 37, 44, 47, 48, 49, 71],
    open: stepperAtSix,
    motion: stepperMotion,
  },
  // learning a recipe at the Waystation: LEARN on the torpedo recipe, and the row moving into the list
  'fabricator-learn': {
    clipSeconds: 1.2,
    sheetFrames: [0, 6, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 38, 44, 50, 58, 66, 71],
    open: stationFabricator,
    motion: learnMotion,
  },
  'fabricator-ship': {
    clipSeconds: 2,
    sheetFrames: FABRICATOR_SHEET,
    open: openShipFabricator,
    motion: fabricatorMotion(null),
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
