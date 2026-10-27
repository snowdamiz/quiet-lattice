import { expect, test } from '@playwright/test';

// The asset review scene (P1.E14.T03, T11): `#review:ship` loads the demo ship, settles it under noon on the lush world
// and resolves `review.ready`; the ship draws triangles, LOD2 can be picked (the demo ship has no LOD nodes, so every
// level shows the whole model), the overlay labels the ship's Gear* pivots, the far view puts the camera 100 m off, a
// short paired perf readout comes back with its spread, and nothing logs an error on the way.
interface ReviewHandle {
  ready: Promise<unknown>;
  case: string | null;
  stats(): { triangles: number; meshes: number; lod: number; colliders: number; kinds: Record<string, number> };
  lod(n: number): { triangles: number; lod: number };
  overlay(on: boolean): void;
  captureOverlay(): Promise<string>;
  lastOverlay: { counts: Record<string, number>; labelled: string[] };
  far(meters: number, opts?: { lod?: number; frames?: number }): Promise<{ range: number; lod: number; clear: boolean }>;
  near(): Promise<void>;
  eyeLocal: { distanceTo(v: unknown): number };
  targetLocal: unknown;
  perf(opts: { pairs: number; maxPairs: number; maxWarmup: number }): Promise<{
    asset: { gpuMs: number | null; pairs: number; blocks: number; gpuMsIqr: number[] | null; reliable: boolean; unpaired: unknown };
    scene: { gpuMsMedian: number | null };
    withoutAsset: { gpuMsMedian: number | null };
  }>;
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
  // the demo ship's three landing-gear pivots, and nothing else of the overlay's kinds
  expect(before.stats.kinds).toEqual({ Gear: 3 });

  const lod2 = await page.evaluate(() => (window as unknown as { review: ReviewHandle }).review.lod(2));
  expect(lod2.lod).toBe(2);
  expect(lod2.triangles).toBeGreaterThan(0);

  const overlay = await page.evaluate(async () => {
    const r = (window as unknown as { review: ReviewHandle }).review;
    r.lod(0);
    const plain = r.stats().triangles;
    r.overlay(true);
    const png = await r.captureOverlay();
    // (the overlay's own volumes and gizmos are not the asset's)
    const withOverlay = r.stats().triangles;
    r.overlay(false);
    return { png: png.slice(0, 22), size: png.length, info: r.lastOverlay, plain, withOverlay };
  });
  expect(overlay.png).toBe('data:image/png;base64,');
  expect(overlay.size).toBeGreaterThan(10_000);
  expect(overlay.info.counts).toEqual({ Gear: 3 });
  expect(overlay.info.labelled.sort()).toEqual(['GearFront', 'GearLeft', 'GearRight']);
  expect(overlay.withOverlay).toBe(overlay.plain);

  const far = await page.evaluate(async () => {
    const r = (window as unknown as { review: ReviewHandle }).review;
    const rec = await r.far(100, { lod: 2, frames: 30 });
    const d = r.eyeLocal.distanceTo(r.targetLocal);
    await r.near();
    return { rec, d, back: r.eyeLocal.distanceTo(r.targetLocal) };
  });
  expect(far.rec).toMatchObject({ range: 100, lod: 2, clear: true });
  expect(far.d).toBeCloseTo(100, 3);
  expect(far.back).toBeLessThan(40);

  const perf = await page.evaluate(() => (window as unknown as { review: ReviewHandle }).review.perf({ pairs: 24, maxPairs: 24, maxWarmup: 20 }));
  expect(perf.asset.pairs).toBeGreaterThan(0);
  expect(perf.asset.blocks).toBeGreaterThan(0);
  expect(perf.asset.gpuMs).not.toBeNull();
  expect(perf.asset.gpuMsIqr).toHaveLength(2);
  expect(typeof perf.asset.reliable).toBe('boolean');
  expect(perf.scene.gpuMsMedian).not.toBeNull();
  expect(perf.withoutAsset.gpuMsMedian).not.toBeNull();

  expect(errors, errors.join('\n')).toEqual([]);
});
