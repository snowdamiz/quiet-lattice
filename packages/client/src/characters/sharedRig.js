import {
  AnimationClip,
  InterpolateDiscrete,
  InterpolateLinear,
  NormalAnimationBlendMode,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';

const profiles = new WeakSet();
const fail = (message) => {
  throw new Error(`Shared rig: ${message}`);
};
const finite = (values) => values.every(Number.isFinite);
const quaternion = (values) => new Quaternion().fromArray(values).normalize();

/** Snapshot immediately after GLTFLoader, before any mixer/pose changes. Use a versioned asset ID. */
export function captureSharedRigBindProfile({ id, root }) {
  if (typeof id !== 'string' || !id.trim()) fail('profile ID must be nonempty');
  if (!root?.traverse) fail('profile needs a loaded neutral rig');
  const bones = [];
  root.traverse((node) => {
    if (!node.isBone) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.name)) fail(`unsupported bone name ${node.name}`);
    const position = node.position.toArray(),
      rotation = node.quaternion.toArray(),
      scale = node.scale.toArray();
    if (!finite([...position, ...rotation, ...scale]) || scale.some((x) => x <= 0)) fail(`invalid bind TRS for ${node.name}`);
    if (Math.abs(Math.hypot(...rotation) - 1) > 1e-5) fail(`nonunit bind quaternion for ${node.name}`);
    bones.push(
      Object.freeze({
        name: node.name,
        parent: node.parent?.isBone ? node.parent.name : null,
        position: Object.freeze(position),
        quaternion: Object.freeze(rotation),
        scale: Object.freeze(scale),
      }),
    );
  });
  const names = new Set(bones.map((bone) => bone.name));
  if (!bones.length || names.size !== bones.length) fail('empty rig or duplicate bone names');
  if (bones.some((bone) => bone.parent !== null && !names.has(bone.parent))) fail('profile root excludes a bone parent');
  const profile = Object.freeze({ id, bones: Object.freeze(bones) });
  profiles.add(profile);
  return profile;
}

/** Adapt absolute local bone TRS keys, preserving their source-bind-relative motion. */
export function adaptSharedRigClip({ clip, sourceProfileId, sourceProfile, targetProfile }) {
  if (!profiles.has(sourceProfile) || !profiles.has(targetProfile)) fail('capture profiles from loaded neutral rigs');
  if (sourceProfileId !== sourceProfile.id) fail('clip source profile ID does not match');
  const source = new Map(sourceProfile.bones.map((bone) => [bone.name, bone]));
  const target = new Map(targetProfile.bones.map((bone) => [bone.name, bone]));
  if (source.size !== target.size) fail('incompatible bone hierarchy');
  for (const [name, bone] of source) {
    const peer = target.get(name);
    if (!peer || peer.parent !== bone.parent) fail(`incompatible bone hierarchy at ${name}`);
    if (quaternion(bone.quaternion).angleTo(quaternion(peer.quaternion)) > 1e-4) fail(`incompatible joint axes at ${name}`);
  }
  if (!(clip instanceof AnimationClip) || !Number.isFinite(clip.duration) || clip.duration < 0) fail('invalid animation clip');
  if (clip.blendMode !== NormalAnimationBlendMode) fail('only absolute normal-blend clips are supported');
  const channels = new Set();
  const tracks = clip.tracks.map((track) => {
    if (!(track instanceof VectorKeyframeTrack || track instanceof QuaternionKeyframeTrack)) fail('unsupported or malformed track type');
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\.(position|quaternion|scale)$/.exec(track.name);
    if (!match) fail(`unsupported channel ${track.name}`);
    const [, name, property] = match,
      bind = source.get(name),
      peer = target.get(name);
    if (!bind || !peer) fail(`unknown bone ${name}`);
    if (channels.has(track.name)) fail(`duplicate channel ${track.name}`);
    channels.add(track.name);
    const rotation = property === 'quaternion',
      width = rotation ? 4 : 3;
    if (!(rotation ? track instanceof QuaternionKeyframeTrack : track instanceof VectorKeyframeTrack)) fail(`wrong track type for ${track.name}`);
    const interpolation = track.getInterpolation();
    if (interpolation !== InterpolateLinear && interpolation !== InterpolateDiscrete) fail(`unsupported interpolation for ${track.name}`);
    const factory = interpolation === InterpolateLinear ? track.InterpolantFactoryMethodLinear : track.InterpolantFactoryMethodDiscrete;
    if (track.createInterpolant !== factory) fail(`unsupported interpolation factory for ${track.name}`);
    const times = Array.from(track.times),
      values = Array.from(track.values);
    if (!times.length || values.length !== times.length * width || !finite(times) || !finite(values)) fail(`malformed track ${track.name}`);
    if (times.some((time, i) => time < 0 || time > clip.duration || (i > 0 && time <= times[i - 1]))) fail(`invalid key times for ${track.name}`);
    const converted = [];
    const correction = rotation ? quaternion(peer.quaternion).multiply(quaternion(bind.quaternion).invert()) : null;
    for (let offset = 0; offset < values.length; offset += width) {
      const key = values.slice(offset, offset + width);
      if (rotation) {
        if (Math.abs(Math.hypot(...key) - 1) > 1e-5) fail(`nonunit rotation key for ${track.name}`);
        converted.push(...correction.clone().multiply(quaternion(key)).normalize().toArray());
      } else if (property === 'position') {
        converted.push(...key.map((value, i) => peer.position[i] + (value - bind.position[i])));
      } else {
        if (key.some((value) => value <= 0)) fail(`nonpositive scale key for ${track.name}`);
        converted.push(...key.map((value, i) => peer.scale[i] * (value / bind.scale[i])));
      }
    }
    if (!finite(converted)) fail(`nonfinite adapted values for ${track.name}`);
    const adapted = rotation
      ? new QuaternionKeyframeTrack(track.name, times, converted, interpolation)
      : new VectorKeyframeTrack(track.name, times, converted, interpolation);
    if (!finite(Array.from(adapted.values))) fail(`adapted track exceeds float32 range for ${track.name}`);
    return adapted;
  });
  return new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}
