import { expect, test, type Page } from '@playwright/test';
import { darkAt, edgeAt, seasonOpening } from '@astra/shared/seasons';
import { EDGE_WALL_LY_PER_LY, EDGE_X, galaxyTiers, wallX } from '@astra/shared/world';

// The Edge follows the Count (P2.E22.T02) in the running client: handed the `world` message the server sends for each of
// three Counts, the galaxy map's wall and the sky's wall stand where that Edge puts them, with nothing logged.

const OPENING = seasonOpening(null, 1);
const worldAt = (count: number, opening = OPENING) => {
  const edgeX = edgeAt(count, opening);
  return {
    t: 'world',
    season: 1,
    seasonStart: 0,
    seasonEnd: 4_838_400,
    opening,
    count,
    edgeX,
    tiers: galaxyTiers(edgeX).map((t) => t.tier),
    dark: [...darkAt(count, opening)],
    serverTime: 1000,
  };
};

/** Hands the page the `world` message the server would send, on the client's own Net, never connected (the game reads it from there). */
async function handWorld(page: Page, world: unknown): Promise<void> {
  await page.evaluate(async (world) => {
    const g = window.game;
    if (!g.net) {
      const module = '/src/net/Net.js';
      const { Net } = await import(/* @vite-ignore */ module);
      g.net = new Net({ url: 'ws://offline.invalid/', token: '', characterId: '' });
    }
    g.net.world = world;
  }, world);
}

test('the galaxy map and the sky draw the Edge where the Count puts it, at three Counts', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    await window.dev.boot();
    window.game.menus.openMap();
    window.game.menus.setMapTab('galaxy');
    await window.step(30);
  });

  const seen: { count: number; edge: number; mapWall: number; skyWall: number; mapFocus: number; skyAt: number }[] = [];
  for (const count of [0, 500, 1000]) {
    await handWorld(page, worldAt(count));
    seen.push({
      count,
      ...(await page.evaluate(async () => {
        const g = window.game;
        await window.step(40);
        const wall = (edge: { group: { traverse(f: (o: { material?: { uniforms?: { uShift?: { value: number } } } }) => void): void } }) => {
          let shift: number | undefined;
          edge.group.traverse((o) => (shift ??= o.material?.uniforms?.uShift?.value));
          return shift as number;
        };
        const map = g.menus.mapView.current;
        return {
          edge: g.edge as number,
          mapWall: wall(map.edge),
          skyWall: wall(g.sky.edge),
          mapFocus: map.edgeItem.focusTarget.x as number,
          skyAt: g.sky.edgeAt as number,
        };
      })),
    });
  }

  for (const s of seen) {
    const edge = edgeAt(s.count, OPENING);
    expect(s.edge).toBe(edge);
    expect(s.mapWall).toBe(wallX(edge) - EDGE_X);
    expect(s.skyWall).toBe(wallX(edge) - EDGE_X);
    expect(s.skyAt).toBe(edge);
    expect(s.mapFocus).toBe(wallX(edge) - 1e4);
  }
  // the lowest Count has the wall nearest, the highest furthest, 20 ly of Edge apart and so far apart on the map
  expect(seen[0]!.mapWall).toBe(-10 * EDGE_WALL_LY_PER_LY);
  expect(seen[1]!.mapWall).toBe(0);
  expect(seen[2]!.mapWall).toBe(10 * EDGE_WALL_LY_PER_LY);
  expect(errors).toEqual([]);
});

test('the galaxy map marks the dark Waystations the server names, and says so for the system selected, after frames have run', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    await window.dev.boot();
    window.game.menus.openMap();
    window.game.menus.setMapTab('galaxy');
    await window.step(30);
  });

  const broken = seasonOpening('broken', 1);
  const seen: { count: number; marks: number; rows: string[][]; night: unknown }[] = [];
  for (const count of [0, 500, 1000]) {
    await handWorld(page, worldAt(count, broken));
    seen.push({
      count,
      ...(await page.evaluate(async (id) => {
        const g = window.game;
        await window.step(20);
        const map = g.menus.mapView.current;
        const it = map.items.find((i: { sys?: { id: number } }) => i.sys?.id === id);
        return { marks: map.darkMarks.children.length as number, rows: map.describe(it).stats as string[][], night: typeof g.isDark };
      }, broken.dark[0]!)),
    });
  }

  for (const s of seen) {
    const dark = darkAt(s.count, broken);
    expect(s.marks).toBe(dark.length * 2);
    expect(s.rows.some(([k, v]) => k === 'Waystation' && v === 'Dark')).toBe(dark.includes(broken.dark[0]!));
    // (the per-frame night flag stays a boolean the station query does not touch)
    expect(s.night).toBe('boolean');
  }
  expect(seen.map((s) => s.marks > 0)).toEqual([true, true, false]);
  expect(seen[0]!.marks).toBeGreaterThan(seen[1]!.marks);
  expect(errors).toEqual([]);
});
