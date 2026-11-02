import {
  AnimationClip,
  AnimationMixer,
  AdditiveAnimationBlendMode,
  Bone,
  Group,
  InterpolateDiscrete,
  InterpolateSmooth,
  NumberKeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { writeFileSync } from 'node:fs';
import { env } from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adaptSharedRigClip, captureSharedRigBindProfile } from './sharedRig.js';
import { loadActualRig } from '../../test/characters/loadActualRig.js';

function rig(id, x = 0) {
  const root = new Group(),
    hip = new Bone(),
    hand = new Bone();
  hip.name = 'hip';
  hand.name = 'hand';
  hip.position.set(x, 1, 0);
  hand.position.set(0, 0.5 + x, 0);
  hand.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
  root.add(hip);
  hip.add(hand);
  return { root, hip, hand, profile: captureSharedRigBindProfile({ id, root }) };
}

const clip = (tracks, duration = 1) => new AnimationClip('shared', duration, tracks);
const position = (name = 'hip.position') => new VectorKeyframeTrack(name, [0, 1], [0, 1, 0, 0.1, 1.2, -0.3]);
const adapt = (animation, source, target, sourceProfileId = source.id) =>
  adaptSharedRigClip({ clip: animation, sourceProfileId, sourceProfile: source, targetProfile: target });
const arrayClose = (a, b, epsilon = 1e-6) => expect(Math.max(...a.map((x, i) => Math.abs(x - b[i])))).toBeLessThan(epsilon);

describe('shared rig supported contract', () => {
  it('rebases translation offsets, copies clip data and leaves profiles/rigs/input tracks unchanged', () => {
    const a = rig('source'),
      b = rig('target', 0.2),
      input = clip([position()]);
    const original = JSON.stringify({ a: a.profile, b: b.profile, clip: input.toJSON() });
    const output = adapt(input, a.profile, b.profile);
    arrayClose(Array.from(output.tracks[0].values), [0.2, 1, 0, 0.3, 1.2, -0.3]);
    expect(output).not.toBe(input);
    expect(output.tracks[0].times).not.toBe(input.tracks[0].times);
    expect(JSON.stringify({ a: a.profile, b: b.profile, clip: input.toJSON() })).toBe(original);
    expect(a.hip.position.x).toBe(0);
    expect(b.hip.position.x).toBe(0.2);
    expect(() => {
      a.profile.bones[0].position[0] = 4;
    }).toThrow();
  });

  it('preserves noncommuting local rotation and component scale changes, including STEP and one-key clips', () => {
    const a = rig('a'),
      b = rig('b', 0.1);
    b.hand.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.00001));
    a.hand.scale.set(2, 3, 4);
    b.hand.scale.set(3, 4, 5);
    const source = captureSharedRigBindProfile({ id: 'scaled-a', root: a.root });
    const target = captureSharedRigBindProfile({ id: 'scaled-b', root: b.root });
    const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
    const q = a.hand.quaternion.clone().multiply(delta);
    const input = clip(
      [
        new QuaternionKeyframeTrack('hand.quaternion', [0], q.toArray(), InterpolateDiscrete),
        new VectorKeyframeTrack('hand.scale', [0], [2.2, 2.7, 4.8], InterpolateDiscrete),
      ],
      0,
    );
    const output = adapt(input, source, target);
    expect(output.tracks.every((track) => track.getInterpolation() === InterpolateDiscrete)).toBe(true);
    expect(new Quaternion().fromArray(output.tracks[0].values).normalize().angleTo(b.hand.quaternion.clone().multiply(delta).normalize())).toBeLessThan(1e-6);
    arrayClose(Array.from(output.tracks[1].values), [3.3, 3.6, 6]);
    expect(adapt(clip([], 0), source, target).tracks).toEqual([]);
  });

  it('accepts sign-equivalent quaternion keys and bind axes', () => {
    const a = rig('a'),
      b = rig('b');
    b.hand.quaternion.fromArray(b.hand.quaternion.toArray().map((x) => -x));
    const target = captureSharedRigBindProfile({ id: 'sign-target', root: b.root });
    const input = clip([
      new QuaternionKeyframeTrack(
        'hand.quaternion',
        [0],
        a.hand.quaternion.toArray().map((x) => -x),
      ),
    ]);
    expect(
      new Quaternion()
        .fromArray(adapt(input, a.profile, target).tracks[0].values)
        .normalize()
        .angleTo(b.hand.quaternion.clone().normalize()),
    ).toBeLessThan(1e-6);
  });

  it('rejects unknown profile IDs, constructed profiles, unknown bones and incompatible hierarchy/axes', () => {
    const a = rig('a'),
      b = rig('b');
    expect(() => adapt(clip([position()]), a.profile, b.profile, 'wrong')).toThrow(/profile ID/);
    expect(() => adapt(clip([position()]), { ...a.profile }, b.profile)).toThrow(/capture profiles/);
    expect(() => adapt(clip([position('unknown.position')]), a.profile, b.profile)).toThrow(/unknown bone/);
    b.root.add(b.hand);
    expect(() => adapt(clip([]), a.profile, captureSharedRigBindProfile({ id: 'parent', root: b.root }))).toThrow(/hierarchy/);
    const c = rig('c');
    c.hand.quaternion.identity();
    expect(() => adapt(clip([]), a.profile, captureSharedRigBindProfile({ id: 'axes', root: c.root }))).toThrow(/axes/);
  });

  it('rejects duplicate/invalid names and invalid neutral transforms at profile capture', () => {
    const a = rig('a');
    a.hand.name = 'hip';
    expect(() => captureSharedRigBindProfile({ id: 'dup', root: a.root })).toThrow(/duplicate/);
    a.hand.name = 'bad.path';
    expect(() => captureSharedRigBindProfile({ id: 'name', root: a.root })).toThrow(/bone name/);
    a.hand.name = 'hand';
    a.hand.scale.x = 0;
    expect(() => captureSharedRigBindProfile({ id: 'scale', root: a.root })).toThrow(/TRS/);
    expect(() => captureSharedRigBindProfile({ id: '', root: a.root })).toThrow(/ID/);
    expect(() => captureSharedRigBindProfile({ id: 'empty', root: new Group() })).toThrow(/empty rig/);
  });

  it.each(['hip.rotation', 'hip.position[x]', '.bones[hip].position', 'hip.morphTargetInfluences', 'rig/hip.position'])(
    'rejects unsupported binding %s',
    (binding) => {
      const a = rig('a');
      expect(() => adapt(clip([position(binding)]), a.profile, a.profile)).toThrow(/channel/);
    },
  );

  it('rejects additive, duplicate, wrong-type and unsupported interpolation tracks', () => {
    const a = rig('a'),
      run = (input) => adapt(input, a.profile, a.profile);
    const additive = clip([position()]);
    additive.blendMode = AdditiveAnimationBlendMode;
    expect(() => run(additive)).toThrow(/normal-blend/);
    expect(() => run(clip([position(), position()]))).toThrow(/duplicate/);
    expect(() => run(clip([new NumberKeyframeTrack('hip.position', [0], [1])]))).toThrow(/track type/);
    expect(() => run(clip([new VectorKeyframeTrack('hip.quaternion', [0], [0, 0, 0])]))).toThrow(/wrong track type/);
    const smooth = position();
    smooth.setInterpolation(InterpolateSmooth);
    expect(() => run(clip([smooth]))).toThrow(/interpolation/);
    const cubic = position();
    cubic.createInterpolant = () => null;
    expect(() => run(clip([cubic]))).toThrow(/interpolation/);
  });

  it.each([
    { times: [0, 0], values: [0, 1, 0, 0, 1, 0], reason: /key times/ },
    { times: [-1], values: [0, 1, 0], reason: /key times/ },
    { times: [2], values: [0, 1, 0], reason: /key times/ },
    { times: [NaN], values: [0, 1, 0], reason: /malformed/ },
    { times: [0], values: [0, NaN, 0], reason: /malformed/ },
    { times: [0, 1], values: [0, 1, 0], reason: /malformed/ },
  ])('rejects malformed tracks $times/$values', ({ times, values, reason }) => {
    const a = rig('a'),
      track = position();
    track.times = new Float32Array(times);
    track.values = new Float32Array(values);
    expect(() => adapt(clip([track]), a.profile, a.profile)).toThrow(reason);
  });

  it('rejects invalid rotations, nonpositive scales and adapted float32 overflow', () => {
    const a = rig('a');
    expect(() => adapt(clip([new QuaternionKeyframeTrack('hand.quaternion', [0], [0, 0, 0, 2])]), a.profile, a.profile)).toThrow(/nonunit/);
    expect(() => adapt(clip([new VectorKeyframeTrack('hand.scale', [0], [0, 1, 1])]), a.profile, a.profile)).toThrow(/nonpositive/);
    const b = rig('b');
    b.hand.scale.setScalar(1e30);
    const target = captureSharedRigBindProfile({ id: 'large', root: b.root });
    expect(() => adapt(clip([new VectorKeyframeTrack('hand.scale', [0], [1e30, 1, 1])]), a.profile, target)).toThrow(/float32/);
  });
});

describe('all three frozen actual exports', () => {
  const loaded = new Map();
  const proof = { unadaptedTranslations: [], adaptedNeutral: [], nonneutralMotion: [] };
  afterAll(() => {
    if (env.SHARED_RIG_PROOF_PATH)
      writeFileSync(
        env.SHARED_RIG_PROOF_PATH,
        JSON.stringify(
          {
            ...proof,
            exports: Array.from(loaded.values(), (data) => data.proof),
            coverage:
              'All96 skinned mesh nodes/all four LODs per export;deterministic vertex samples plus every bone localTRS. CPU-only,texture loading omitted only inRAM.',
          },
          null,
          2,
        ) + '\n',
      );
  });
  beforeAll(async () => {
    for (const species of ['thalune', 'ixari', 'ulgani']) {
      const gltf = await loadActualRig(species),
        root = gltf.scene;
      const profile = captureSharedRigBindProfile({ id: `${species}@${gltf.proof.exportSha256}`, root });
      const samples = [];
      root.traverse((mesh) => {
        if (!mesh.isSkinnedMesh) return;
        for (let i = 0; i < mesh.geometry.attributes.position.count; i += Math.max(1, Math.floor(mesh.geometry.attributes.position.count / 64)))
          samples.push({ mesh, index: i, rest: mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld) });
      });
      loaded.set(species, { root, profile, samples, proof: gltf.proof });
    }
  });

  const reset = ({ root, profile }) => {
    for (const bone of profile.bones) {
      const node = root.getObjectByName(bone.name);
      node.position.fromArray(bone.position);
      node.quaternion.fromArray(bone.quaternion);
      node.scale.fromArray(bone.scale);
    }
    root.updateMatrixWorld(true);
  };
  const apply = (root, animation, time = 0.5) => {
    const mixer = new AnimationMixer(root);
    mixer.clipAction(animation).play();
    mixer.setTime(time);
    root.updateMatrixWorld(true);
    return mixer;
  };
  const shift = (data) =>
    Math.max(...data.samples.map(({ mesh, index, rest }) => rest.distanceTo(mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld))));
  const neutral = (profile) =>
    clip(
      profile.bones.flatMap((bone) =>
        ['position', 'quaternion', 'scale'].map((property) =>
          property === 'quaternion'
            ? new QuaternionKeyframeTrack(`${bone.name}.${property}`, [0], bone[property])
            : new VectorKeyframeTrack(`${bone.name}.${property}`, [0], bone[property]),
        ),
      ),
    );

  it('retains exact nontexture geometry/skin/morph/node/BIN inputs while loading on CPU', () => {
    for (const data of loaded.values()) {
      expect(data.proof.geometrySkinMorphNodeAndCompressionJsonUnchanged).toBe(true);
      expect(data.proof.binaryBytesUnchanged).toBe(true);
      expect(data.profile.bones.length).toBe(70); // 69 authored joints plus the export neutral helper.
      expect(data.samples.length).toBeGreaterThan(5000);
    }
  });

  it('demonstrates the old failure and preserves every target bone and sampled rest vertices after adaptation', () => {
    const source = loaded.get('thalune');
    const translations = clip(source.profile.bones.map((bone) => new VectorKeyframeTrack(`${bone.name}.position`, [0], bone.position)));
    for (const [species, target] of loaded) {
      const mixer = apply(target.root, translations),
        before = shift(target);
      proof.unadaptedTranslations.push({ species, samples: target.samples.length, maxShiftM: before });
      mixer.stopAllAction();
      reset(target);
      if (species === 'thalune') expect(before).toBeLessThan(2e-6);
      else expect(before).toBeGreaterThan(0.05);
    }
    for (const source of loaded.values())
      for (const target of loaded.values()) {
        const mixer = apply(target.root, adapt(neutral(source.profile), source.profile, target.profile));
        const maxVertexShiftM = shift(target);
        let maxBoneTranslationM = 0,
          maxBoneRotationRad = 0,
          maxBoneScale = 0;
        for (const bone of target.profile.bones) {
          const node = target.root.getObjectByName(bone.name);
          maxBoneTranslationM = Math.max(maxBoneTranslationM, node.position.distanceTo(new Vector3().fromArray(bone.position)));
          maxBoneRotationRad = Math.max(
            maxBoneRotationRad,
            node.quaternion.clone().normalize().angleTo(new Quaternion().fromArray(bone.quaternion).normalize()),
          );
          maxBoneScale = Math.max(maxBoneScale, node.scale.distanceTo(new Vector3().fromArray(bone.scale)));
        }
        proof.adaptedNeutral.push({
          source: source.profile.id,
          target: target.profile.id,
          samples: target.samples.length,
          bones: target.profile.bones.length,
          maxVertexShiftM,
          maxBoneTranslationM,
          maxBoneRotationRad,
          maxBoneScale,
        });
        expect(maxVertexShiftM).toBeLessThan(2e-6);
        expect(maxBoneTranslationM).toBeLessThan(2e-6);
        expect(maxBoneRotationRad).toBeLessThan(2e-6);
        expect(maxBoneScale).toBeLessThan(2e-6);
        mixer.stopAllAction();
        reset(target);
      }
  });

  it('preserves nonneutral relative TRS and interpolated motion for all nine source/target pairs', () => {
    for (const source of loaded.values()) {
      const bone = source.profile.bones.find((bone) => bone.name === 'lowerarm_L');
      const bindQ = new Quaternion().fromArray(bone.quaternion),
        delta = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.6);
      const animation = clip([
        new VectorKeyframeTrack('lowerarm_L.position', [0, 1], [...bone.position, ...bone.position.map((x, i) => x + [0.03, 0.02, -0.01][i])]),
        new QuaternionKeyframeTrack('lowerarm_L.quaternion', [0, 1], [...bone.quaternion, ...bindQ.clone().multiply(delta).toArray()]),
        new VectorKeyframeTrack('lowerarm_L.scale', [0, 1], [...bone.scale, ...bone.scale.map((x, i) => x * [1.1, 0.9, 1.05][i])]),
      ]);
      const original = JSON.stringify(animation.toJSON());
      for (const target of loaded.values()) {
        const targetBind = target.profile.bones.find((bone) => bone.name === 'lowerarm_L'),
          adapted = adapt(animation, source.profile, target.profile);
        const mixer = apply(target.root, adapted),
          node = target.root.getObjectByName('lowerarm_L');
        arrayClose(
          node.position.toArray(),
          targetBind.position.map((x, i) => x + [0.015, 0.01, -0.005][i]),
        );
        arrayClose(
          node.scale.toArray(),
          targetBind.scale.map((x, i) => x * [1.05, 0.95, 1.025][i]),
        );
        const expected = new Quaternion().fromArray(targetBind.quaternion).normalize().multiply(new Quaternion().identity().slerp(delta, 0.5));
        const rotationErrorRad = node.quaternion.clone().normalize().angleTo(expected.normalize()),
          maxVertexShiftM = shift(target);
        expect(rotationErrorRad).toBeLessThan(2e-6);
        expect(maxVertexShiftM).toBeGreaterThan(0.01);
        proof.nonneutralMotion.push({
          source: source.profile.id,
          target: target.profile.id,
          timeSeconds: 0.5,
          rotationErrorRad,
          maxVertexShiftM,
          translationOffset: node.position.toArray().map((x, i) => x - targetBind.position[i]),
          scaleRatio: node.scale.toArray().map((x, i) => x / targetBind.scale[i]),
        });
        const roundtrip = adapt(adapted, target.profile, source.profile);
        for (let i = 0; i < animation.tracks.length; i++) arrayClose(Array.from(roundtrip.tracks[i].values), Array.from(animation.tracks[i].values));
        mixer.stopAllAction();
        reset(target);
      }
      expect(JSON.stringify(animation.toJSON())).toBe(original);
    }
  });
});
