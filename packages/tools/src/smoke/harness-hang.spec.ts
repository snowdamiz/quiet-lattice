import { expect, test } from './harness.ts';

// Run only by harness.spec.ts, in a Playwright of its own: a page whose script never returns.
test.skip(!process.env.SMOKE_HARNESS_HANG, 'run by harness.spec.ts');
test.use({ closeGraceMs: Number(process.env.SMOKE_HARNESS_HANG_GRACE ?? 15_000) });

test.afterEach(async ({ page }) => {
  // Online smoke closes its game connection through the page in afterEach too.
  if (process.env.SMOKE_HARNESS_HANG_CLEANUP) await page.evaluate(() => 1).catch(() => {});
});

test('a page that never answers', async ({ page }) => {
  test.setTimeout(6000);
  await page.goto('about:blank');
  console.log(`HANG_STARTED=${Date.now()}`);
  await page.evaluate(() => {
    for (;;);
  });
});

test('the next test gets a working browser', async ({ page }) => {
  await page.goto('about:blank');
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
  console.log(`HANG_RECOVERED=${Date.now()}`);
});
