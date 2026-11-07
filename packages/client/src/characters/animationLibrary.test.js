import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { env } from 'node:process';
import { AnimationMixer, InterpolateLinear, LoopOnce, NormalAnimationBlendMode, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adaptSharedRigClip, captureSharedRigBindProfile } from './sharedRig.js';
import { loadActualRig } from '../../test/characters/loadActualRig.js';

const root = new URL('../../../../', import.meta.url);
const output = new URL('../../public/models/characters/animations/', import.meta.url);
const read = (name) => readFileSync(new URL(name, output));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('manifest.json'));
const binding = JSON.parse(read('source-bind.json'));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/animation-clips.json', import.meta.url)));
const frozen = {
  thalune: ['d1fc6986ad5fc164279e12a299aa6bc62b499084a6e8afee1b87315832c8d74b', 'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27'],
  ixari: ['9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c', '1236d2bafed2d8a2c58eeb4ba6cf73501c669fbc7d7eda5d1fb3c260d34d243b'],
  ulgani: ['06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b', '9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682'],
};
const probes = ['head', 'hand_L', 'hand_R', 'foot_L', 'foot_R', 'pelvis'];
const proof = {
  scope: 'CPU actual exported animation tracks and actual frozen skinned bodies; no rendered appearance/performance/runtime acceptance',
  compatibility: [],
  contacts: [],
  loopSeams: [],
  distinctness: [],
};
const loaded = new Map();
let library, clips, source;

function reset(data) {
  for (const b of data.profile.bones) {
    const node = data.root.getObjectByName(b.name);
    node.position.fromArray(b.position);
    node.quaternion.fromArray(b.quaternion);
    node.scale.fromArray(b.scale);
  }
  data.root.updateMatrixWorld(true);
}

function player(data, clip) {
  reset(data);
  const mixer = new AnimationMixer(data.root);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  return {
    at(time) {
      // Restart makes arbitrary diagnostic time order independent of clamping.
      action.reset().play();
      mixer.setTime(time);
      data.root.updateMatrixWorld(true);
      return Object.fromEntries(probes.map((name) => [name, data.root.getObjectByName(name).getWorldPosition(new Vector3()).toArray()]));
    },
    stop() {
      mixer.stopAllAction();
      mixer.uncacheRoot(data.root);
      reset(data);
    },
  };
}

beforeAll(async () => {
  const bytes = read(manifest.library);
  library = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  clips = new Map(library.animations.map((clip) => [clip.name, clip]));
  for (const species of Object.keys(frozen)) {
    const gltf = await loadActualRig(species);
    const profile = captureSharedRigBindProfile({ id: `characters/${species}@${gltf.proof.exportSha256}`, root: gltf.scene });
    const meshes = [];
    gltf.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const count = mesh.geometry.attributes.position.count;
      meshes.push({ mesh, indices: [0, Math.floor(count / 3), Math.floor((count * 2) / 3), count - 1] });
    });
    loaded.set(species, {
      root: gltf.scene,
      profile,
      meshes,
      proof: {
        ...gltf.proof,
        gltfMeshNodes: gltf.parser.json.nodes.filter((node) => node.mesh !== undefined).map(({ name, mesh, skin }) => ({ name, mesh, skin })),
        loadedSkinnedMeshNodes: meshes.map(({ mesh }) => mesh.name),
      },
    });
  }
  source = loaded.get('thalune');
});

afterAll(() => {
  if (env.ANIMATION_PROOF_PATH)
    writeFileSync(
      env.ANIMATION_PROOF_PATH,
      JSON.stringify(
        {
          ...proof,
          librarySha256: hash(read(manifest.library)),
          sourceSha256: manifest.authoredSourceSha256,
          exports: [...loaded.values()].map((data) => data.proof),
        },
        null,
        2,
      ) + '\n',
    );
});

describe('saved authored animation library', () => {
  it('preserves frozen bodies, complete canonical source bind, and source/library identity', () => {
    for (const [species, [blendHash, exportHash]] of Object.entries(frozen)) {
      expect(hash(readFileSync(new URL(`assets/blend/characters/${species}.blend`, root)))).toBe(blendHash);
      expect(loaded.get(species).proof.exportSha256).toBe(exportHash);
      expect(loaded.get(species).meshes).toHaveLength(species === 'ulgani' ? 176 : 216);
    }
    expect(binding.profile).toEqual(source.profile);
    expect(binding.profile.bones).toHaveLength(70);
    expect(manifest.sourceProfileId).toBe(source.profile.id);
    expect(hash(read('source-bind.json'))).toBe(manifest.sourceBindManifestSha256);
    expect(hash(read(manifest.library))).toBe(manifest.librarySha256);
    expect(hash(readFileSync(new URL(manifest.authoredSource, root)))).toBe(manifest.authoredSourceSha256);
  });

  it('matches the independently reviewed 42-clip name/family/timing/loop fixture and glTF metadata', () => {
    expect([...clips.keys()].sort()).toEqual(Object.keys(fixture).sort());
    expect(manifest.clips).toHaveLength(42);
    for (const meta of manifest.clips) {
      expect([meta.family, meta.duration, meta.loop]).toEqual(fixture[meta.name]);
      expect(meta.sourceProfileId).toBe(source.profile.id);
      const clip = clips.get(meta.name);
      expect(clip.duration).toBeCloseTo(meta.duration, 5);
      const exported = library.parser.json.animations.find((a) => a.name === meta.name);
      expect(exported.extras).toEqual({ ...meta, sourceProfileId: source.profile.id });
      expect(clip.blendMode).toBe(NormalAnimationBlendMode);
      for (const track of clip.tracks) {
        expect(track.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*\.(position|quaternion)$/);
        expect(track.getInterpolation()).toBe(InterpolateLinear);
        expect([...track.times, ...track.values].every(Number.isFinite)).toBe(true);
        expect(track.times.length).toBe(Math.round(meta.duration * 60) + 1);
      }
      expect(() =>
        adaptSharedRigClip({ clip, sourceProfileId: manifest.sourceProfileId, sourceProfile: source.profile, targetProfile: source.profile }),
      ).not.toThrow();
    }
  });

  it('has continuous loop endpoints, bounded sampled rotation steps and anchored root translations', () => {
    for (const meta of manifest.clips) {
      const clip = clips.get(meta.name);
      let maxSeam = 0,
        maxRotationStep = 0;
      for (const track of clip.tracks) {
        const width = track.getValueSize(),
          values = track.values;
        if (track.name.endsWith('.quaternion')) {
          const first = new Quaternion().fromArray(values),
            last = new Quaternion().fromArray(values, values.length - 4);
          if (meta.loop) maxSeam = Math.max(maxSeam, first.normalize().angleTo(last.normalize()));
          for (let i = 4; i < values.length; i += 4)
            maxRotationStep = Math.max(
              maxRotationStep,
              new Quaternion()
                .fromArray(values, i - 4)
                .normalize()
                .angleTo(new Quaternion().fromArray(values, i).normalize()),
            );
        } else if (meta.loop) {
          for (let i = 0; i < width; i++) maxSeam = Math.max(maxSeam, Math.abs(values[i] - values[values.length - width + i]));
        }
        if (track.name === 'root.position') expect(Math.max(...Array.from(values, Math.abs))).toBeLessThan(1e-6);
      }
      if (meta.loop) {
        expect(maxSeam, meta.name).toBeLessThan(2e-5);
        proof.loopSeams.push({ clip: meta.name, maxSeam });
      }
      expect(maxRotationStep, meta.name).toBeLessThan(0.5); // No one-frame >29 degree skeletal pop at 60 Hz.
    }
  });

  it('retains stance ground height and travel direction in actual exported locomotion', () => {
    for (const meta of manifest.clips.filter((c) => c.direction)) {
      for (const [species, data] of loaded) {
        reset(data);
        const grounds = Object.fromEntries(['L', 'R'].map((side) => [side, data.root.getObjectByName(`foot_${side}`).getWorldPosition(new Vector3()).y]));
        const adapted = adaptSharedRigClip({
          clip: clips.get(meta.name),
          sourceProfileId: manifest.sourceProfileId,
          sourceProfile: source.profile,
          targetProfile: data.profile,
        });
        const playback = player(data, adapted);
        let maxHeightError = 0,
          maxReverseStep = 0,
          minimumTravel = Infinity;
        for (const [side, spans] of Object.entries(meta.contacts)) {
          const ground = grounds[side];
          for (const [a, b] of spans) {
            const projections = [];
            for (let phase = a; phase <= b + 1e-7; phase += (b - a) / 20) {
              const p = playback.at(Math.min(phase, b) * meta.duration)[`foot_${side}`];
              maxHeightError = Math.max(maxHeightError, Math.abs(p[1] - ground));
              projections.push(p.reduce((sum, v, i) => sum + v * meta.direction[i], 0));
            }
            const travel = projections[0] - projections.at(-1);
            minimumTravel = Math.min(minimumTravel, travel);
            for (let i = 1; i < projections.length; i++) maxReverseStep = Math.max(maxReverseStep, projections[i] - projections[i - 1]);
          }
        }
        playback.stop();
        proof.contacts.push({
          clip: meta.name,
          species,
          maxHeightErrorM: maxHeightError,
          maxReverseStepM: maxReverseStep,
          minimumStanceTravelM: minimumTravel,
        });
        // Bind-relative adaptation preserves proportions, not species-specific IK.
        // Keep its measured residual explicit for the later contact/visual grade.
        expect(maxHeightError, `${meta.name}/${species}`).toBeLessThan(species === 'thalune' ? 0.002 : 0.01);
        expect(maxReverseStep, `${meta.name}/${species}`).toBeLessThan(0.002);
        expect(minimumTravel, `${meta.name}/${species}`).toBeGreaterThan(0.2);
      }
    }
  });

  it('contains distinct normalized-time skeletal motion rather than repeated aliases', () => {
    const signatures = new Map();
    for (const clip of clips.values()) {
      const playback = player(source, clip),
        signature = [];
      for (const phase of [0, 0.16, 0.33, 0.5, 0.67, 0.84, 1]) {
        signature.push(...Object.values(playback.at(phase * clip.duration)).flat());
        for (const name of probes) {
          const q = source.root.getObjectByName(name).getWorldQuaternion(new Quaternion());
          signature.push(...q.toArray().map((v) => (q.w < 0 ? -v : v)));
        }
      }
      playback.stop();
      signatures.set(clip.name, signature);
    }
    let closest = { distanceM: Infinity };
    for (const [a, x] of signatures)
      for (const [b, y] of signatures) {
        if (a >= b) continue;
        const distanceM = Math.max(...x.map((v, i) => Math.abs(v - y[i])));
        if (distanceM < closest.distanceM) closest = { a, b, distanceM };
        expect(distanceM, `${a}/${b}`).toBeGreaterThan(0.008);
      }
    proof.distinctness.push(closest);
  });

  it('exports bilateral gravitic lift, unilateral thermal reach and radial resonance spread', () => {
    const at = (name, phase) => {
      const clip = clips.get(name),
        playback = player(source, clip),
        result = playback.at(phase * clip.duration);
      playback.stop();
      return result;
    };
    const lift = at('cast_gravitic', 0.55),
      lance = at('cast_thermal', 0.46),
      pulse = at('cast_resonance', 0.66);
    expect(Math.min(lift.hand_L[1], lift.hand_R[1])).toBeGreaterThan(1.35);
    expect(lance.hand_R[2] - lance.hand_L[2]).toBeGreaterThan(0.2);
    expect(pulse.hand_L[0] - pulse.hand_R[0]).toBeGreaterThan(0.9);
  });

  it('adapts every exported clip to all three frozen actual bodies with finite nonzero sampled deformation across all four LODs', () => {
    for (const clip of clips.values()) {
      const original = JSON.stringify(clip.toJSON());
      for (const [species, data] of loaded) {
        const adapted = adaptSharedRigClip({ clip, sourceProfileId: manifest.sourceProfileId, sourceProfile: source.profile, targetProfile: data.profile });
        const playback = player(data, adapted);
        const initial = data.meshes.flatMap(({ mesh, indices }) => indices.map((i) => mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld)));
        let maxMovement = 0,
          maxRelativeRotationError = 0;
        for (const phase of [0.16, 0.33, 0.5, 0.67, 0.84]) {
          playback.at(phase * clip.duration);
          let index = 0;
          for (const { mesh, indices } of data.meshes)
            for (const i of indices) {
              const p = mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld);
              expect(p.toArray().every(Number.isFinite)).toBe(true);
              maxMovement = Math.max(maxMovement, p.distanceTo(initial[index++]));
            }
          for (const track of clip.tracks.filter((t) => t.name.endsWith('.quaternion'))) {
            const name = track.name.split('.')[0],
              targetBone = data.root.getObjectByName(name);
            const sourceBind = source.profile.bones.find((b) => b.name === name),
              targetBind = data.profile.bones.find((b) => b.name === name);
            const q = new Quaternion().fromArray(track.createInterpolant().evaluate(phase * clip.duration)).normalize();
            const expected = new Quaternion()
              .fromArray(targetBind.quaternion)
              .multiply(new Quaternion().fromArray(sourceBind.quaternion).invert())
              .multiply(q)
              .normalize();
            maxRelativeRotationError = Math.max(maxRelativeRotationError, targetBone.quaternion.clone().normalize().angleTo(expected));
          }
        }
        playback.stop();
        expect(maxRelativeRotationError, `${clip.name}/${species}`).toBeLessThan(2e-6);
        expect(maxMovement, `${clip.name}/${species}`).toBeGreaterThan(0.005);
        expect(maxMovement, `${clip.name}/${species}`).toBeLessThan(2.5);
        proof.compatibility.push({
          clip: clip.name,
          species,
          meshNodes: data.meshes.length,
          lods: 4,
          samplesPerPose: data.meshes.length * 4,
          maxMovementM: maxMovement,
          maxRelativeRotationErrorRad: maxRelativeRotationError,
        });
      }
      expect(JSON.stringify(clip.toJSON())).toBe(original);
    }
  }, 120000);
});
