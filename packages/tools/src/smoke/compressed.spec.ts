import { expect, test } from '@playwright/test';

// Compressed models in the browser (P1.E14.T12): once the game is up (its Engine has set the KTX2 loader up for this
// GPU), the game's own gltfLoader() loads a fixture with KTX2 maps (an ETC1S colour map and a UASTC normal map, behind
// KHR_texture_basisu) and meshopt-compressed, quantized geometry (packages/tools/src/art/fixtures.ts), and the renderer
// draws it: the Basis transcoder comes from /basis/, the maps arrive with their mip chains, the geometry decodes, the
// maps upload, and nothing logs an error. A broken transcoder path, a missing decoder or a three.js upgrade that moves
// either fails here.
interface Loaded {
  maps: { name: string; mips: number; width: number; compressed: boolean }[];
  position: { count: number; normalized: boolean };
  /** triangles the renderer drew of it (never culled: drawing it is what uploads the maps) */
  triangles: number;
}

// (the three.js shapes the page code touches; the tools package has no three types of its own)
interface Tex {
  name: string;
  mipmaps?: unknown[];
  isCompressedTexture?: boolean;
  image: { width: number };
}
interface Obj {
  isMesh?: boolean;
  frustumCulled: boolean;
  geometry: { attributes: { position: { count: number; normalized: boolean } } };
  material: { map: Tex | null; normalMap: Tex | null };
}
interface Root {
  traverse(fn: (o: Obj) => void): void;
}
interface Renderer {
  info: { reset(): void; render: { triangles: number } };
  setRenderTarget(t: null): void;
  render(scene: Root, camera: unknown): void;
}

test('a KTX2 and meshopt model loads and draws through the game loader', async ({ page }) => {
  const errors: string[] = [];
  const transcoder: number[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => /\/basis\/basis_transcoder\.(js|wasm)$/.test(r.url()) && transcoder.push(r.status()));

  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { game?: { engine?: unknown } }).game?.engine, null, { timeout: 60_000 });
  const out: Loaded = await page.evaluate(async () => {
    // (the module the game itself loaded: Vite serves it at this path)
    const engine = '/src/core/Engine.js';
    const { gltfLoader } = (await import(/* @vite-ignore */ engine)) as { gltfLoader(): { loadAsync(url: string): Promise<{ scene: Root }> } };
    const gltf = await gltfLoader().loadAsync('/src/gameplay/fixtures/textured.glb');
    const maps: Loaded['maps'] = [];
    let position: Loaded['position'] = { count: 0, normalized: false };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const attr = o.geometry.attributes.position;
      position = { count: attr.count, normalized: attr.normalized };
      for (const t of [o.material.map, o.material.normalMap]) {
        if (t) maps.push({ name: t.name, mips: t.mipmaps?.length ?? 0, width: t.image.width, compressed: !!t.isCompressedTexture });
      }
    });
    // (drawn once, so the maps upload in whatever format this GPU took them in)
    const game = (window as unknown as { game: { engine: { renderer: Renderer; camera: unknown } } }).game;
    const r = game.engine.renderer;
    r.info.reset();
    r.setRenderTarget(null);
    r.render(gltf.scene, game.engine.camera);
    return { maps, position, triangles: r.info.render.triangles };
  });

  // the quantized positions decoded by MeshoptDecoder, and the box drawn
  expect(out.position).toEqual({ count: 24, normalized: true });
  expect(out.triangles).toBe(12);
  // both maps transcoded, each with its full chain (32 px: 6 levels), compressed where this GPU has a format for them
  expect(out.maps.map((m) => m.name).sort()).toEqual(['panel_baseColor', 'panel_normal']);
  for (const m of out.maps) {
    expect(m.width).toBe(32);
    expect(m.mips).toBe(6);
  }
  expect(transcoder.length).toBeGreaterThanOrEqual(2);
  expect(transcoder.every((s) => s === 200 || s === 304)).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});
