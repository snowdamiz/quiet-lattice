# Shared character clip contract

`sharedRig.js` adapts a Three `AnimationClip` between the three exported bind profiles. T02 authors the shared clips; T04 owns loading, the animation state machine and playback integration. This module does not claim those later features are integrated.

Capture each profile from the canonical body export **immediately after GLTFLoader resolves, before a mixer, pose or bone edit**. The snapshot copies the loaded bone names, direct bone parents and local TRS; it does not guess a canonical skeleton or infer a bind pose from an animated scene. It includes the export's neutral helper joint as loaded. Keep the snapshot and clip source ID with the animation library. IDs should identify the exact versioned source body export, for example `characters/thalune@<GLB SHA256>`. Clips may animate a subset of bones: the source profile is the complete canonical body rig, not a profile inferred from the channels present in a standalone clip file.

```js
import { captureSharedRigBindProfile, adaptSharedRigClip } from './sharedRig.js';

const sourceProfile = captureSharedRigBindProfile({ id: sourceExportId, root: sourceGLTF.scene });
const targetProfile = captureSharedRigBindProfile({ id: targetExportId, root: targetGLTF.scene });
// The descriptor's ID travels with the authored clip; it must match its captured source.
const descriptor = { clip: authoredClip, sourceProfileId: sourceExportId };
const adapted = adaptSharedRigClip({ ...descriptor, sourceProfile, targetProfile });
targetMixer.clipAction(adapted).play();
```

The returned clip owns new tracks, times and values. Adaptation does not edit either profile, either rig or the source clip. World/root placement and locomotion policy remain the caller's responsibility.

Supported tracks use unique `boneName.position`, `boneName.quaternion` or `boneName.scale` bindings with LINEAR or STEP interpolation. They must be normal-blend absolute local TRS clips. Bone names/hierarchy must agree; bind joint orientations must agree within `1e-4` radians, allowing the actual exports' small numeric drift. Names use letters, digits and underscores, beginning with a letter or underscore. Transforms must be finite, quaternions unit length within `1e-5`, and scale components positive. Times must be finite, nonnegative, strictly increasing and within the clip duration. Empty clips and one-key clips are supported.

For each local key:

- Translation: `targetBind + (key - sourceBind)`.
- Rotation: `targetBindQuaternion * inverse(sourceBindQuaternion) * keyQuaternion`, normalized. Thus a local post-bind rotation keeps the same relative change. Quaternion LINEAR interpolation uses Three's slerp.
- Scale: `targetBindScale * (keyScale / sourceBindScale)`, componentwise.

Morph/object/component paths, additive clips, cubic/custom interpolation, incompatible rigs, unknown source IDs/bones, duplicate channels and malformed/out-of-range data throw. They are never passed through silently. Unsupported features require a separately reviewed contract before T02/T04 consumes them; this is not an IK, arbitrary-rig or full glTF retargeting framework.

CPU compatibility test:

```sh
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 pnpm exec vitest run packages/client/src/characters/sharedRig.test.js --maxWorkers=1 --no-file-parallelism
```

The test loads all three actual meshopt GLBs. Texture/material loading alone is removed in RAM; node, geometry, skin, morph, compression metadata and binary bytes are asserted unchanged. It reproduces the absolute-translation failure, checks every target bone and deterministic vertex samples across all 96 mesh nodes/four LODs for all nine source/target pairs, and verifies nonneutral/interpolated TRS, roundtrips, immutable inputs and rejection cases. Set `SHARED_RIG_PROOF_PATH` to save the measured CPU pose proof. It provides no texture, rendered appearance, performance or integrated-playback acceptance.
