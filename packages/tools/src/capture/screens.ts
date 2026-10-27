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
  'hud-ship': {
    hudClock: true,
    async open(page) {
      await page.evaluate(() => (window as unknown as { dev: { boot(): Promise<void> } }).dev.boot());
      await settle(page, 120);
    },
  },
  'hud-foot': {
    hash: '#foot',
    hudClock: true,
    async open(page) {
      await page.waitForFunction(async () => {
        await (window as unknown as { step(n: number): Promise<void> }).step(4);
        return (window as unknown as { game: { mode: string } }).game.mode === 'foot';
      });
      await settle(page, 90);
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
