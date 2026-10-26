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
