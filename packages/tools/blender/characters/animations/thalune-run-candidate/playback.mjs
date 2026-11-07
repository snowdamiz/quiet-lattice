// Private review instrumentation. No renderer, scene, loader or clock is created.
// The caller supplies a real Review instance and a freshly captured target profile.
export function installAbsolutePlayback({ review, targetProfile }) {
  const content = review.content, engine = review.game.engine;
  const originalRender = engine.render;
  const bones = new Map(targetProfile.bones.map((bind) => {
    const node = content.getObjectByName(bind.name);
    if (!node?.isBone) throw Error('Missing loaded target bone: ' + bind.name);
    return [bind.name, { node, bind }];
  }));
  let tracks = [], duration = 0, time = 0, clipName = null, disposed = false;
  const neutral = () => {
    for (const { node, bind } of bones.values()) {
      node.position.fromArray(bind.position);
      node.quaternion.fromArray(bind.quaternion);
      node.scale.fromArray(bind.scale);
    }
  };
  const sample = () => {
    if (disposed || review.content !== content) throw Error('Playback target changed or disposed');
    neutral();
    for (const { node, property, interpolant } of tracks)
      node[property].fromArray(interpolant.evaluate(time));
    content.updateMatrixWorld(true);
  };
  const wrappedRender = function (...args) {
    // Last instance hook before the existing review renderer. Every frame writes
    // absolute values, including constant and absent channels; no mixer caches.
    sample();
    return originalRender.apply(this, args);
  };
  engine.render = wrappedRender;
  return {
    select(adaptedClip) {
      // adaptSharedRigClip is the validation boundary; only its output is supplied.
      tracks = adaptedClip.tracks.map((track) => {
        const [, name, property] = /^([A-Za-z_][A-Za-z0-9_]*)\.(position|quaternion|scale)$/.exec(track.name);
        return { node: bones.get(name).node, property, interpolant: track.createInterpolant() };
      });
      duration = adaptedClip.duration;
      clipName = adaptedClip.name;
      time = 0;
      sample();
    },
    seek(seconds) {
      // Frame times use the manifest's exact 60Hz duration, while GLTFLoader
      // reports the last Float32 key time. Admit only that rounding tolerance.
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > duration + 1e-6) throw Error('Invalid capture time');
      time = Math.min(seconds, duration);
      sample();
      return { clip: clipName, time, duration };
    },
    dispose() {
      if (disposed) return;
      if (engine.render !== wrappedRender) throw Error('Render hook changed; refusing to overwrite it');
      engine.render = originalRender;
      neutral();
      content.updateMatrixWorld(true);
      disposed = true;
    },
  };
}

// Inject this exact module as a frozen page.evaluate function/module body only
// after standard #review:characters/thalune has settled in capture/live-off mode.
export async function prepareStandardReview({ review, manifest, binding, peopleHashes }) {
  const { captureSharedRigBindProfile, adaptSharedRigClip } = await import('/src/characters/sharedRig.js');
  const { gltfLoader } = await import('/src/core/Engine.js');
  if (review.file !== 'characters/thalune') throw Error('Canonical source review must load first');
  const sourceProfile = captureSharedRigBindProfile({ id: manifest.sourceProfileId, root: review.content });
  if (JSON.stringify(sourceProfile) !== JSON.stringify(binding.profile)) throw Error('Canonical source profile differs');
  const bytes = await (await fetch('/models/characters/animations/' + manifest.library)).arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== manifest.librarySha256) throw Error('Library bytes differ from readiness');
  const library = await gltfLoader().parseAsync(bytes, '');
  let player = null;
  return {
    async people(species) {
      if (!Object.hasOwn(peopleHashes, species)) throw Error('Unknown people');
      player?.dispose();
      player = null;
      await review.load('characters/' + species);
      const targetProfile = captureSharedRigBindProfile({
        id: 'characters/' + species + '@' + peopleHashes[species], root: review.content,
      });
      review.select(species, species + '_head1');
      player = installAbsolutePlayback({ review, targetProfile });
      this.targetProfile = targetProfile;
    },
    clip(name) {
      const descriptor = manifest.clips.find(c => c.name === name);
      const clip = library.animations.find(c => c.name === name);
      if (!descriptor || !clip || descriptor.sourceProfileId !== sourceProfile.id || !player) throw Error('Unready clip');
      player.select(adaptSharedRigClip({ clip, sourceProfileId: descriptor.sourceProfileId,
        sourceProfile, targetProfile: this.targetProfile }));
    },
    seek(seconds) { return player.seek(seconds); },
    dispose() { player?.dispose(); player = null; },
  };
}
