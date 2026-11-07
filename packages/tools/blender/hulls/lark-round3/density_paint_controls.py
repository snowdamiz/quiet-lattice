"""Recover only original R3 paint controls from its retained hash-verified source, onto unchanged current geometry."""
import bpy,json,hashlib,math
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107';SRC=ROOT/'assets/blend/hulls/lark.blend'
OID='f73327b3755418a816f18738b94345b68766d92416582e794af90fee5ba5d690';REF=Path('/Users/andreyyurlov/Documents/dev/space/.git/lfs/objects')/OID[:2]/OID[2:4]/OID
assert hashlib.sha256(REF.read_bytes()).hexdigest()==OID and REF.stat().st_size==17638521
assert json.loads((OUT.parent/'authoring.json').read_text())['source_sha256']==OID
before=hashlib.sha256(SRC.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(REF));saved={};metadata={}
for coll in bpy.data.collections:
 if not coll.name.endswith('_LOD0'):continue
 for o in coll.objects:
  if o.type!='MESH' or not o.data.color_attributes.get('PaintColor'):continue
  m=o.data;m.calc_loop_triangles();uv=np.array([u.uv for u in m.uv_layers.active.data],np.float64);color=np.array([a.color for a in m.color_attributes['PaintColor'].data],np.float64);orm=np.array([a.color for a in m.color_attributes['PaintORM'].data],np.float64);ts=np.array([t.loops for t in m.loop_triangles],np.int32)
  role=np.empty(len(m.loops),dtype=np.int32)
  for p in m.polygons:
   r=m.materials[p.material_index].get('engine_name');role[list(p.loop_indices)]=['Hull','Accent','Trim','Dark'].index(r) if r in ['Hull','Accent','Trim','Dark'] else -1
  saved[o.name]={'uv':uv,'color':color,'orm':orm,'triangles':ts,'role':role}
metadata['original_liveries']=json.loads(bpy.data.collections['lark']['liveries'])
bpy.ops.wm.open_mainfile(filepath=str(SRC));arrays={};rows=[]
for coll in bpy.data.collections:
 if not coll.name.endswith('_LOD0'):continue
 for o in coll.objects:
  if o.name not in saved:continue
  m=o.data;s=saved[o.name];lookup={}
  for i,uv in enumerate(s['uv']):lookup[(round(float(uv[0]),7),round(float(uv[1]),7),int(s['role'][i]))]=i
  tree=BVHTree.FromPolygons([Vector((u[0],u[1],0)) for u in s['uv']],s['triangles'].tolist(),all_triangles=True,epsilon=1e-8)
  colors=np.zeros((len(m.loops),4),np.float32);orms=np.ones((len(m.loops),4),np.float32);roles=np.full(len(m.loops),-1,np.int32);direct=fallback=0;max_distance=0;max_outside=0
  for p in m.polygons:
   role=m.materials[p.material_index].get('engine_name');ri=['Hull','Accent','Trim','Dark'].index(role) if role in ['Hull','Accent','Trim','Dark'] else -1
   for li in p.loop_indices:
    uv=m.uv_layers.active.data[li].uv;key=(round(float(uv[0]),7),round(float(uv[1]),7),ri);idx=lookup.get(key);roles[li]=ri
    if idx is not None:colors[li]=s['color'][idx];orms[li]=s['orm'][idx];direct+=1;continue
    nearest,normal,ti,distance=tree.find_nearest(Vector((uv.x,uv.y,0)))
    point=o.matrix_world@m.vertices[m.loops[li].vertex_index].co
    assert o.name.startswith('LandingMechanism') and .4<point.y<1.5 and point.x<-.7,(o.name,li,tuple(point))
    # The retained bisect operation interpolated UVs on non-planar quad edges. Only its new rail corners need this projection.
    assert nearest is not None and distance<.5/4096,(o.name,li,distance)
    ids=s['triangles'][ti];q=s['uv'][ids];matrix=np.vstack((q.T,np.ones(3)));weights=np.linalg.solve(matrix,np.r_[nearest.x,nearest.y,1.])
    assert min(weights)>-.002 and max(weights)<1.002,(o.name,li,weights)
    assert all(s['role'][i]==ri for i in ids),(o.name,li,ri,s['role'][ids])
    colors[li]=weights@s['color'][ids];orms[li]=weights@s['orm'][ids];fallback+=1;max_distance=max(max_distance,distance);max_outside=max(max_outside,float(max(0,-min(weights),max(weights)-1)))
  key=coll.name+'/'+o.name;arrays[key+'/color']=colors;arrays[key+'/orm']=orms;arrays[key+'/roles']=roles
  rows.append({'object':o.name,'collection':coll.name,'direct_uv_correspondences':direct,'barycentric_new_rail_corners':fallback,'max_uv_distance':max_distance,'max_barycentric_outside':max_outside,'color_sha256':hashlib.sha256(colors.tobytes()).hexdigest(),'orm_sha256':hashlib.sha256(orms.tobytes()).hexdigest()})
  print(rows[-1],flush=True)
metadata.update({'current_source_sha256':before,'paint_source':str(REF),'paint_source_sha256':OID,'paint_source_bytes':REF.stat().st_size,'authority':'Original retained R3 editable authoring fields bound by authoring.json and lark-bake-receipt.json; no author.py execution, no geometry restore, no remote access','objects':rows,'current_source_unchanged':hashlib.sha256(SRC.read_bytes()).hexdigest()==before})
np.savez_compressed(OUT/'original-paint-controls.npz',**arrays)
with (OUT/'original-paint-controls.json').open('x') as f:json.dump(metadata,f,indent=2)
assert metadata['current_source_unchanged']
