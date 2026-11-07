"""Restore discrete authored IDs after stock decimation's float interpolation.

Only sub-1e-5 arithmetic drift is admissible. LOD0 and all geometry stay exact.
"""
import bpy
import hashlib
import json
from pathlib import Path
import shutil
import sys
sys.dont_write_bytecode = True
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
records = []

def values(mesh, name, prop, width):
    attr = mesh.attributes[name]
    data = np.empty(len(attr.data) * width, np.float32)
    attr.data.foreach_get(prop, data)
    return data.reshape(-1, width)

def geometry(mesh):
    co = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get('co', co)
    return hashlib.sha256(co.tobytes()).hexdigest()

for path in sorted((ROOT / 'assets/blend/creatures').glob('*.blend')):
    bpy.ops.wm.open_mainfile(filepath=str(path))
    bpy.context.preferences.filepaths.save_version = 0
    shutil.copyfile(path, HERE / 'reports/history' / (path.stem + '-before-lod-attribute-snap.blend'))
    edits = []
    for coll in list(bpy.data.collections):
        if not coll.name.endswith('_LOD0'): continue
        original = list(coll.objects)[0].data
        ids = values(original, '_limb', 'value', 1)[:, 0]
        pivots = values(original, '_pivot', 'vector', 3)
        joints = {i: pivots[np.flatnonzero(ids == i)[0]] for i in np.unique(ids)}
        original_geometry = geometry(original)
        for level in range(1, 4):
            for obj in bpy.data.collections[coll.name[:-1] + str(level)].objects:
                mesh = obj.data
                before = geometry(mesh)
                corrections = {}
                limb = values(mesh, '_limb', 'value', 1)
                for name in ['_limb', '_glow']:
                    data = values(mesh, name, 'value', 1)
                    rounded = np.round(data)
                    error = float(np.abs(data - rounded).max())
                    assert error < 1e-5, (obj.name, name, error)
                    corrections[name] = dict(points=int(np.sum(data != rounded)), maxError=error)
                    mesh.attributes[name].data.foreach_set('value', rounded.ravel())
                pivot = values(mesh, '_pivot', 'vector', 3)
                exact = np.array([joints[i] for i in np.round(limb[:, 0])], np.float32)
                error = float(np.abs(pivot - exact).max())
                assert error < 1e-5, (obj.name, 'joint', error)
                corrections['_pivot'] = dict(points=int(np.sum(np.any(pivot != exact, axis=1))), maxError=error)
                mesh.attributes['_pivot'].data.foreach_set('vector', exact.ravel())
                assert geometry(mesh) == before
                edits.append(dict(object=obj.name, lod=level, geometrySHA256=before, corrections=corrections))
        assert geometry(original) == original_geometry
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    records.append(dict(path=str(path.relative_to(ROOT)), sha256=hashlib.sha256(path.read_bytes()).hexdigest(), edits=edits))
(HERE / 'reports/lod-attribute-snap.json').write_text(json.dumps(records, indent=2) + '\n')
print('Saved discrete LOD attributes in', len(records), 'files; geometry unchanged')
