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
    clipSeconds: 12.4,
    expectedErrors: [REFUSED_SIGN_IN],
    sheetFrames: [
      0, 30, 60, 84, 108, 126, 138, 150, 174, 204, 228, 252, 276, 300, 330, 354, 378, 402, 432, 462, 492, 522, 546, 570, 596, 604, 612, 620, 628, 640, 664, 688,
      712, 743,
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
        [8.6, key(page, 'Enter')],
      ]);
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
