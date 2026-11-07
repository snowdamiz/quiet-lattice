/* global window, document, Image, setTimeout, clearTimeout */
// Explicit offline dev fixture. No server session, grants, or authored poses.
export function installPageFixture() {
  const state = { frame: 0, elapsed: 0, dt: 0, loaderPending: false, captures: [] };
  function materials(root, people) {
    const required = new Set(['Skin', `VM_${people}_Tool`, ...(people === 'ulgani' ? [] : ['Bio'])]);
    const found = new Map();
    root?.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of [].concat(window.review?.shaded?.get(object) ?? object.material)) {
        if (!material.isMeshStandardMaterial || !required.has(material.name)) throw new Error(`Unexpected live material ${material.name}`);
        const slots = {};
        for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', ...(material.name === 'Skin' ? [] : ['emissiveMap'])]) {
          const t = material[slot];
          if (
            !t?.isTexture ||
            t.image?.width !== 2048 ||
            t.image?.height !== 2048 ||
            t.mipmaps?.length !== 12 ||
            t.mipmaps.some((m, i) => m.width !== 2048 >> i || m.height !== 2048 >> i || !m.data?.byteLength)
          ) {
            throw new Error(`Incomplete live ${material.name}.${slot}`);
          }
          slots[slot] = [t.image.width, t.image.height, t.mipmaps.length];
        }
        found.set(material.name, { name: material.name, slots });
      }
    });
    if (found.size !== required.size) throw new Error('Missing live Tool/Skin/Bio material contract');
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function step(dt = 1 / 60, { held = false, dx = 0, dy = 0 } = {}) {
    const g = window.game;
    if (g.net || g.mode !== 'foot' || g.director.blend || g.director.pose) throw new Error('Offline settled first-person mode required');
    g.time += dt;
    state.input = [held, dx, dy];
    if (state.raiseSeconds != null) state.raiseSeconds += dt;
    g.multitool.update(dt, { mouse: () => held, mouseDX: dx, mouseDY: dy }, true);
    state.frame++;
    state.elapsed += dt;
    state.dt = dt;
  }
  function pose(name) {
    const g = window.game;
    state.raiseSeconds = null;
    g.player.headUnderwater = false;
    // Set fixture input and advance the existing heat/sway/raise semantics. No bones,
    // mixer clips, view transforms, meter values, or update functions are substituted.
    for (let i = 0; i < 1200 && (i < 120 || g.multitool.heat > 0 || g.multitool.overheated); i++) step();
    if (g.multitool.heat > 0 || g.multitool.overheated) throw new Error('Existing cooling mode did not settle');
    if (name.startsWith('sway-')) {
      const input = { dx: name === 'sway-left' ? 100 : name === 'sway-right' ? -100 : 0, dy: name === 'sway-up' ? 100 : name === 'sway-down' ? -100 : 0 };
      for (let i = 0; i < 120; i++) step(1 / 60, input);
    } else if (name.startsWith('raise-')) {
      g.player.headUnderwater = true;
      step(0);
      g.player.headUnderwater = false;
      state.raiseSeconds = 0;
      step(0);
      if (name === 'raise-0.4') for (let i = 0; i < 24; i++) step();
    } else if (name === 'fire') step(1 / 60, { held: true });
    else if (name === 'overheat') {
      for (let i = 0; i < 1800 && !g.multitool.overheated; i++) step(1 / 60, { held: true });
      if (!g.multitool.overheated) throw new Error('Existing heat mode cannot reach overheat');
      step(0, { held: true });
    } else if (name === 'underwater') {
      g.player.headUnderwater = true;
      step();
    } else if (name !== 'neutral') throw new Error(`Unsupported pose ${name}`);
  }
  function still(file, people) {
    const g = window.game,
      t = g.multitool,
      e = g.engine;
    if (t.viewModelError) throw t.viewModelError;
    const liveMaterials = t.viewModel ? materials(t.viewModel, people) : [];
    if (!t.viewModel && !state.loaderPending) throw new Error('Unexplained missing viewmodel');
    if (t.update !== state.update || e.render !== state.render) throw new Error('Runtime methods were replaced');
    e.render(state.dt);
    const canvas = e.renderer.domElement;
    const observation = {
      file,
      viewport: [window.innerWidth, window.innerHeight],
      canvas: [canvas.width, canvas.height],
      frame: state.frame,
      dt: state.dt,
      elapsed: state.elapsed,
      people: t.viewModelPeople,
      visible: t.view.visible,
      modelAttached: !!t.viewModel && t.viewModel.parent === t.view,
      raise: t.raise,
      sway: [t.swayX, t.swayY],
      heat: t.heat,
      overheated: t.overheated,
      firing: t.firing,
      beamVisible: t.beam.visible,
      underwater: g.player.headUnderwater,
      loaderPending: state.loaderPending,
      input: state.input,
      raiseSeconds: state.raiseSeconds ?? null,
      materials: liveMaterials,
    };
    if (t.firing) {
      const vm = t.muzzlePosition(t.view.position.clone());
      const world = t.worldMuzzlePosition(t.view.position.clone());
      const beam = t.beam.getWorldPosition(t.view.position.clone());
      const camera = (c) => ({ fov: c.fov, aspect: c.aspect, near: c.near, far: c.far });
      observation.projection = {
        view: vm.clone().project(e.viewCamera).toArray(),
        world: world.clone().project(e.camera).toArray(),
        beam: beam.project(e.camera).toArray(),
        viewMuzzle: vm.toArray(),
        worldMuzzle: world.toArray(),
        viewCamera: camera(e.viewCamera),
        worldCamera: camera(e.camera),
      };
      const { view, world: projected, beam: projectedBeam } = observation.projection;
      if (
        ![...view, ...projected, ...projectedBeam].every(Number.isFinite) ||
        [0, 1].some((i) => Math.abs(view[i] - projected[i]) > 1e-5 || Math.abs(view[i] - projectedBeam[i]) > 1e-5)
      )
        throw new Error('Same-frame world muzzle is not aligned');
    }
    // Canvas bytes and raw facts are sampled in this single synchronous render task.
    return { data: canvas.toDataURL('image/png'), observation };
  }
  window.__viewmodelPacket = { state, materials, step, pose, still };
}

export async function instrumentReview(page, people) {
  await page.evaluate((people) => {
    const r = window.review,
      api = window.__viewmodelPacket;
    if (api.state.reviewInstalled) return;
    api.state.reviewInstalled = true;
    const capture = r.capture.bind(r),
      overlay = r.captureOverlay.bind(r);
    function fact(data, isOverlay) {
      const stats = r.stats();
      api.state.materials = api.materials(r.content, people);
      api.state.captures.push({ requestedLOD: stats.lod, selectedLOD: stats.shown, far: r.orbit.range || null, overlay: isOverlay });
      const canvas = document.createElement('canvas');
      const source = window.game.engine.renderer.domElement;
      canvas.width = source.width;
      canvas.height = source.height;
      const ctx = canvas.getContext('2d');
      // Overlay already includes its own helpers. Preserve it verbatim.
      if (isOverlay) return data;
      ctx.drawImage(source, 0, 0);
      ctx.fillStyle = '#10141b';
      ctx.fillRect(0, canvas.height - 32, 700, 32);
      ctx.fillStyle = '#f2ede4';
      ctx.font = '20px sans-serif';
      ctx.fillText(`requested LOD ${stats.lod}; selected LOD ${stats.shown} (one authored LOD)`, 8, canvas.height - 9);
      return canvas.toDataURL('image/png');
    }
    r.capture = () => {
      api.materials(r.content, people);
      return fact(capture(), false);
    };
    r.captureOverlay = async () => {
      api.materials(r.content, people);
      return fact(await overlay(), true);
    };
  }, people);
}

export async function sheet(page, items, title) {
  return page.evaluate(
    async ({ items, title }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 48 + Math.ceil(items.length / 4) * 294;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#10141b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f2ede4';
      ctx.font = '20px sans-serif';
      ctx.fillText(title, 12, 30);
      for (const [i, item] of items.entries()) {
        const image = new Image();
        image.src = item.data;
        await image.decode();
        const x = (i % 4) * 480,
          y = 48 + Math.floor(i / 4) * 294;
        const h = (480 * image.height) / image.width;
        ctx.drawImage(image, x, y + (270 - h) / 2, 480, h);
        ctx.fillText(item.file, x + 8, y + 289);
      }
      return canvas.toDataURL('image/png');
    },
    { items, title },
  );
}

export async function captureView({ capture, chromium, spec, write, resources }) {
  const vite = await capture.startVite();
  resources.push(() => vite.stop());
  const browser = await chromium.launch({ args: capture.glArgs().args });
  resources.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(installPageFixture);
  await page.goto(`${vite.url}/#foot`);
  await page.waitForFunction(
    async () => {
      if (!window.game || !window.step) return false;
      await window.step(4);
      const g = window.game;
      return g.mode === 'foot' && !g.director.blend && !g.director.pose && !!g.multitool.viewModel && !g.player.headUnderwater;
    },
    null,
    { timeout: 180000 },
  );
  // Stop only the dev fixture's frame driver after the real #foot transition.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(50);
  await page.evaluate(async () => {
    const { Multitool } = await import('/src/entities/Multitool.js');
    const { Engine } = await import('/src/core/Engine.js');
    const g = window.game,
      api = window.__viewmodelPacket;
    if (g.net || g.multitool.update !== Multitool.prototype.update || g.engine.render !== Engine.prototype.render)
      throw new Error('Fixture is not the original offline runtime');
    api.state.update = g.multitool.update;
    api.state.render = g.engine.render;
    g.engine.pixelRatio = 1;
    g.engine.maxPixelRatio = 1;
    g.engine.renderer.setPixelRatio(1);
    g.engine.resize();
    g.player.hSpeed = 0;
    g.player.landShake = 0;
  });
  const start = spec.fromPeople ?? spec.people;
  await page.evaluate((people) => {
    window.game.build.people = people;
    window.__viewmodelPacket.step(0);
  }, start);
  await page.waitForFunction((people) => window.game.multitool.viewModelPeople === people && !!window.game.multitool.viewModel, start, { timeout: 90000 });
  const incoming = await page.evaluate((people) => {
    const g = window.game,
      api = window.__viewmodelPacket;
    for (let i = 0; i < 24; i++) api.step();
    g.engine.render(1 / 60);
    const value = {
      people: g.multitool.viewModelPeople,
      visible: g.multitool.view.visible,
      modelAttached: g.multitool.viewModel?.parent === g.multitool.view,
      materials: api.materials(g.multitool.viewModel, people),
    };
    if (value.people !== people || !value.visible || !value.modelAttached) throw new Error('Incoming people never reached real visible view pass');
    return value;
  }, start);
  const frames = [],
    images = [];
  async function take(file) {
    if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
    const shot = await page.evaluate(({ file, people }) => window.__viewmodelPacket.still(file, people), { file, people: spec.people });
    write(file, shot.data);
    frames.push(shot.observation);
    images.push({ file, data: shot.data });
  }
  if (spec.fromPeople) {
    let release, observed;
    const pending = new Promise((resolve) => {
      observed = resolve;
    });
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(`**/models/characters/viewmodels/fp_${spec.people}.glb`, async (route) => {
      observed();
      await hold;
      await route.continue();
    });
    await page.evaluate((people) => {
      const api = window.__viewmodelPacket;
      api.state.loaderPending = true;
      window.game.build.people = people;
      api.step(0);
      if (window.game.multitool.viewModel || window.game.multitool.view.visible) throw new Error('Real loader gap not exposed');
    }, spec.people);
    let timer;
    try {
      await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('No intercepted real loader request')), 15000);
        }),
      ]);
      await take('16x9-switch-gap.png');
    } finally {
      clearTimeout(timer);
      release();
    }
    await page.waitForFunction(() => !!window.game.multitool.viewModel, null, { timeout: 90000 });
    await page.evaluate(() => {
      const api = window.__viewmodelPacket;
      api.state.loaderPending = false;
      for (let i = 0; i < 24; i++) api.step();
    });
    await take('16x9-switch-settled.png');
  }
  for (const file of spec.files.filter((name) => name.endsWith('.png') && name !== 'sheet.png' && !name.includes('switch-'))) {
    const wide = file.startsWith('21x9-');
    await page.setViewportSize({ width: wide ? 2520 : 1920, height: 1080 });
    await page.evaluate(
      (pose) => {
        window.game.engine.resize();
        window.__viewmodelPacket.pose(pose);
      },
      file.replace(/^(16x9|21x9)-|\.png$/g, ''),
    );
    await take(file);
  }
  write('sheet.png', await sheet(page, images, `${spec.people}: offline dev first-person fixture`));
  write(
    'observations.json',
    JSON.stringify({
      version: 1,
      unit: spec.id,
      people: spec.people,
      fromPeople: spec.fromPeople,
      incoming,
      fixture: 'offline-dev-first-person',
      serverAuthority: false,
      errors,
      frames,
    }),
  );
}
