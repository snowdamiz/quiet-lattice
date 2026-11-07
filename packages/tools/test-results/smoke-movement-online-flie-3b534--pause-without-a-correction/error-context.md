# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke/movement-online.spec.ts >> flies on through page stalls of 4 s and 9 s and a hidden tab’s 40 s pause without a correction
- Location: src/smoke/movement-online.spec.ts:207:1

# Error details

```
Test timeout of 900000ms exceeded.
```

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
```

# Test source

```ts
  79  |     const g = (window as unknown as { game: { input: { fallbackLock: boolean; locked: boolean } } }).game;
  80  |     g.input.fallbackLock = true;
  81  |     g.input.locked = true;
  82  |     document.dispatchEvent(new Event('pointerlockchange'));
  83  |   });
  84  | }
  85  | 
  86  | async function hold(page: Page, keys: string[], ms: number) {
  87  |   for (const k of keys) await page.keyboard.down(k);
  88  |   await page.waitForTimeout(ms);
  89  |   for (const k of keys) await page.keyboard.up(k);
  90  | }
  91  | 
  92  | async function tap(page: Page, key: string) {
  93  |   await page.keyboard.down(key);
  94  |   await page.waitForTimeout(80);
  95  |   await page.keyboard.up(key);
  96  | }
  97  | 
  98  | /** How fast the server has the player's entity going, m/s, and in what mode. */
  99  | async function flight(page: Page) {
  100 |   return page.evaluate(() => {
  101 |     const n = (window as unknown as { game: { net: { entityId: number; store: { entities: Map<number, { mode?: string; vel?: number[] }> } } } }).game.net;
  102 |     const e = n.store.entities.get(n.entityId);
  103 |     return { mode: e?.mode, speed: Math.hypot(...(e?.vel ?? [0, 0, 0])) };
  104 |   });
  105 | }
  106 | 
  107 | /** The server has the player's ship under way at close to the space cap (so no correction is not for want of flying). */
  108 | async function flyingOn(page: Page, when: string) {
  109 |   const f = await flight(page);
  110 |   expect(f.mode, when).toBe('ship');
  111 |   expect(f.speed, when).toBeGreaterThan(400);
  112 | }
  113 | 
  114 | /** The corrections it has had, whether its socket closed, and its session's state. */
  115 | async function state(page: Page) {
  116 |   return page.evaluate(() => {
  117 |     const w = window as unknown as { __corr: unknown[]; __closed: unknown; game: { net?: { state: string } } };
  118 |     return { corrections: w.__corr, closed: w.__closed, state: w.game.net?.state };
  119 |   });
  120 | }
  121 | 
  122 | /** Off the pad, out of the hangar's mouth, and on the engines. */
  123 | async function flyOut(page: Page) {
  124 |   await enterNew(page);
  125 |   await page.waitForTimeout(2000);
  126 |   await tap(page, 'KeyE');
  127 |   await page.waitForTimeout(3000);
  128 |   await hold(page, ['Space'], 1500);
  129 | }
  130 | 
  131 | const STEP_MS = 50;
  132 | const FRAMES_PER_STEP = 2;
  133 | 
  134 | type Stepped = Window & { __advance(ms: number): void; __step(ms: number, frames: number): Promise<void> };
  135 | 
  136 | /**
  137 |  * From here the server's clock and the page's move only when the spec moves them: both are frozen where they stand (the
  138 |  * page's `performance.now`, which the game's net layer, its 20 Hz input cadence and its frame loop run on), the animation
  139 |  * frames are the spec's to call (the game's own loop, which clamps each frame's time as it does in play), and a fresh clock
  140 |  * sample is taken at the standstill, whose round trip is nothing.
  141 |  */
  142 | async function freeze(page: Page, on: Online) {
  143 |   await on.clock!.freeze();
  144 |   await page.evaluate(async () => {
  145 |     const w = window as unknown as Stepped & { game: { net: { ping(): void; clock: { samples: unknown[] } } } };
  146 |     let t = performance.now();
  147 |     performance.now = () => t;
  148 |     w.__advance = (ms) => {
  149 |       t += ms;
  150 |     };
  151 |     // (the game's loop asks for its next frame at the start of each; the one pending now comes round once more)
  152 |     let loop: (() => void) | null = null;
  153 |     w.requestAnimationFrame = (cb) => {
  154 |       loop = cb as () => void;
  155 |       return 0;
  156 |     };
  157 |     while (!loop) await new Promise((r) => setTimeout(r, 4));
  158 |     w.__step = async (ms, frames) => {
  159 |       const g = (window as unknown as { game: { net: { state: string; inputSeq: number; store: { ack: number } } | null } }).game;
  160 |       for (let i = 0; i < frames; i++) {
  161 |         t += ms / frames;
  162 |         const frame = loop!;
  163 |         loop = null;
  164 |         frame();
  165 |       }
  166 |       const deadline = Date.now() + 120_000;
  167 |       while (g.net?.state === 'joined' && g.net.store.ack < g.net.inputSeq && Date.now() < deadline) await new Promise((r) => setTimeout(r, 4));
  168 |     };
  169 |     const have = w.game.net.clock.samples.length;
  170 |     w.game.net.ping();
  171 |     while (w.game.net.clock.samples.length === have) await new Promise((r) => setTimeout(r, 4));
  172 |   });
  173 | }
  174 | 
  175 | /** `ms` of both clocks on, in `stepMs` steps of `frames` frames, each waiting for the server to handle the input it sent. */
  176 | async function play(page: Page, on: Online, ms: number, stepMs = STEP_MS, frames = FRAMES_PER_STEP) {
  177 |   for (let left = ms; left > 0; left -= stepMs) {
  178 |     await on.clock!.advance(Math.min(left, stepMs));
> 179 |     await page.evaluate(([step, n]) => (window as unknown as Stepped).__step(step!, n!), [Math.min(left, stepMs), frames]);
      |                ^ Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
  180 |   }
  181 | }
  182 | 
  183 | /** A stall: both clocks jump `ms`, with no frame run and no input sent. */
  184 | async function stall(page: Page, on: Online, ms: number) {
  185 |   await on.clock!.advance(ms);
  186 |   await page.evaluate((ms) => (window as unknown as Stepped).__advance(ms), ms);
  187 | }
  188 | 
  189 | async function holdFor(page: Page, on: Online, keys: string[], ms: number) {
  190 |   for (const k of keys) await page.keyboard.down(k);
  191 |   await play(page, on, ms);
  192 |   for (const k of keys) await page.keyboard.up(k);
  193 | }
  194 | 
  195 | test('takes off, flies out of the Waystation, boosts and engages the pulse drive without a correction', async ({ page }) => {
  196 |   test.setTimeout(240_000);
  197 |   await flyOut(page);
  198 |   await hold(page, ['KeyW'], 6000);
  199 |   await page.waitForTimeout(8000);
  200 |   await hold(page, ['ShiftLeft'], 4000);
  201 |   await page.waitForTimeout(4000);
  202 |   await tap(page, 'KeyJ');
  203 |   await page.waitForTimeout(8000);
  204 |   expect(await state(page)).toEqual({ corrections: [], closed: null, state: 'joined' });
  205 | });
  206 | 
  207 | test('flies on through page stalls of 4 s and 9 s and a hidden tab’s 40 s pause without a correction', async ({ page }) => {
  208 |   test.setTimeout(900_000);
  209 |   await enterNew(page, stepped);
  210 |   await freeze(page, stepped);
  211 |   await play(page, stepped, 2000);
  212 |   await holdFor(page, stepped, ['KeyE'], 100);
  213 |   await play(page, stepped, 3000);
  214 |   await holdFor(page, stepped, ['Space'], 1500);
  215 |   await page.keyboard.down('KeyW');
  216 |   await play(page, stepped, 8000);
  217 |   for (const ms of [4000, 9000]) {
  218 |     // the page busy: no frame runs, no input leaves
  219 |     await stall(page, stepped, ms);
  220 |     await play(page, stepped, 6000);
  221 |     await flyingOn(page, `after a ${ms} ms stall`);
  222 |     expect(await state(page), `after a ${ms} ms stall`).toEqual({ corrections: [], closed: null, state: 'joined' });
  223 |   }
  224 |   // a hidden tab: its frame loop runs on for 40 s without a frame, then runs again
  225 |   await page.evaluate(() => {
  226 |     const g = (window as unknown as { game: Record<string, unknown> }).game;
  227 |     g.__frame = g.frame;
  228 |     g.frame = () => {};
  229 |   });
  230 |   await play(page, stepped, 40_000, 1000, 1);
  231 |   await page.evaluate(() => {
  232 |     const g = (window as unknown as { game: Record<string, unknown> }).game;
  233 |     g.frame = g.__frame;
  234 |   });
  235 |   await play(page, stepped, 10_000);
  236 |   await flyingOn(page, 'after a 40 s pause');
  237 |   await page.keyboard.up('KeyW');
  238 |   expect(await state(page), 'after a 40 s pause').toEqual({ corrections: [], closed: null, state: 'joined' });
  239 | });
  240 | 
```