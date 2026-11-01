import { expect, test } from './harness.ts';

// Run only by harness.spec.ts, in a Playwright of its own: a page whose script never returns.
test.skip(!process.env.SMOKE_HARNESS_HANG, 'run by harness.spec.ts');
test.use({ closeGraceMs: Number(process.env.SMOKE_HARNESS_HANG_GRACE) || 15_000 });

test('a page that never answers', async ({ page }) => {
  test.setTimeout(6000);
  await page.goto('about:blank');
  await page.evaluate(() => {
    for (;;);
  });
});

test('the next test gets a working browser', async ({ page }) => {
  await page.goto('about:blank');
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
});
