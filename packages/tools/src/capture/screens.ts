// The UI screens `pnpm capture -- --ui <screen>` knows how to reach. Each later UI task adds its screen here, so the
// grader always gets its 16:9 and 21:9 captures and a 60 fps clip the same way.
import type { Page } from '@playwright/test';

export interface ScreenDef {
  /** dev scenario hash to open the client with */
  hash?: string;
  /** drive the page to the screen and let it settle */
  open(page: Page): Promise<void>;
  /**
   * Start the motion the clip should show (a panel opening, a hover, a toast), right before the 60 frames are taken.
   * Without it the clip shows one second of the settled screen.
   */
  motion?(page: Page): Promise<void>;
}

/** Steps the game by hand, then waits out the HUD's CSS transitions (they run on real time, not game time). */
const settle = async (page: Page, frames = 60) => {
  await page.evaluate((n) => (window as unknown as { step(n: number): Promise<void> }).step(n), frames);
  await page.waitForTimeout(1200);
};

interface InventoryApi {
  add(id: string, n: number, to?: 'auto' | 'suit' | 'cargo'): number;
  setLoadout(l: { hull: string | null; nodes?: string[] }): boolean;
}

/** Boots a game, loads the suit and the cargo with a mining trip's haul, opens the inventory and hovers a full stack. */
async function openInventory(page: Page, hull: 'lark' | 'mule'): Promise<void> {
  await page.evaluate(() => (window as unknown as { dev: { boot(): Promise<void> } }).dev.boot());
  await page.evaluate((hull) => {
    const g = (window as unknown as { game: { inventory: InventoryApi; menus: { openInventory(): void } } }).game;
    const inv = g.inventory;
    inv.setLoadout({ hull });
    const suit: [string, number][] = [
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
    for (const [id, n] of suit) inv.add(id, n, 'suit');
    const cargo: [string, number][] =
      hull === 'lark'
        ? [
            ['tritium', 9999],
            ['gold', 140],
            ['cobalt', 75],
            ['mining_laser', 1],
          ]
        : [
            ['tritium', 9999 * 3 + 4120],
            ['gold', 640],
            ['cobalt', 375],
            ['copper', 1210],
            ['ferrite', 9999 + 2760],
            ['carbon', 4400],
            ['mining_laser', 1],
            ['flak_ammo', 300],
          ];
    for (const [id, n] of cargo) inv.add(id, n, 'cargo');
    g.menus.openInventory();
  }, hull);
  await settle(page, 60);
  // hover the full ferrite stack: the detail line names it, its count against the cap, and where it comes from
  const slot = page.locator('.inv-slot[data-c="suit"][data-i="1"]');
  const box = await slot.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
}

/**
 * The inventory's motion for the clip: the panel opens again (its 0.3 s ease-in), then, 0.36 s of animation time later,
 * a click sends the carbon stack across to the cargo through the screen's own pointer handlers, and both slots it touched
 * settle back from amber (0.7 s). Page timers run on real time while the clip slows CSS tenfold, hence 3600 ms.
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
    }, 3600);
  });
}

export const SCREENS: Record<string, ScreenDef> = {
  title: {
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
    async open(page) {
      await page.evaluate(() => (window as unknown as { dev: { boot(): Promise<void> } }).dev.boot());
      await settle(page, 120);
    },
  },
  'hud-foot': {
    hash: '#foot',
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
  // the inventory (P1.E06.T04): suit stacks beside the ship's cargo pods, after a mining trip, one stack hovered so the
  // detail line shows what it is. `inventory` is the Lark every pilot starts in (one pod); `inventory-hauler` a Mule's four.
  inventory: {
    async open(page) {
      await openInventory(page, 'lark');
    },
    motion: inventoryMotion,
  },
  'inventory-hauler': {
    async open(page) {
      await openInventory(page, 'mule');
    },
    motion: inventoryMotion,
  },
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
