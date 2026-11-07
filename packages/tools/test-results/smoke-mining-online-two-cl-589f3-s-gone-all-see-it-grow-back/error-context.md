# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke/mining-online.spec.ts >> two clients mine one node and a third watches: all see it vanish, none asks for it while it is gone, all see it grow back
- Location: src/smoke/mining-online.spec.ts:226:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Test source

```ts
  203 | 
  204 | /** Turns the pilot to look at the node and holds its beam button down (or lets it go). */
  205 | async function aim(page: Page, node: Found, beam: boolean): Promise<void> {
  206 |   await page.evaluate(
  207 |     ({ node, beam }) => {
  208 |       const g = window.game;
  209 |       const p = g.player;
  210 |       const V = g.cam.pos.constructor;
  211 |       const inst = [...g.flora.instancesNear(new V(...node.pos), 3, (sp: { node?: string }) => sp.node)].find((i) => g.flora.mineTarget(i).node === node.id);
  212 |       const target = inst ? inst.pos.clone().addScaledVector(inst.up, inst.sp.height * inst.scale * 0.35) : new V(...node.pos);
  213 |       const up = p.state.pos.clone().normalize();
  214 |       const to = target.sub(p.state.pos.clone().addScaledVector(up, 1.7));
  215 |       const heading = to.clone().addScaledVector(up, -to.dot(up)).normalize();
  216 |       p.heading.copy(heading);
  217 |       p.pitch = Math.asin(Math.max(-1, Math.min(1, to.clone().normalize().dot(up))));
  218 |       g.input.fallbackLock = true;
  219 |       g.input.locked = true;
  220 |       window.dev.button(0, beam);
  221 |     },
  222 |     { node, beam },
  223 |   );
  224 | }
  225 | 
  226 | test('two clients mine one node and a third watches: all see it vanish, none asks for it while it is gone, all see it grow back', async ({ browser }) => {
  227 |   test.setTimeout(900_000);
  228 |   const errors: string[] = [];
  229 |   const a = await pilot(browser, errors);
  230 |   log('pilot a in');
  231 |   const b = await pilot(browser, errors);
  232 |   log('pilot b in');
  233 |   const c = await pilot(browser, errors);
  234 |   log('pilot c in');
  235 |   const miners = [a, b];
  236 |   const all = [a, b, c];
  237 | 
  238 |   // a node on the home world, found in the first pilot's scatter
  239 |   let node: Found | null = null;
  240 |   for (const spot of ['surface:0,0', 'surface:25,40', 'surface:-30,110', 'surface:50,-70', 'surface:-10,-150', 'surface:70,20']) {
  241 |     await stand(a, spot);
  242 |     log('stood at', spot);
  243 |     node = await nodeNear(a);
  244 |     log('node', node);
  245 |     if (node) break;
  246 |   }
  247 |   expect(node, 'a resource node near one of the spots').not.toBeNull();
  248 |   const found = node!;
  249 | 
  250 |   await stand(a, await groundBeside(a, found.pos, 6));
  251 |   await stand(b, await groundBeside(a, found.pos, -6));
  252 |   await stand(c, await groundBeside(a, found.pos, 12));
  253 |   log('all beside the node');
  254 |   const sees = `[...window.game.flora.instancesNear(new (window.game.cam.pos.constructor)(...${JSON.stringify(found.pos)}), 3, (sp) => sp.node)].some((i) => window.game.flora.mineTarget(i).node === ${JSON.stringify(found.id)})`;
  255 |   await until(a, sees, 60_000);
  256 |   await until(b, sees, 60_000);
  257 |   await until(c, sees, 60_000);
  258 |   log('all see the node');
  259 | 
  260 |   // what each page is told of the node, and every hit it sends for it
  261 |   for (const p of all) {
  262 |     await p.evaluate((id) => {
  263 |       const w = window as unknown as Window & { __told: { seq: number; result: string }[]; __sentFor: number[] };
  264 |       const net = window.game.net;
  265 |       w.__told = [];
  266 |       w.__sentFor = [];
  267 |       net.mining.on((m: { node?: string; seq: number; result: string }) => m.node === id && w.__told.push({ seq: m.seq, result: m.result }));
  268 |       const send = net.send.bind(net);
  269 |       net.send = (m: { t: string; node?: string; seq: number }) => {
  270 |         if (m.t === 'mine' && m.node === id) w.__sentFor.push(m.seq);
  271 |         return send(m);
  272 |       };
  273 |     }, found.id);
  274 |   }
  275 |   const gone = `window.game.net.mining.gone(window.game.flora.frameId, ${JSON.stringify(found.id.split('_').slice(0, 3).join('_'))}, ${JSON.stringify(found.id.split('_').slice(3).join('_'))})`;
  276 | 
  277 |   log('listeners set');
  278 |   await freeze(a);
  279 |   await freeze(b);
  280 |   await freeze(c);
  281 |   await play(all, 500);
  282 |   log('frozen, played 500 ms');
  283 |   expect(await a.evaluate(gone)).toBe(false);
  284 | 
  285 |   // both hold the beam on it
  286 |   await aim(a, found, true);
  287 |   await aim(b, found, true);
  288 |   const vanished = await playUntil(all, gone, 20_000);
  289 |   log('vanished', vanished);
  290 |   expect(vanished, `the node never went in all pages (${found.type}, ${found.hp} hp)`).toBe(true);
  291 |   for (const p of miners) {
  292 |     await aim(p, found, false);
  293 |     await p.evaluate(() => window.dev.button(0, false));
  294 |   }
  295 |   await play(all, 300);
  296 |   for (const p of all) {
  297 |     expect(await p.evaluate(sees), 'drawn while the server says it is gone').toBe(false);
  298 |     expect(await p.evaluate(gone)).toBe(true);
  299 |   }
  300 |   // both beams were on it, and the server told of its breaking once as an answer to a hit
  301 |   const sent = await Promise.all(miners.map((p) => p.evaluate(() => (window as unknown as Window & { __sentFor: number[] }).__sentFor.length)));
  302 |   expect(sent[0]).toBeGreaterThan(0);
> 303 |   expect(sent[1]).toBeGreaterThan(0);
      |                   ^ Error: expect(received).toBeGreaterThan(expected)
  304 |   const told = await Promise.all(all.map((p) => p.evaluate(() => (window as unknown as Window & { __told: { seq: number; result: string }[] }).__told)));
  305 |   expect(told.flat().filter((m) => m.result === 'depleted' && m.seq > 0)).toHaveLength(1);
  306 |   // (the watcher sent no hit, so it dealt no damage and got neither an answer nor a share: it learned of the break from
  307 |   // the `nodes` state alone)
  308 |   expect(told[2]).toEqual([]);
  309 |   expect(await c.evaluate(() => (window as unknown as Window & { __sentFor: number[] }).__sentFor)).toEqual([]);
  310 |   log('told', JSON.stringify(told));
  311 | 
  312 |   // holding the beam where it stood asks the server for nothing
  313 |   const sentBefore = await Promise.all(miners.map((p) => p.evaluate(() => (window as unknown as Window & { __sentFor: number[] }).__sentFor.length)));
  314 |   for (const p of miners) await aim(p, found, true);
  315 |   await play(all, 2000);
  316 |   for (const p of miners) await p.evaluate(() => window.dev.button(0, false));
  317 |   const sentAfter = await Promise.all(miners.map((p) => p.evaluate(() => (window as unknown as Window & { __sentFor: number[] }).__sentFor.length)));
  318 |   expect(sentAfter).toEqual(sentBefore);
  319 |   for (const p of all) expect(await p.evaluate(sees)).toBe(false);
  320 |   // (nor does the client ask by name)
  321 |   for (const p of all) {
  322 |     const asked = await p.evaluate((id) => window.game.net.mining.beam(1, window.game.flora.frameId, { node: id }, null, window.game.time), found.id);
  323 |     expect(asked).toBe(false);
  324 |   }
  325 | 
  326 |   // it grows back (a formation takes the longest, eight minutes), the same node, in both pages
  327 |   log('holding the beam on the gone node asked for nothing');
  328 |   await stall(all, 490_000);
  329 |   await play(all, 200);
  330 |   const back = await playUntil(all, `!(${gone})`, 20_000);
  331 |   expect(back, 'the node never grew back in all pages').toBe(true);
  332 |   for (const p of all) expect(await p.evaluate(sees)).toBe(true);
  333 | 
  334 |   expect(errors).toEqual([]);
  335 | });
  336 | 
```