import { expect, test } from '@playwright/test';

// The client boots, starts a game, runs 180 frames and draws something that is not black, with no console errors.
test('client boots and renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    await window.dev.boot();
    await window.step(180);
  });

  const luminance = await page.evaluate(() => {
    // render one frame and read it back in the same task, before the drawing buffer is cleared
    window.game.frame(1 / 60);
    const src = window.game.engine.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    return sum / (px.length / 4);
  });

  expect(errors, errors.join('\n')).toEqual([]);
  expect(luminance).toBeGreaterThan(4);
});
