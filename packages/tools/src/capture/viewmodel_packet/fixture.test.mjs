/* global global */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installPageFixture, instrumentReview } from './fixture.mjs';

function material(name) {
  const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', ...(name === 'Skin' ? [] : ['emissiveMap'])];
  return {
    name,
    isMeshStandardMaterial: true,
    ...Object.fromEntries(
      slots.map((slot) => [
        slot,
        {
          isTexture: true,
          image: { width: 2048, height: 2048 },
          mipmaps: Array.from({ length: 12 }, (_, i) => ({ width: 2048 >> i, height: 2048 >> i, data: new Uint8Array(1) })),
        },
      ]),
    ),
  };
}
function scene(people) {
  const list = ['Skin', `VM_${people}_Tool`, ...(people === 'ulgani' ? [] : ['Bio'])].map(material);
  return { list, traverse: (fn) => list.forEach((material) => fn({ isMesh: true, material })) };
}
test('live actual material admission rejects each partial required slot', () => {
  global.window = {};
  installPageFixture();
  for (const people of ['thalune', 'ixari', 'ulgani']) {
    const root = scene(people);
    assert.equal(global.window.__viewmodelPacket.materials(root, people).length, people === 'ulgani' ? 2 : 3);
    for (const mat of root.list) {
      for (const slot of Object.keys(mat).filter((key) => key.endsWith('Map') || key === 'map')) {
        const texture = mat[slot];
        mat[slot] = null;
        assert.throws(() => global.window.__viewmodelPacket.materials(root, people), /Incomplete live/);
        mat[slot] = texture;
      }
    }
    const texture = root.list[0].map;
    texture.mipmaps[8].data = new Uint8Array(0);
    assert.throws(() => global.window.__viewmodelPacket.materials(root, people), /Incomplete live/);
  }
  delete global.window;
});
test('standard capture refuses material failure before requesting pixels', async () => {
  let pixels = 0;
  const root = scene('thalune');
  root.list[1].normalMap = null;
  global.window = {
    review: {
      content: root,
      capture: () => {
        pixels++;
      },
      captureOverlay: async () => {
        pixels++;
      },
    },
  };
  installPageFixture();
  await instrumentReview({ evaluate: (fn, arg) => fn(arg) }, 'thalune');
  assert.throws(() => global.window.review.capture(), /Incomplete live/);
  await assert.rejects(global.window.review.captureOverlay(), /Incomplete live/);
  assert.equal(pixels, 0);
  delete global.window;
});
test('fixture rejects server authority before calling product update', () => {
  let updates = 0;
  global.window = { game: { net: {}, mode: 'foot', director: {}, multitool: { update: () => updates++ } } };
  installPageFixture();
  assert.throws(() => global.window.__viewmodelPacket.step(), /Offline settled/);
  assert.equal(updates, 0);
  delete global.window;
});
