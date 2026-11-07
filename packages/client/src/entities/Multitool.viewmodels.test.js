import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadActualRig } from '../../test/characters/loadActualRig.js';

const requests = vi.hoisted(() => []);
vi.mock('../core/Engine.js', () => ({
  gltfLoader: () => ({ load: (url, accept, progress, reject) => requests.push({ url, accept, reject }) }),
}));
import { Multitool } from './Multitool.js';

function tool(people = 'thalune') {
  requests.length = 0;
  const value = Object.create(Multitool.prototype);
  value.game = { build: { people }, engine: { viewScene: new THREE.Scene() }, hud: { toast: vi.fn() } };
  value.buildViewModel();
  return value;
}

function model() {
  const scene = new THREE.Group();
  const right = new THREE.Bone();
  right.name = 'vm_hand_R';
  const left = new THREE.Bone();
  left.name = 'vm_hand_L';
  const muzzle = new THREE.Object3D();
  muzzle.name = 'Muzzle';
  muzzle.position.set(0.2, -0.16, -0.93);
  const material = new THREE.MeshStandardMaterial({ name: 'VM_thalune_Tool', emissive: '#ffe7c2', emissiveIntensity: 0.35 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  scene.add(right, left, mesh);
  right.add(muzzle);
  return { scene, mesh, muzzle, right, material };
}

describe('Multitool selected-character loader', () => {
  it('loads all three peoples through the production loader and never the retired demo', () => {
    const t = tool();
    for (const people of ['thalune', 'ixari', 'ulgani']) {
      t.game.build.people = people;
      t.syncViewModel();
      expect(requests.at(-1).url).toBe(`/models/characters/viewmodels/fp_${people}.glb`);
    }
    expect(readFileSync(new URL('./Multitool.js', import.meta.url), 'utf8')).not.toContain('/models/multitool.glb');
    expect(existsSync(new URL('../../public/models/multitool.glb', import.meta.url))).toBe(false);
  });

  it('disposes an obsolete completion and cannot attach it after switching away and back', () => {
    const t = tool();
    const a = requests[0];
    t.game.build.people = 'ixari';
    t.syncViewModel();
    const b = requests[1];
    t.game.build.people = 'thalune';
    t.syncViewModel();
    const old = model();
    const dispose = vi.spyOn(old.mesh.geometry, 'dispose');
    a.accept(old);
    expect(dispose).toHaveBeenCalledOnce();
    expect(t.view.children).toHaveLength(0);
    const current = model();
    requests[2].accept(current);
    b.accept(model());
    expect(t.view.children).toEqual([current.scene]);
  });

  it('retires the previous people immediately, keeps authored glow, and follows the animated muzzle', () => {
    const t = tool();
    const m = model();
    requests[0].accept(m);
    expect(m.material.emissive.getHexString()).toBe('ffe7c2');
    expect(t.viewModelGlow).toEqual([{ material: m.material, intensity: 0.35 }]);
    t.view.position.set(0.1, -0.03, 0.02);
    m.right.rotation.x = 0.2;
    expect(t.muzzlePosition(new THREE.Vector3()).distanceTo(m.muzzle.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-8);
    const dispose = vi.spyOn(m.material, 'dispose');
    t.game.build.people = 'ulgani';
    t.syncViewModel();
    expect(t.view.children).toHaveLength(0);
    expect(t.muzzle).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('aligns the world beam with the view-pass muzzle at different FOVs and aspect ratios', () => {
    const t = tool();
    requests[0].accept(model());
    for (const aspect of [16 / 9, 21 / 9]) {
      const camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 1000);
      const viewCamera = new THREE.PerspectiveCamera(66, aspect, 0.01, 50);
      camera.rotation.set(0.2, 0.6, 0);
      camera.updateMatrixWorld(true);
      t.game.engine.camera = camera;
      t.game.engine.viewCamera = viewCamera;
      t.game.camWorldQuat = camera.quaternion;
      const view = t.muzzlePosition(new THREE.Vector3()).project(viewCamera);
      const oldOrigin = t.muzzlePosition(new THREE.Vector3()).applyQuaternion(camera.quaternion).project(camera);
      expect(Math.abs(oldOrigin.y - view.y)).toBeGreaterThan(0.01);
      const world = t.worldMuzzlePosition(new THREE.Vector3()).project(camera);
      expect(world.x).toBeCloseTo(view.x, 7);
      expect(world.y).toBeCloseTo(view.y, 7);
    }
  });

  it('surfaces asset failure and malformed assets without a generic fallback', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const t = tool();
      requests[0].reject(new Error('404'));
      expect(t.viewModelError.cause.message).toBe('404');
      expect(t.view.children).toHaveLength(0);
      t.game.build.people = 'ixari';
      t.syncViewModel();
      requests[1].accept({ scene: new THREE.Group() });
      expect(t.viewModelError.cause.message).toContain('missing');
      expect(requests).toHaveLength(2);
    } finally {
      error.mockRestore();
    }
  });
});

describe('actual compressed viewmodel consumers', () => {
  for (const people of ['thalune', 'ixari', 'ulgani']) {
    it(`${people}: real GLTFLoader decodes, articulates wrist/digits, and carries the tool socket`, async () => {
      const bytes = readFileSync(new URL(`../../public/models/characters/viewmodels/fp_${people}.glb`, import.meta.url));
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      expect(json.extensionsRequired).toEqual(expect.arrayContaining(['KHR_texture_basisu', 'EXT_meshopt_compression']));
      expect(json.images.every((image) => image.mimeType === 'image/ktx2')).toBe(true);
      expect(json.materials.some((m) => m.name === `VM_${people}_Tool` && m.normalTexture && m.occlusionTexture && m.emissiveTexture)).toBe(true);
      const gltf = await loadActualRig(`viewmodels/fp_${people}`);
      const scene = gltf.scene;
      const skins = [];
      scene.traverse((o) => {
        if (o.isSkinnedMesh) skins.push(o);
      });
      expect(skins.length).toBeGreaterThan(0);
      expect(gltf.proof.geometrySkinMorphNodeAndCompressionJsonUnchanged).toBe(true);
      expect(gltf.proof.binaryBytesUnchanged).toBe(true);
      const triangles = skins.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
      expect(triangles).toBeGreaterThanOrEqual(15000);
      expect(triangles).toBeLessThanOrEqual(60000);
      for (const side of ['L', 'R']) {
        for (const joint of ['hand', 'index_02', 'middle_02', 'ring_02', 'thumb_02']) {
          const name = `vm_${joint}_${side}`;
          const bone = scene.getObjectByName(name);
          expect(bone?.isBone).toBe(true);
          const skin = skins.find((m) => {
            const index = m.skeleton.bones.indexOf(bone);
            if (index < 0) return false;
            const ids = m.geometry.attributes.skinIndex,
              ws = m.geometry.attributes.skinWeight;
            for (let v = 0; v < ids.count; v++) for (let c = 0; c < 4; c++) if (ids.getComponent(v, c) === index && ws.getComponent(v, c) > 0.2) return true;
            return false;
          });
          expect(skin).toBeTruthy();
          const index = skin.skeleton.bones.indexOf(bone),
            ids = skin.geometry.attributes.skinIndex,
            ws = skin.geometry.attributes.skinWeight;
          let vertex = -1;
          for (let v = 0; v < ids.count && vertex < 0; v++)
            for (let c = 0; c < 4; c++) if (ids.getComponent(v, c) === index && ws.getComponent(v, c) > 0.2) vertex = v;
          const rest = new THREE.Vector3().fromBufferAttribute(skin.geometry.attributes.position, vertex);
          const before = skin.applyBoneTransform(vertex, rest.clone());
          const rotation = bone.quaternion.clone();
          bone.rotateX(0.22);
          scene.updateMatrixWorld(true);
          const after = skin.applyBoneTransform(vertex, rest.clone());
          expect(before.distanceTo(after)).toBeGreaterThan(1e-5);
          expect(after.toArray().every(Number.isFinite)).toBe(true);
          bone.quaternion.copy(rotation);
          scene.updateMatrixWorld(true);
        }
      }
      const muzzle = scene.getObjectByName('Muzzle');
      const right = scene.getObjectByName('vm_hand_R');
      expect(muzzle).toBeTruthy();
      expect(scene.getObjectByName('Grip_L')).toBeTruthy();
      const before = muzzle.getWorldPosition(new THREE.Vector3());
      right.rotateX(0.12);
      scene.updateMatrixWorld(true);
      expect(before.distanceTo(muzzle.getWorldPosition(new THREE.Vector3()))).toBeGreaterThan(0.01);
      const t = tool(people);
      requests[0].accept(gltf);
      const disposals = [...new Set(skins.map((m) => m.skeleton))].map((skeleton) => vi.spyOn(skeleton, 'dispose'));
      t.game.build.people = people === 'thalune' ? 'ixari' : 'thalune';
      t.syncViewModel();
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    });
  }
});

describe('viewmodels use the existing shared bind-relative clip adapter', () => {
  it('preserves neutral skin vertices and intended wrist motion for all nine people pairs', async () => {
    const { captureSharedRigBindProfile, adaptSharedRigClip } = await import('../characters/sharedRig.js');
    const rigs = [];
    for (const people of ['thalune', 'ixari', 'ulgani']) {
      const gltf = await loadActualRig(`viewmodels/fp_${people}`);
      rigs.push({ ...gltf, profile: captureSharedRigBindProfile({ id: `${people}@${gltf.proof.exportSha256}`, root: gltf.scene }) });
    }
    const sample = (root) => {
      const points = [];
      root.updateMatrixWorld(true);
      root.traverse((mesh) => {
        if (!mesh.isSkinnedMesh) return;
        const position = mesh.geometry.attributes.position;
        for (let i = 0; i < position.count; i += Math.max(1, Math.floor(position.count / 32))) {
          const point = new THREE.Vector3().fromBufferAttribute(position, i);
          mesh.applyBoneTransform(i, point).applyMatrix4(mesh.matrixWorld);
          points.push(point);
        }
      });
      return points;
    };
    for (const source of rigs) {
      const tracks = source.profile.bones.flatMap((bone) => [
        new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0, 1], [...bone.position, ...bone.position]),
        new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1], [...bone.quaternion, ...bone.quaternion]),
        new THREE.VectorKeyframeTrack(`${bone.name}.scale`, [0, 1], [...bone.scale, ...bone.scale]),
      ]);
      for (const target of rigs) {
        const before = sample(target.scene);
        const neutral = adaptSharedRigClip({
          clip: new THREE.AnimationClip('neutral', 1, tracks),
          sourceProfileId: source.profile.id,
          sourceProfile: source.profile,
          targetProfile: target.profile,
        });
        const mixer = new THREE.AnimationMixer(target.scene);
        mixer.clipAction(neutral).play();
        mixer.setTime(0.5);
        const after = sample(target.scene);
        expect(Math.max(...after.map((p, i) => p.distanceTo(before[i])))).toBeLessThan(1e-5);
        mixer.stopAllAction();
        mixer.uncacheRoot(target.scene);
        const sourceHand = source.profile.bones.find((b) => b.name === 'vm_hand_R');
        const targetHand = target.profile.bones.find((b) => b.name === 'vm_hand_R');
        const offset = [0.008, 0.016, -0.01];
        const motion = new THREE.AnimationClip('wrist', 1, [
          new THREE.VectorKeyframeTrack('vm_hand_R.position', [0, 1], [...sourceHand.position, ...sourceHand.position.map((v, i) => v + offset[i])]),
        ]);
        const adapted = adaptSharedRigClip({ clip: motion, sourceProfileId: source.profile.id, sourceProfile: source.profile, targetProfile: target.profile });
        const action = mixer.clipAction(adapted);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        mixer.update(1);
        const actual = target.scene.getObjectByName('vm_hand_R').position.toArray();
        for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(targetHand.position[i] + offset[i], 6);
        expect(Math.max(...sample(target.scene).map((p, i) => p.distanceTo(before[i])))).toBeGreaterThan(0.005);
        mixer.stopAllAction();
        mixer.uncacheRoot(target.scene);
      }
    }
  });
});
