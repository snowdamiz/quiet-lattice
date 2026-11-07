"""Read-only Blender adapter. Run only after parent CPU admission, on a copy."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import bpy
from mathutils.bvhtree import BVHTree
sys.path.insert(0, str(Path(__file__).resolve().parent))
from qualification import perimeter

ap = argparse.ArgumentParser()
ap.add_argument('--source', required=True)
ap.add_argument('--sha256', required=True)
ap.add_argument('--output', required=True)
ap.add_argument('--clearance-m', type=float, required=True)
ap.add_argument('--spacing-m', type=float, required=True)
a = ap.parse_args(sys.argv[sys.argv.index('--')+1:])
assert hashlib.sha256(Path(a.source).read_bytes()).hexdigest() == a.sha256
bpy.ops.wm.open_mainfile(filepath=a.source)
rows = []
for variant in ('lark', 'lark_damaged', 'lark_husked'):
    for lod in range(4):
        objects = bpy.data.collections[f'{variant}_LOD{lod}'].all_objects
        panes = [o for o in objects if o.type == 'MESH' and o.name.startswith('CanopyGlass')]
        frames = [o for o in objects if o.type == 'MESH' and o.name.startswith('CanopyFrame')]
        assert panes and frames, (variant, lod, 'Missing role')
        vertices, faces = [], []
        for o in frames:
            start = len(vertices)
            vertices.extend(o.matrix_world @ v.co for v in o.data.vertices)
            faces.extend([start+i for i in f.vertices] for f in o.data.polygons)
        tree = BVHTree.FromPolygons(vertices, faces)
        for o in panes:
            assert not o.modifiers, 'Evaluate modifiers explicitly before measuring'
            assert all(not f.modifiers for f in frames)
            r = perimeter([tuple(o.matrix_world @ v.co) for v in o.data.vertices],
                          [list(f.vertices) for f in o.data.polygons],
                          lambda p: tree.find_nearest(p)[3], a.clearance_m, a.spacing_m)
            rows.append(dict(variant=variant, lod=lod, object=o.name, **r))
Path(a.output).write_text(json.dumps(dict(source_sha256=a.sha256, rows=rows,
    limitation='Surface clearance bound only; no lit grade, overlap or watertightness claim'), indent=2))
