// Free GPU resources under an object tree, skipping anything in `keep`
// (e.g. the player's ship model, whose geometry is shared by NPC clones and wrecks).
const TEXTURE_KEYS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap'];

export function collectResources(root, set = new Set()) {
  root.traverse((o) => {
    if (o.geometry) set.add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      set.add(m);
      for (const k of TEXTURE_KEYS) if (m[k]) set.add(m[k]);
    }
  });
  return set;
}

export function disposeTree(root, keep = new Set()) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry) && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (keep.has(m) || seen.has(m)) continue;
      seen.add(m);
      for (const k of TEXTURE_KEYS) {
        const t = m[k];
        if (t && !keep.has(t) && !seen.has(t)) {
          seen.add(t);
          t.dispose();
        }
      }
      m.dispose();
    }
    if (o.isInstancedMesh && !seen.has(o)) {
      seen.add(o);
      o.dispose();
    }
  });
}
