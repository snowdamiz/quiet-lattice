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

/**
 * The chat and party UI's stage (P1.E15.T03), as page source (tsx would wrap functions written here in helpers the page
 * does not have): the client's own Net, beacon list and social UI, fed recorded server messages through a socket the
 * page plays the server for, in the offline sandbox, so the captures are hermetic. The socket answers requests as the
 * server would: chat comes back as the player's line, an invite to someone online is sent, accepting joins the
 * inviter's party, an answer to a beacon is refused (`answerCode`). `window.__social` drives it.
 */
export const SOCIAL_STAGE = String.raw`
import { Net } from '/src/net/Net.js';

const game = window.game;
const sockets = [];
const ME = 'Tess Arlo';
const ONLINE = ['Kestrel Vane', 'Bo Tran', 'Ilse Marr', 'Juno Reyes'];
const T0 = 5000;
const later = (fn) => setTimeout(fn, 0);

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    sockets.push(this);
    later(() => {
      this.readyState = 1;
      if (this.onopen) this.onopen();
    });
  }
  send(text) {
    const m = JSON.parse(text);
    this.sent.push(m);
    later(() => stage.reply(m));
  }
  close() {
    this.readyState = 3;
  }
}

const stage = {
  net: null,
  socket: null,
  party: null,
  beacons: [],
  answerCode: 'far',
  raiseCode: 'no_phase',
  get social() {
    return game.hud.social;
  },
  get here() {
    return game.galaxy.current.id;
  },
  async start() {
    const net = new Net({ url: 'ws://capture/ws', token: 'capture', characterId: 'c-me', WebSocket: FakeSocket });
    this.net = net;
    this.social.attach(net);
    net.connect();
    await new Promise((r) => setTimeout(r, 30));
    this.socket = sockets[sockets.length - 1];
    const look = { palette: 0, pattern: 0, head: 0, suit: 0 };
    this.push({
      t: 'welcome',
      accountId: 'a-me',
      character: { id: 'c-me', name: ME, people: 'thalune', look, level: 7, homeSystem: this.here },
      entityId: 1,
      serverTime: T0,
      zone: { id: 'sys:' + this.here, systemSeed: game.system.seed },
      pose: { frame: null, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] },
      mode: 'ship',
    });
    this.clear();
  },
  push(m) {
    this.socket.onmessage({ data: JSON.stringify(m) });
  },
  /** Forgets the log. */
  clear() {
    const m = this.social.model;
    m.lines.length = 0;
    this.social.rebuild = true;
    m.changed();
  },
  /** Moves every line in the log, and every invite, ms milliseconds into the past. */
  age(ms) {
    const m = this.social.model;
    for (const l of m.lines) l.at -= ms;
    for (const i of m.invites) {
      i.at -= ms;
      i.until -= ms;
    }
    this.social.rebuild = true;
    this.social.model.changed();
  },
  chat(channel, from, text) {
    this.push({ t: 'event', event: { kind: 'chat', channel, from, text, at: T0 } });
  },
  news(what, name) {
    this.push({ t: 'event', event: name ? { kind: 'party', what, name } : { kind: 'party', what } });
  },
  member(name, health = 10, system = this.here, online = true) {
    return { name, online, system: online ? system : null, health: online ? health : null };
  },
  setParty(leader, members) {
    this.party = members ? { leader, members } : null;
    this.push({ t: 'party', party: this.party });
  },
  open(tab) {
    this.social.open();
    if (tab) this.social.setTab(tab);
  },
  close() {
    this.social.close();
  },
  /** Types a line into the open panel and presses Enter in it. */
  type(text) {
    const input = this.social.input;
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  },
  /** The server's side of each request. */
  reply(m) {
    if (m.t === 'chat') return this.chat(m.channel, ME, m.text);
    if (m.t === 'party') {
      const op = m.op;
      const named = op.name && ONLINE.find((n) => n.toLowerCase() === op.name.toLowerCase());
      if (op.op === 'invite') return named ? this.news('invited', named) : this.push({ t: 'denied', of: 'invite', code: 'not_found', name: op.name });
      if (op.op === 'accept') {
        this.setParty(named, [this.member(named), this.member(ME), this.member('Bo Tran', 8)]);
        return this.news('joined', ME);
      }
      if (op.op === 'leave') {
        this.setParty(null);
        return this.news('left', ME);
      }
      if (op.op === 'promote' && this.party) {
        this.news('leader', named);
        return this.setParty(named, this.party.members);
      }
      if (op.op === 'kick' && this.party) {
        this.news('kicked', named);
        return this.setParty(this.party.leader, this.party.members.filter((x) => x.name !== named));
      }
      return;
    }
    if (m.t === 'beacon') {
      if (m.op.op === 'answer') return this.push({ t: 'denied', of: 'answer', code: this.answerCode });
      if (m.op.op === 'raise') return this.push({ t: 'denied', of: 'raise', code: this.raiseCode });
      if (m.op.op === 'watch') return this.push({ t: 'beacons', reset: true, beacons: this.beacons, gone: [] });
    }
  },

  // ---------- scenes ----------

  /** Several lines in each channel, the newest last. */
  chatScene() {
    const sys = game.system.name;
    this.chat('shard', 'Kestrel Vane', 'Convoy leaving ' + sys + ' in ten minutes, two escorts wanted');
    this.chat('system', 'Ilse Marr', 'Pirate wing over the north pole, keep clear of it');
    this.chat('shard', 'Juno Reyes', 'Saw a Hollow drifter past the third moon. Nobody aboard.');
    this.chat('party', 'Kestrel Vane', 'Regroup at pad three when you can');
    this.chat('system', 'Bo Tran', 'Waystation traffic is heavy tonight');
    this.chat('shard', 'Bo Tran', 'Anyone selling cobalt near the belt?');
    this.chat('party', 'Bo Tran', 'Hull at thirty percent, give me a minute');
    this.chat('system', 'Juno Reyes', 'Storm front rolling over the southern sea');
    this.chat('shard', ME, 'Heading for the Waystation now');
    this.chat('party', ME, 'Covering you, take your time');
    this.chat('shard', 'Ilse Marr', 'Selling frostglass at the ' + sys + ' board, fair prices');
    this.chat('system', 'Kestrel Vane', 'Docking queue at the Waystation is clear again');
    this.chat('party', 'Ilse Marr', 'Two jumps out, back within the hour');
  },
  /** Four in the party: the leader, the player, one hurt badly, one in another system. */
  partyScene(leader = 'Kestrel Vane') {
    const elsewhere = game.galaxy.systems.find((s) => s.id !== this.here).id;
    this.setParty(leader, [this.member('Kestrel Vane'), this.member(ME), this.member('Bo Tran', 2), this.member('Ilse Marr', 7, elsewhere)]);
  },
  /** Eight calls for aid, more than the panel shows: the three, and five more here and elsewhere. */
  manyBeaconsScene() {
    this.beaconsScene();
    const seed = game.system.seed;
    const others = game.galaxy.systems.filter((s) => s.id !== this.here).slice(0, 3).map((s) => s.id);
    const b = (id, kind, place, from, open, cap, ago, system, frame) =>
      ({ id, kind, system, frame, center: [0, 0, 0], radius: 600, place, from, open, cap, at: T0 - ago, until: T0 - ago + 600 });
    this.beacons = this.beacons.concat([
      b(15, 'event', 'Pirate Convoy Ambush', 'Juno Reyes', 9, 12, 75, this.here, seed + ':station'),
      b(16, 'story', 'Signal in the Static', 'Kestrel Vane', 5, 6, 210, others[0], seed + ':0'),
      b(17, 'raid', 'The Hive Heart', 'Ilse Marr', 6, 12, 300, others[1], seed + ':0'),
      b(18, 'event', 'Stone-touched Herd', 'Bo Tran', 10, 12, 450, others[2], seed + ':0'),
      b(19, 'story', 'Adrift', 'Juno Reyes', 3, 6, 520, this.here, seed + ':station'),
    ]);
    this.push({ t: 'beacons', reset: true, beacons: this.beacons, gone: [] });
  },
  /** Three calls for aid: a raid at the Waystation and a story chapter in this system, an event in another. */
  beaconsScene() {
    const seed = game.system.seed;
    const elsewhere = game.galaxy.systems.find((s) => s.id !== this.here).id;
    // (the story chapter on the ground below the ship, the raid round the Waystation)
    const home = game.system.homePlanet;
    const st = game.ship.state;
    const below = st.frame === home ? st.pos.clone().normalize().multiplyScalar(home.radius).toArray() : [0, 0, 0];
    const b = (id, kind, place, from, open, cap, ago, extra) =>
      Object.assign({ id, kind, system: this.here, frame: seed + ':station', center: [0, 0, 0], radius: 400, place, from, open, cap, at: T0 - ago, until: T0 - ago + 600 }, extra);
    this.beacons = [
      b(12, 'raid', 'Raid on the Waystation', 'Kestrel Vane', 3, 12, 130, {}),
      b(13, 'story', 'The Missing', 'Ilse Marr', 4, 6, 380, { frame: seed + ':' + game.system.planets.indexOf(home), center: below, radius: 2000 }),
      b(14, 'event', 'Ferrite Wreck', 'Bo Tran', 7, 12, 40, { system: elsewhere }),
    ];
    this.push({ t: 'beacons', reset: true, beacons: this.beacons, gone: [] });
  },
};
window.__social = stage;
`;

/** What the captures reach of the stage. */
interface SocialStage {
  start(): Promise<void>;
  clear(): void;
  age(ms: number): void;
  chat(channel: string, from: string, text: string): void;
  news(what: string, name?: string): void;
  setParty(leader: string | null, members?: unknown[]): void;
  open(tab?: string): void;
  close(): void;
  type(text: string): void;
  chatScene(): void;
  partyScene(leader?: string): void;
  beaconsScene(): void;
  answerCode: string;
  social: { model: { answer(id: number): void; submit(text: string): unknown; mutedUntil: number }; update(): void };
}
interface Vec {
  clone(): Vec;
  set(x: number, y: number, z: number): Vec;
}
interface Quat {
  clone(): Quat;
  multiply(q: Quat): Quat;
  setFromAxisAngle(axis: Vec, angle: number): Quat;
}
interface SocialWindow {
  __social: SocialStage;
  dev: { boot(): Promise<void> };
  game: {
    system: { homePlanet: unknown };
    debugGoto(planet: unknown, o: object): void;
    ship: { state: { pos: Vec; quat: Quat } };
    hud: { later(fn: () => void, ms: number): number; clearBanners(): void };
  };
}

/** Boots the sandbox, puts the camera where `view` says (`limb`: low over the sunlit home world, the bright ground behind
 * the chat panel; `space`: the default start by the Waystation, dark sky behind the panel), and starts the stage. */
async function stageSocial(page: Page, view: 'limb' | 'space'): Promise<void> {
  await page.evaluate(() => (window as unknown as SocialWindow).dev.boot());
  // (no named functions in the page code: tsx would wrap them in a helper the page does not have)
  await page.evaluate((view) => {
    const g = (window as unknown as SocialWindow).game;
    const p = g.system.homePlanet as { radius: number };
    // limb: 0.2 radii up in the morning sun, nose down 24°, so the sunlit disc fills the lower half and its limb crosses
    // the picture above the chat panel; space: the start by the Waystation, nose up 43° to the dark sky
    if (view === 'limb') g.debugGoto(p, { sunAngle: 35, alt: p.radius * 0.2, azimuth: 40, land: false });
    const s = g.ship.state;
    s.quat.multiply(s.quat.clone().setFromAxisAngle(s.pos.clone().set(1, 0, 0), view === 'limb' ? -0.42 : 0.75));
  }, view);
  await settle(page, 120);
  await page.evaluate(() => (window as unknown as SocialWindow).game.hud.clearBanners());
  await page.addScriptTag({ type: 'module', content: SOCIAL_STAGE });
  await page.waitForFunction(() => !!(window as unknown as SocialWindow).__social);
  await page.evaluate(() => (window as unknown as SocialWindow).__social.start());
}

/** Runs `fn` on the stage in the page and lets the HUD draw it. */
async function onStage(page: Page, fn: string, frames = 30): Promise<void> {
  await page.evaluate(`(async () => { const s = window.__social; ${fn}; })()`);
  await settle(page, frames);
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
  // chat and party (P1.E15.T03), low over the sunlit home world: the panel open on the shard tab with several lines in
  // each channel and the party frame above it; stills of the system and party tabs, and of refusals (the server's, an
  // invite to no one online; the panel's own, a line typed faster than the server would take it, kept in the input).
  // The clip: new lines rising into the closed feed, the panel opening and closing on a line sent, and the lines fading
  // out of the way (each ten seconds after it came, those the panel showed four seconds after it closed).
  social: {
    hudClock: true,
    clipSeconds: 14,
    sheetFrames: [0, 18, 24, 54, 60, 90, 96, 102, 108, 138, 144, 150, 156, 380, 400, 420, 620, 680, 740, 790, 839],
    async open(page) {
      await stageSocial(page, 'limb');
      await onStage(page, "s.partyScene(); s.chatScene(); s.open('shard')", 60);
    },
    stills16x9: {
      system: (page) => onStage(page, "s.social.setTab('system')"),
      party: (page) => onStage(page, "s.social.setTab('party')"),
      refusal: (page) =>
        onStage(
          page,
          "s.social.setTab('shard'); s.social.model.submit('/invite Nobody Here'); s.social.model.pace.level = 0; s.type('Anyone up for the raid?')",
          60,
        ),
      // muted by the server for a flood (75 s, so the hint reads a minute), a line typed anyway held in the input; and the
      // party with a member whose connection is down
      muted: (page) =>
        onStage(
          page,
          "s.setParty('Kestrel Vane', [s.member('Kestrel Vane'), s.member('Tess Arlo'), s.member('Bo Tran', 2), s.member('Juno Reyes', 10, s.here, false)]); " +
            "s.social.model.pace.level = 5; s.push({ t: 'denied', of: 'chat', code: 'muted', retryS: 75 }); s.type('Anyone up for the raid?')",
          60,
        ),
    },
    async motion(page) {
      // the panel the stills left open closes, the stills' mute is lifted and the four of the party are back, and the
      // feed holds three lines from six seconds ago; all of it drawn now, so its fades run out before the first frame
      await page.evaluate(() => {
        const s = (window as unknown as SocialWindow).__social;
        s.social.model.mutedUntil = 0;
        s.close();
        s.partyScene();
        s.clear();
        s.chat('shard', 'Kestrel Vane', 'Convoy leaving in ten minutes, two escorts wanted');
        s.chat('system', 'Ilse Marr', 'Pirate wing over the north pole, keep clear of it');
        s.chat('party', 'Bo Tran', 'Hull at thirty percent, give me a minute');
        s.age(6000);
        s.social.update();
      });
      await page.waitForTimeout(3000);
      await page.evaluate(() => {
        const w = window as unknown as SocialWindow;
        const s = w.__social;
        const hud = w.game.hud;
        hud.later(() => s.chat('shard', 'Juno Reyes', 'Saw a Hollow drifter past the third moon'), 300);
        hud.later(() => s.chat('party', 'Kestrel Vane', 'Regroup at pad three'), 900);
        hud.later(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true })), 1500);
        hud.later(() => s.type('On my way'), 2300);
      });
    },
  },
  // the same panel over open space by the Waystation, closed: the feed's lines on their plates against the dark
  'social-space': {
    hudClock: true,
    async open(page) {
      await stageSocial(page, 'space');
      await onStage(page, "s.partyScene(); s.chatScene(); s.open('shard')", 60);
    },
    stills16x9: {
      party: (page) => onStage(page, "s.social.setTab('party')"),
      closed: (page) => onStage(page, 's.close()', 60),
    },
  },
  // the party frame: four members, the leader marked, one badly hurt, one in another system; the panel open on the party
  // tab (invite and leave under the frame); stills with the player leading (promote and remove on each member) and closed
  party: {
    hudClock: true,
    async open(page) {
      await stageSocial(page, 'limb');
      await onStage(page, "s.partyScene(); s.chatScene(); s.open('party')", 60);
    },
    stills16x9: {
      leader: (page) => onStage(page, "s.partyScene('Tess Arlo')"),
      closed: (page) => onStage(page, 's.partyScene(); s.close()', 60),
    },
  },
  // an invite waiting, the panel closed (Enter to answer), its minute running down; a still with the panel open; the
  // clip: the panel opens, Accept, the party frame rises in where the card was, the panel closes
  'party-invite': {
    hudClock: true,
    clipSeconds: 3.5,
    sheetFrames: [0, 6, 12, 18, 24, 30, 36, 60, 84, 90, 96, 102, 108, 114, 120, 144, 150, 156, 162, 180, 209],
    async open(page) {
      await stageSocial(page, 'limb');
      await onStage(page, "s.chatScene(); s.news('invite', 'Kestrel Vane'); s.age(8000)", 60);
    },
    stills16x9: {
      open: (page) => onStage(page, "s.open('shard')"),
    },
    async motion(page) {
      // (closed, and drawn closed, before the first frame)
      await page.evaluate(() => {
        const s = (window as unknown as SocialWindow).__social;
        s.close();
        s.social.update();
      });
      await page.waitForTimeout(3000);
      await page.evaluate(() => {
        const w = window as unknown as SocialWindow;
        const s = w.__social;
        const hud = w.game.hud;
        hud.later(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true })), 400);
        hud.later(() => document.querySelector<HTMLButtonElement>('.sp-invite .btn')?.click(), 1400);
        hud.later(() => s.close(), 2500);
      });
    },
  },
  // the call-for-aid list: three beacons (a raid at the Waystation and a story chapter here, an event in another system)
  // with an answer refused (too far from the raid's place); stills with a raise refused (in no instance) and with the
  // player's own beacon up; the clip: an answer refused, its reason rising in under the beacon
  beacons: {
    hudClock: true,
    clipSeconds: 1.5,
    showScrollbars: true,
    async open(page) {
      await stageSocial(page, 'limb');
      await onStage(page, "s.chatScene(); s.beaconsScene(); s.open('beacons'); s.social.model.answer(12)", 60);
    },
    stills16x9: {
      'raise-refused': (page) => onStage(page, 's.social.model.raise()'),
      own: (page) =>
        onStage(
          page,
          "const b = Object.assign({}, s.beacons[1], { id: 20, from: 'Tess Arlo', open: 2, cap: 6 }); s.push({ t: 'beacon', op: 'raised', id: 20, beacon: b })",
        ),
    },
    async motion(page) {
      await page.evaluate(() => {
        const w = window as unknown as SocialWindow;
        const s = w.__social;
        // (the event is in another star system)
        s.answerCode = 'elsewhere';
        w.game.hud.later(() => s.social.model.answer(14), 300);
      });
    },
  },
  // a list longer than the panel: eight calls for aid, one answer refused (too far) in view; the list fades at its foot
  // over its scrollbar. The clip scrolls it to its end and back, eased (the list's own scroll, as a wheel would)
  'beacons-many': {
    hudClock: true,
    clipSeconds: 3,
    showScrollbars: true,
    async open(page) {
      await stageSocial(page, 'limb');
      await onStage(page, "s.chatScene(); s.manyBeaconsScene(); s.open('beacons'); s.social.model.answer(15)", 60);
    },
    async motion(page) {
      await page.evaluate(() => {
        const w = window as unknown as SocialWindow;
        const list = document.querySelector('.sc-beacons') as HTMLElement;
        const end = list.scrollHeight - list.clientHeight;
        // down over a second from 0.3 s, a pause, and back up over a second (ease in and out, a step a frame)
        for (let k = 0; k <= 60; k++) {
          const t = k / 60;
          const y = end * (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
          w.game.hud.later(() => (list.scrollTop = y), 300 + k * (1000 / 60));
          w.game.hud.later(() => (list.scrollTop = end - y), 1700 + k * (1000 / 60));
        }
      });
    },
  },
};
