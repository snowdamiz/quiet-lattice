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
ap.add_argument('--clearance-m', type=float)
ap.add_argument('--spacing-m', type=float, required=True)
a = ap.parse_args(sys.argv[sys.argv.index('--')+1:])
assert hashlib.sha256(Path(a.source).read_bytes()).hexdigest() == a.sha256
bpy.ops.wm.open_mainfile(filepath=a.source, load_ui=False, use_scripts=False)
assert bpy.context.scene.unit_settings.scale_length == 1.0
rows = []
depsgraph = bpy.context.evaluated_depsgraph_get()
evaluated_checks = []
def checked_mesh(obj):
    evaluated = obj.evaluated_get(depsgraph).data
    equal = ([tuple(v.co) for v in evaluated.vertices] == [tuple(v.co) for v in obj.data.vertices]
             and [tuple(p.vertices) for p in evaluated.polygons] == [tuple(p.vertices) for p in obj.data.polygons])
    evaluated_checks.append(dict(object=obj.name,modifiers=[m.type for m in obj.modifiers],
                                 evaluated_geometry_identical=equal))
    assert equal, 'Evaluated canopy geometry changed: inspect before admission'
    return evaluated
for variant in ('lark', 'lark_damaged', 'lark_husked'):
    for lod in range(4):
        objects = bpy.data.collections[f'{variant}_LOD{lod}'].all_objects
        panes = [o for o in objects if o.type == 'MESH' and o.name.startswith('CanopyGlass')]
        frames = [o for o in objects if o.type == 'MESH' and o.name.startswith('CanopyFrame')]
        assert panes and frames, (variant, lod, 'Missing role')
        vertices, faces = [], []
        for o in frames:
            mesh = checked_mesh(o)
            start = len(vertices)
            vertices.extend(o.matrix_world @ v.co for v in mesh.vertices)
            mesh.calc_loop_triangles()
            faces.extend([start+i for i in f.vertices] for f in mesh.loop_triangles)
        tree = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
        for o in panes:
            mesh = checked_mesh(o)
            r = perimeter([tuple(o.matrix_world @ v.co) for v in mesh.vertices],
                          [list(f.vertices) for f in mesh.polygons],
                          lambda p: tree.find_nearest(p)[3], a.clearance_m, a.spacing_m)
            rows.append(dict(variant=variant, lod=lod, object=o.name,
                             frame_triangles=len(faces), **r))
assert hashlib.sha256(Path(a.source).read_bytes()).hexdigest() == a.sha256
Path(a.output).write_text(json.dumps(dict(source_sha256=a.sha256, rows=rows,
    evaluated_checks=evaluated_checks,
    limitation='Surface clearance bound only; no lit grade, overlap or watertightness claim'), indent=2))
