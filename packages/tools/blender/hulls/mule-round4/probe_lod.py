"""Test premise: collapse ratio predicts mechanical triangle count near LOD3."""
import sys
import json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import revise as r
import bpy
import numpy as np

r.rebuild_lods('', 'mule')
o=bpy.data.objects['R4_Structure_l3'];d=[]
for fs in r.parts(o.data):
    ids={v for f in fs for v in o.data.polygons[f].vertices};co=np.array([o.data.vertices[v].co[:] for v in ids])
    d.append({'tris':sum(len(o.data.polygons[f].vertices)-2 for f in fs),'span':(co.max(0)-co.min(0)).tolist(),'material':o.data.materials[o.data.polygons[fs[0]].material_index].name})
report={'premise':'A .022 decimation ratio gives approximately .022 of original triangles.','actual':r.LOG['lods'], 'parts':d}
(r.OUT/'probe.json').write_text(json.dumps(report,indent=2))
print('PREDICTED',int((128470-25284)*.022),'ACTUAL',r.tris(o),'PARTS',len(d))
print('SMALL',[(threshold,sum(p['tris'] for p in d if max(p['span'])<threshold)) for threshold in [.10,.20,.35,.50,1]])
import bmesh
before=r.tris(o)
bm=bmesh.new();bm.from_mesh(o.data)
dupes=bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
bmesh.ops.dissolve_limit(bm,angle_limit=.06,use_dissolve_boundaries=False,verts=list(bm.verts),edges=list(bm.edges),delimit={'MATERIAL','SEAM','UV'})
bm.to_mesh(o.data);bm.free();print('DISSOLVE',before,r.tris(o))
r.simplify(o,.35);print('AFTER',r.tris(o))
