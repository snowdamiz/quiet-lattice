import { writeFileSync } from 'node:fs';
import { log } from 'node:console';
import { URL } from 'node:url';
import { loadActualRig } from '../../../../client/test/characters/loadActualRig.js';
import { captureSharedRigBindProfile } from '../../../../client/src/characters/sharedRig.js';

const gltf = await loadActualRig('thalune');
const expected = 'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27';
if (gltf.proof.exportSha256 !== expected) throw new Error('Frozen animation source export changed');
// Capture the entire canonical loaded export before any mixer or pose exists.
const profile = captureSharedRigBindProfile({ id: `characters/thalune@${expected}`, root: gltf.scene });
writeFileSync(
  new URL('../../../../client/public/models/characters/animations/source-bind.json', import.meta.url),
  JSON.stringify({ schema: 1, capturedFrom: 'packages/client/public/models/characters/thalune.glb', exportSha256: expected, profile }, null, 2) + '\n',
);
log('CAPTURED_CANONICAL_BIND', profile.id, profile.bones.length);
