import { expect, test } from '@playwright/test';

// The asset review scene (P1.E14.T03): `#review:ship` loads the demo ship, settles it under noon on the lush world and
// resolves `review.ready`; the ship draws triangles, LOD2 can be picked (the demo ship has no LOD nodes, so every level
// shows the whole model), and nothing logs an error on the way.
interface ReviewHandle {
  ready: Promise<unknown>;
  case: string | null;
  stats(): { triangles: number; meshes: number; lod: number; colliders: number };
  lod(n: number): { triangles: number; lod: number };
}
// (page.evaluate sends each function's source to the page, so every one reaches window.review itself)

test('review scene loads an asset and switches LOD', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/#review:ship');
  await page.waitForFunction(() => !!(window as unknown as { review?: ReviewHandle }).review?.ready, null, { timeout: 120_000 });
  await page.evaluate(() => (window as unknown as { review: ReviewHandle }).review.ready);

  const before = await page.evaluate(() => {
    const r = (window as unknown as { review: ReviewHandle }).review;
    return { case: r.case, stats: r.stats() };
  });
  expect(before.case).toBe('noon-lush');
  expect(before.stats.triangles).toBeGreaterThan(0);
  expect(before.stats.meshes).toBeGreaterThan(0);

  const lod2 = await page.evaluate(() => (window as unknown as { review: ReviewHandle }).review.lod(2));
  expect(lod2.lod).toBe(2);
  expect(lod2.triangles).toBeGreaterThan(0);

  expect(errors, errors.join('\n')).toEqual([]);
});
