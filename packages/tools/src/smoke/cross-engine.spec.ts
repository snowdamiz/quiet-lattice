import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, firefox, test, webkit, type BrowserType, type Page } from '@playwright/test';
import * as World from '@astra/shared/world';
import { compareBits, engineMath, sampleDirections, worldBits } from './world-bits.ts';

// World generation gives the same bits in Node (the server) and in every browser engine (the clients), DESIGN 17
// (P1.E02.T09): the galaxy's tier table and systems 0–9 (their descriptions, every rocky world's cities and sites and its
// resource nodes round its sites and over a spread of cells (P1.E13.T02), the home planets' dens and pads at Tiers 1 and 3
// and their terrain at 20 directions, every body's pose at five times) are
// generated in each engine from the shared world module as the client's Vite dev server serves it, and compared with
// Node's bit for bit. Chromium always runs; Firefox and WebKit run where Playwright has them (`pnpm --filter @astra/tools
// exec playwright install firefox webkit`) and can start them, and are skipped otherwise.

const WORLD = fileURLToPath(new URL('../../../shared/src/world/index.ts', import.meta.url));
const BITS = fileURLToPath(new URL('./world-bits.ts', import.meta.url));
const DIRS = sampleDirections();

let node: ReturnType<typeof worldBits> | null = null;
const inNode = () => (node ??= worldBits(World, DIRS));

/** The world generated in the engine behind `page`, on a blank page of the dev server's origin. */
async function inEngine(page: Page, baseURL: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${baseURL}/__world-bits`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>world bits</title>' }),
  );
  await page.goto(`${baseURL}/__world-bits`);
  // (as source text, so nothing the test runner adds to a function reaches the page)
  const got = (await page.evaluate(`(async () => {
    const W = await import(${JSON.stringify(`/@fs${WORLD}`)});
    const G = await import(${JSON.stringify(`/@fs${BITS}`)});
    const t0 = performance.now();
    const bits = G.worldBits(W, ${JSON.stringify(DIRS)});
    return { bits, ms: performance.now() - t0, math: G.engineMath() };
  })()`)) as { bits: unknown; ms: number; math: string[] };
  expect(errors, errors.join('\n')).toEqual([]);
  return got;
}

async function check(name: string, page: Page, baseURL: string) {
  const want = inNode();
  const got = await inEngine(page, baseURL);
  const diff = compareBits(want, got.bits);
  // (the control: how often the engine's own Math disagrees with Node's, which is why world generation does not use it)
  const own = engineMath();
  const mathDiffers = own.filter((v, i) => v !== got.math[i]).length;
  const version = page.context().browser()?.version();
  console.log(
    `${name} ${version}: ${diff.leaves} values compared with Node's, ${diff.differences} differ (generated in ${got.ms.toFixed(0)} ms); its own Math differs from Node's on ${mathDiffers} of ${own.length} calls`,
  );
  expect(diff.leaves).toBeGreaterThan(100_000);
  expect(diff.first, `${diff.differences} values differ from Node's`).toEqual([]);
}

test('world generation in Chromium gives Node’s bits', async ({ page, baseURL }) => {
  await check('Chromium', page, baseURL!);
});

const others: [string, BrowserType][] = [
  ['Firefox', firefox],
  ['WebKit', webkit],
];
for (const [name, engine] of others) {
  test(`world generation in ${name} gives Node’s bits`, async ({ baseURL }) => {
    test.skip(!existsSync(engine.executablePath()), `${name} is not installed for Playwright`);
    // (without the Chromium GPU flags the config gives its own browser; an engine that is installed but cannot start on
    // this machine is skipped, and says why)
    const browser = await engine.launch({ args: [] }).catch((e: Error) => {
      const why = e.message.match(/\[err\] (?!\*\*\*)(.*)/)?.[1] ?? e.message.split('\n')[0];
      console.log(`${name} cannot start here: ${why}`);
      test.skip(true, `${name} cannot start on this machine: ${why}`);
      throw e;
    });
    try {
      await check(name, await browser.newPage(), baseURL!);
    } finally {
      await browser.close();
    }
  });
}
