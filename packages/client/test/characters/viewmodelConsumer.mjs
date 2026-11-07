// Node supplies transport and a CPU Worker; production Three/Basis code decodes every map.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { Worker as NodeWorker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import console from 'node:console';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Multitool } from '../../src/entities/Multitool.js';
import { initTextureLoaders } from '../../src/core/Engine.js';
import { collectResources } from '../../src/core/dispose.js';

const scenario = process.argv[2];
const workers = [];
globalThis.self = globalThis;
globalThis.ProgressEvent = class {
  constructor(type, options) {
    this.type = type;
    Object.assign(this, options);
  }
};
globalThis.Worker = class {
  constructor(url) {
    this.listeners = [];
    this.ready = globalThis
      .fetch(url)
      .then((r) => r.text())
      .then((source) => {
        const prelude =
          "const {parentPort}=require('node:worker_threads'); const self=globalThis; self.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer); self.addEventListener=(type,fn)=>parentPort.on(type,data=>fn({data}));\n";
        const worker = new NodeWorker(prelude + source, { eval: true });
        worker.on('message', (data) => {
          for (const fn of this.listeners) fn({ data });
        });
        worker.on('error', (error) => {
          console.error(error);
          process.exitCode = 1;
        });
        return worker;
      });
    workers.push(this);
  }
  addEventListener(type, fn) {
    assert.equal(type, 'message');
    this.listeners.push(fn);
  }
  postMessage(data, transfer) {
    this.ready.then((worker) => worker.postMessage(data, transfer));
  }
  terminate() {
    return this.ready.then((worker) => worker.terminate());
  }
};

function partial(bytes, materialName, slot) {
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  const material = json.materials.find((m) => (materialName === 'Tool' ? m.name.endsWith('_Tool') : m.name === materialName));
  const info = material[slot] ?? material.pbrMetallicRoughness[slot];
  const image = json.images[json.textures[info.index].extensions.KHR_texture_basisu.source];
  delete image.bufferView;
  image.uri = 'https://viewmodel.invalid/missing.ktx2';
  let encoded = Buffer.from(JSON.stringify(json));
  encoded = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 32)]);
  const bin = bytes.subarray(28 + length);
  const output = Buffer.alloc(28 + encoded.length + bin.length);
  output.writeUInt32LE(0x46546c67);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(encoded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  encoded.copy(output, 20);
  output.writeUInt32LE(bin.length, 20 + encoded.length);
  output.writeUInt32LE(0x004e4942, 24 + encoded.length);
  bin.copy(output, 28 + encoded.length);
  assert.deepEqual(output.subarray(28 + encoded.length), bin);
  return output;
}

let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const nativeFetch = globalThis.fetch;
let failures = 0;
globalThis.fetch = async (request, ...args) => {
  const url = typeof request === 'string' ? request : request.url;
  if (url.startsWith('https://viewmodel.invalid/')) {
    const path = new globalThis.URL(url).pathname;
    if (path === '/missing.ktx2' || (scenario === 'basis' && path.startsWith('/basis/'))) {
      failures++;
      return new globalThis.Response('injected unavailable texture input', { status: 503 });
    }
    let bytes = readFileSync(new URL('../../public' + path, import.meta.url));
    if (path.endsWith('fp_thalune.glb')) {
      if (scenario.startsWith('stale')) await gate;
      const fields = scenario.startsWith('partial:') ? scenario.split(':').slice(1) : scenario === 'stale-partial' ? ['Tool', 'normalTexture'] : null;
      if (fields) bytes = partial(bytes, ...fields);
    }
    return new globalThis.Response(bytes);
  }
  return nativeFetch(request, ...args);
};
THREE.DefaultLoadingManager.setURLModifier((url) => (url.startsWith('/models/') || url.startsWith('/basis/') ? 'https://viewmodel.invalid' + url : url));
const ktx = initTextureLoaders({ extensions: { has: (name) => name === 'EXT_texture_compression_bptc' } }).setWorkerLimit(1);
const originalDispose = ktx.dispose.bind(ktx);
let loaderDisposals = 0;
ktx.dispose = () => {
  loaderDisposals++;
  return originalDispose();
};
const completions = [];
const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function (url, accept, ...rest) {
  return originalLoad.call(
    this,
    url,
    (gltf) => {
      const resources = collectResources(gltf.scene),
        skeletons = new Set();
      gltf.scene.traverse((o) => {
        if (o.isSkinnedMesh) skeletons.add(o.skeleton);
      });
      const counts = new Map([...resources, ...skeletons].map((resource) => [resource, 0]));
      for (const resource of counts.keys()) {
        const original = resource.dispose.bind(resource);
        resource.dispose = () => {
          counts.set(resource, counts.get(resource) + 1);
          return original();
        };
      }
      const entry = { gltf, resources, skeletons, counts };
      completions.push(entry);
      accept(gltf);
    },
    ...rest,
  );
};
const toasts = [];
const tool = Object.create(Multitool.prototype);
tool.game = { build: { people: 'thalune' }, engine: { viewScene: new THREE.Scene() }, hud: { toast: (...args) => toasts.push(args) } };
async function until(check) {
  const deadline = Date.now() + 20000;
  while (!check() && Date.now() < deadline) await delay(5);
  assert(check(), 'consumer did not settle');
}
function retired(entry) {
  assert(
    [...entry.counts.values()].every((count) => count === 1),
    'incomplete scene was not disposed exactly once',
  );
}
function active(entry) {
  assert(
    [...entry.counts.values()].every((count) => count === 0),
    'active resource was disposed',
  );
}

try {
  tool.buildViewModel();
  if (scenario.startsWith('stale')) {
    tool.game.build.people = 'ixari';
    tool.syncViewModel();
    await until(() => !!tool.viewModel);
    if (scenario === 'stale') {
      tool.game.build.people = 'thalune';
      tool.syncViewModel();
      release();
      await until(() => completions.length === 3 && !!tool.viewModel);
    } else {
      release();
      await until(() => completions.length === 2);
    }
    const current = completions.find((entry) => entry.gltf.scene === tool.viewModel);
    assert(current);
    active(current);
    for (const entry of completions.filter((entry) => entry !== current)) {
      retired(entry);
      assert([...entry.resources].every((resource) => !current.resources.has(resource)));
    }
    assert.equal(tool.viewModelError, null);
    assert.equal(toasts.length, 0);
  } else if (scenario === 'positive') {
    for (const people of ['thalune', 'ixari', 'ulgani']) {
      tool.game.build.people = people;
      tool.syncViewModel();
      await until(() => !!tool.viewModel || !!tool.viewModelError);
      assert(tool.viewModel && !tool.viewModelError);
      const entry = completions.at(-1);
      active(entry);
      for (const texture of [...entry.resources].filter((r) => r.isTexture)) {
        assert(texture.isCompressedTexture);
        assert.equal(texture.image.width, 2048);
        assert.equal(texture.mipmaps.length, 12);
      }
      for (const previous of completions.slice(0, -1)) retired(previous);
    }
    assert.equal(toasts.length, 0);
  } else {
    await until(() => !!tool.viewModel || !!tool.viewModelError);
    assert.equal(tool.viewModel, null, 'incomplete materials were published');
    assert(tool.viewModelError?.cause.message.includes('complete'));
    assert.equal(tool.view.children.length, 0);
    assert.equal(toasts.length, 1);
    retired(completions[0]);
    if (scenario !== 'basis') {
      const textures = [...completions[0].resources].filter((r) => r.isTexture);
      assert(textures.length > 0, 'partial failure did not exercise successfully decoded sibling maps');
      tool.game.build.people = 'ulgani';
      tool.syncViewModel();
      await until(() => !!tool.viewModel || !!tool.viewModelError);
      assert(tool.viewModel && !tool.viewModelError, 'shared loader was broken by disposal of the incomplete model');
      active(completions.at(-1));
    } else assert.equal(failures, 2);
  }
  assert.equal(loaderDisposals, 0, 'Multitool disposed the engine-owned KTX loader');
  console.log(
    JSON.stringify({
      scenario,
      status: 'PASS',
      failures,
      workers: workers.length,
      completions: completions.length,
      loaderDisposals,
      retiredResourceCounts: completions.filter((e) => e.gltf.scene !== tool.viewModel).map((e) => e.counts.size),
    }),
  );
} finally {
  release();
  originalDispose();
  await Promise.all(workers.map((worker) => worker.terminate()));
}
