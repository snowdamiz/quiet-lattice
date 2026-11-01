import { expect, test } from '@playwright/test';
import { edgeAt, seasonOpening } from '@astra/shared/seasons';
import { EDGE_WALL_LY_PER_LY, EDGE_X, galaxyTiers, wallX } from '@astra/shared/world';

// The Edge follows the Count (P2.E22.T02) in the running client: handed the `world` message the server sends for each of
// three Counts, the galaxy map's wall and the sky's wall stand where that Edge puts them, with nothing logged.

const OPENING = seasonOpening(null, 1);
const worldAt = (count: number) => {
  const opening = OPENING;
  const edgeX = edgeAt(count, opening);
  return { t: 'world', season: 1, seasonStart: 0, seasonEnd: 4_838_400, opening, count, edgeX, tiers: galaxyTiers(edgeX).map((t) => t.tier), serverTime: 1000 };
};

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
    const world = worldAt(count);
    seen.push({
      count,
      ...(await page.evaluate(async (world) => {
        const g = window.game;
        g.world = world;
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
      }, world)),
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
