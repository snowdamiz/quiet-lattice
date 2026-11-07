"""Read actual saved coordinates, active UVs and connected surface areas; never save."""
import bpy,sys,json,hashlib,math
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
SRC=ROOT/'assets/blend/hulls/lark.blend';before=hashlib.sha256(SRC.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SRC))
roles={'Hull','Accent','Trim','Dark'};report={'input_sha256':before,'density':[],'components':[],'images':[],'objects':[]}
for c in bpy.data.collections:
 if not c.name.endswith('_LOD0'):continue
 for o in c.objects:
  if o.type!='MESH':continue
  m=o.data;m.calc_loop_triangles();uv=m.uv_layers.active
  report['objects'].append({'name':o.name,'matrix':[list(r) for r in o.matrix_world],'attributes':list(m.attributes.keys()),'vertices':len(m.vertices),'polygons':len(m.polygons),'materials':[s.material.name for s in o.material_slots]})
  # Union only faces of the same role with shared vertex indices; retain closed primitive parts.
  parent=list(range(len(m.vertices)))
  def root(a):
   while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
   return a
  for e in m.edges:
   a,b=e.vertices;parent[root(a)]=root(b)
  groups={};buckets={}
  for t in m.loop_triangles:
   mat=m.materials[t.material_index];role=mat.get('engine_name',mat.name)
   if role not in roles:continue
   p=[o.matrix_world@m.vertices[i].co for i in t.vertices];u=[uv.data[i].uv for i in t.loops]
   area=(p[1]-p[0]).cross(p[2]-p[0]).length*.5;ua=abs((u[1].x-u[0].x)*(u[2].y-u[0].y)-(u[2].x-u[0].x)*(u[1].y-u[0].y))*.5
   b=buckets.setdefault(role,{'area':0,'uv_area':0,'edges':[],'triangles':0});b['area']+=area;b['uv_area']+=ua;b['triangles']+=1
   for a,k in [(0,1),(1,2),(2,0)]:
    length=(p[a]-p[k]).length;span=(u[a]-u[k]).length
    if length>1e-4 and span>1e-8:b['edges'].append(4096*span/length)
   g=groups.setdefault((root(t.vertices[0]),role),{'vertices':set(),'area':0,'tris':0});g['vertices'].update(t.vertices);g['area']+=area;g['tris']+=1
  for role,b in buckets.items():
   vals=np.array(b.pop('edges'));b.update({'key':c.name+'/'+o.name+'/'+role,'edge_p10_p50_p90':np.percentile(vals,[10,50,90]).tolist(),'area_px_per_m':4096*math.sqrt(b['uv_area']/b['area'])});report['density'].append(b)
  for (id,role),g in groups.items():
   p=np.array([o.matrix_world@m.vertices[i].co for i in sorted(g.pop('vertices'))]);g.update({'object':o.name,'role':role,'component':id,'min':p.min(0).tolist(),'max':p.max(0).tolist(),'size':np.ptp(p,axis=0).tolist(),'center':p.mean(0).tolist()});report['components'].append(g)
for im in bpy.data.images:
 report['images'].append({'name':im.name,'size':list(im.size),'packed':bool(im.packed_file),'bytes':len(im.packed_file.data) if im.packed_file else 0})
assert before==hashlib.sha256(SRC.read_bytes()).hexdigest()
with (OUT/'red-source-density.json').open('x') as f:json.dump(report,f,indent=2)
print(json.dumps({'density':report['density'],'images':report['images'],'components':len(report['components'])},indent=2))
