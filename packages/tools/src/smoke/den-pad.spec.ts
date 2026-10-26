import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { GALAXY_SEED, Galaxy, TerrainSampler, denPads, describeGalaxySystem, planSurface, type Den, type PlanetParams } from '@astra/shared/world';

// A den's levelled pad in the engine (P1.E02.T05). Until the tier function lands (P1.E02.T06) the client plans every
// world at Tier 0, which has no dens; so the home planet is planned again here at Tier 1, as the server will plan it,
// and its pads, now with the dens', are handed to the running client as plain data. The terrain is rebuilt with them,
// and the test checks that the sampler and the terrain mesh actually drawn are level across a den, that nothing is
// drawn for the den itself (it has no model yet), and captures the ground before and after it is levelled.

/** Steps frames until the terrain and flora workers are idle (bounded), as the review scene does. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const g = window.game;
    for (let i = 0; i < 900; i++) {
      await window.step(2);
      await new Promise((r) => setTimeout(r, 4));
      if (i > 30 && g.pool.pending() === 0) break;
    }
    await window.step(4);
  });
}

/** Renders a frame and reads it back in the same task, before the drawing buffer is cleared. */
async function capture(page: Page, path: string) {
  const png = await page.evaluate(() => {
    window.game.frame(1 / 60);
    return window.game.engine.renderer.domElement.toDataURL('image/png') as string;
  });
  writeFileSync(path, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
}

/** Heights (m above sea level) of the drawn terrain's vertices within the den's footprint, read off the chunk meshes. */
async function meshHeights(page: Page, den: Den) {
  return page.evaluate((den) => {
    const P = window.game.system.homePlanet;
    const R = P.radius;
    const [dx, dy, dz] = den.dir;
    const out: number[] = [];
    for (const m of P.terrain.group.children) {
      if (!m.isMesh || !m.visible) continue;
      const pos = m.geometry.attributes.position.array;
      // a chunk is an N × N grid followed by four skirts of N vertices each
      const N = Math.round(Math.sqrt(4 + pos.length / 3) - 2);
      for (let i = 0; i < N * N; i++) {
        const x = m.position.x + pos[i * 3];
        const y = m.position.y + pos[i * 3 + 1];
        const z = m.position.z + pos[i * 3 + 2];
        const r = Math.hypot(x, y, z);
        if (Math.hypot(x / r - dx, y / r - dy, z / r - dz) * R <= den.footprint) out.push(r - R);
      }
    }
    return out;
  }, den);
}

test('a Tier 1 den pad is levelled in the engine, and nothing is drawn for the den', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => 'dev' in window && 'step' in window, null, { timeout: 60_000 });
  const home = await page.evaluate(async () => {
    await window.dev.boot();
    await window.step(30);
    const g = window.game;
    const P = g.system.homePlanet;
    const sun = P.dirToLocal(g.system.star.position.clone().sub(P.position).normalize(), g.system.star.position.clone());
    return {
      system: g.system.info.id,
      seed: P.params.seed,
      type: P.params.type,
      radius: P.radius,
      pads: P.params.pads as number[],
      sun: [sun.x, sun.y, sun.z],
    };
  });

  // the same world at Tier 1: the same cities and sites, so the client's pads are the first of the new ones, bit for bit
  // (world generation's math is deterministic: P1.E02.T09)
  // (described as the server describes it: system 0's home world is the Thalune's, with their capital on it)
  const described = describeGalaxySystem(new Galaxy(GALAXY_SEED).systems[home.system]);
  const params = described.bodies[described.home].params as PlanetParams;
  expect({ seed: params.seed, type: params.type, radius: params.radius }).toEqual({ seed: home.seed, type: home.type, radius: home.radius });
  const plan = planSurface(params, new TerrainSampler(params), { tier: 1 });
  expect(plan.pads.slice(0, home.pads.length)).toEqual(home.pads);
  expect(plan.dens.length).toBeGreaterThan(0);
  // (handed over as JSON, as the server would send it)
  const dens = JSON.parse(JSON.stringify(plan.dens)) as Den[];
  expect(denPads(dens)).toEqual(plan.pads.slice(home.pads.length));

  // a den in daylight, on the most broken ground (where levelling shows most)
  const sunUp = (d: Den) => d.dir[0] * home.sun[0] + d.dir[1] * home.sun[1] + d.dir[2] * home.sun[2];
  const lit = dens.filter((d) => sunUp(d) > 0.5);
  const den = (lit.length ? lit : dens).sort((a, b) => (lit.length ? b.relief - a.relief : sunUp(b) - sunUp(a)))[0];
  testInfo.annotations.push({ type: 'den', description: `${den.kind} (${den.role}) relief ${den.relief.toFixed(2)} m, base ${den.base.toFixed(2)} m` });

  // a fixed camera 24 m off the den, 14 m above its ground, lit from the side; the ship set down 150 m away, out of shot
  await page.evaluate((den) => {
    const g = window.game;
    const P = g.system.homePlanet;
    const V3 = g.ship.state.pos.constructor;
    const M4 = P.root.matrix.constructor;
    const up = new V3(...den.dir);
    const sun = P.dirToLocal(g.system.star.position.clone().sub(P.position).normalize(), new V3());
    const toSun = sun.clone().addScaledVector(up, -sun.dot(up)).normalize();
    const side = new V3().crossVectors(up, toSun).normalize();
    const target = up.clone().multiplyScalar(P.radius + den.base);
    const eye = target.clone().addScaledVector(up, 14).addScaledVector(side, 24);
    const eyeDir = eye.clone().normalize();
    if (eye.length() < P.groundRadius(eyeDir) + 4) eye.copy(eyeDir.multiplyScalar(P.groundRadius(eyeDir) + 4));
    const look = new M4().lookAt(eye, target, up);
    const pose = (out: { frame: unknown; pos: { copy(v: unknown): void }; quat: { setFromRotationMatrix(m: unknown): void } }) => {
      out.frame = P;
      out.pos.copy(eye);
      out.quat.setFromRotationMatrix(look);
      return out;
    };
    g.ship.updateCamera = (_dt: number, _inp: unknown, out: Parameters<typeof pose>[0]) => pose(out);
    g.player.cameraState = (out: Parameters<typeof pose>[0]) => pose(out);
    const s = g.ship.state;
    const park = up
      .clone()
      .addScaledVector(side, -150 / P.radius)
      .normalize();
    s.frame = P;
    s.pos.copy(park).multiplyScalar(P.groundRadius(park) + 1.95);
    s.vel.set(0, 0, 0);
    g.ship.speed = 0;
    g.ship.mode = 'landed';
    g.cam.frame = undefined;
    g.sky.reset();
    // (a fixed render size, so the two captures line up)
    g.engine.adapt = () => {};
  }, den);
  await settle(page);
  const before = testInfo.outputPath('den-pad-before.png');
  await capture(page, before);
  const raw = await meshHeights(page, den);

  // the client adds the dens' pads to its own: the sampler, the terrain workers, and the terrain and plants rebuilt on them
  const applied = await page.evaluate((extra) => {
    const g = window.game;
    const P = g.system.homePlanet;
    P.params.pads = [...P.params.pads, ...extra];
    P.sampler.setPads(P.params.pads);
    g.pool.registerPlanet(P.id, P.params);
    P.terrain.dispose();
    g.flora.reset();
    return P.params.pads.length / 6;
  }, denPads(dens));
  expect(applied).toBe(plan.pads.length / 6);
  await settle(page);
  const after = testInfo.outputPath('den-pad-after.png');
  await capture(page, after);
  const levelled = await meshHeights(page, den);

  // the sampler: level across the footprint, at the den's base
  const sampled = await page.evaluate((den) => {
    const P = window.game.system.homePlanet;
    const V3 = P.root.position.constructor;
    const up = new V3(...den.dir);
    const t = new V3().crossVectors(Math.abs(up.y) > 0.99 ? new V3(1, 0, 0) : new V3(0, 1, 0), up).normalize();
    const b = new V3().crossVectors(up, t);
    const hs = [];
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const r = (den.footprint * f) / P.radius;
        const d = up
          .clone()
          .addScaledVector(t, Math.cos(a) * r)
          .addScaledVector(b, Math.sin(a) * r)
          .normalize();
        hs.push(P.heightAt(d));
      }
    }
    return hs;
  }, den);
  for (const h of sampled) expect(Math.abs(h - den.base)).toBeLessThan(1e-6);

  // the drawn mesh: there was ground to level, and now it is level (to float32 vertex precision) at the den's base
  const spread = (hs: number[]) => Math.max(...hs) - Math.min(...hs);
  expect(raw.length).toBeGreaterThan(20);
  expect(levelled.length).toBeGreaterThan(20);
  expect(spread(raw)).toBeGreaterThan(0.3);
  expect(spread(levelled)).toBeLessThan(0.01);
  for (const h of levelled) expect(Math.abs(h - den.base)).toBeLessThan(0.01);

  // nothing is drawn for a den: the client's structures are still the planet's sites alone
  const structures = await page.evaluate(() => {
    const g = window.game;
    return {
      sites: g.system.homePlanet.sites.length,
      built: g.structures.sites.length,
      types: [...new Set(g.structures.sites.map((s: { type: string }) => s.type))],
    };
  });
  expect(structures.built).toBe(structures.sites);
  expect(structures.types.sort()).toEqual(['beacon', 'crash', 'monolith', 'outpost']);

  console.log(
    `den ${den.kind} (${den.role}): natural spread ${spread(raw).toFixed(3)} m over ${raw.length} vertices, levelled spread ${spread(levelled).toExponential(2)} m over ${levelled.length}`,
  );
  console.log(`den pad captures: ${before} ${after}`);
  await testInfo.attach('den pad before', { path: before, contentType: 'image/png' });
  await testInfo.attach('den pad after', { path: after, contentType: 'image/png' });
  expect(errors, errors.join('\n')).toEqual([]);
});
