"""Use retained canonical chart seams as reference; measure conservative visibility budget."""
import bpy,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
VIS=json.loads((OUT/'visibility-inventory.json').read_text());GROUPS=json.loads((OUT/'congruent-part-candidates.json').read_text())
old=Path('/Users/andreyyurlov/Documents/dev/space/.git/lfs/objects/66/69/6669a881185017e20d35ac923939fc7586ee4e0bd11c200b598ab6fbc026b3a0')
bpy.ops.wm.open_mainfile(filepath=str(old));legacy={}
for name in ['Body','Body_dmg','Body_husk']:
 m=bpy.data.objects[name].data;legacy[name]={'vertex_count':len(m.vertices),'loop_vertex':[l.vertex_index for l in m.loops],'uv':[list(l.uv) for l in m.uv_layers.active.data],'faces':[(list(p.vertices),p.material_index) for p in m.polygons]}
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend/hulls/lark.blend'))
report={}
for c in bpy.data.collections:
 if not c.name.endswith('_LOD0'):continue
 reprs={(g['representative']['name'],g['representative']['component'],g['representative']['role']) for g in GROUPS[c.name]}
 stats={};details=[]
 for o in c.objects:
  if o.type!='MESH' or not o.data.uv_layers.active or o.name not in VIS[c.name]['objects']:continue
  m=o.data;uv=np.array([l.uv for l in m.uv_layers.active.data],dtype=np.float64)
  if o.name in legacy:
   old=legacy[o.name];assert [l.vertex_index for l in m.loops[:len(old['loop_vertex'])]]==old['loop_vertex']
   for p,(vi,mi) in zip(m.polygons,old['faces']):assert list(p.vertices)==vi and p.material_index==mi
   uv[:len(old['uv'])]=old['uv']
  verts=list(range(len(m.vertices)));faces=list(range(len(m.polygons)));edges={}
  def vr(i):
   while verts[i]!=i:verts[i]=verts[verts[i]];i=verts[i]
   return i
  def fr(i):
   while faces[i]!=i:faces[i]=faces[faces[i]];i=faces[i]
   return i
  for e in m.edges:a,b=e.vertices;verts[vr(a)]=vr(b)
  for p in m.polygons:
   role=m.materials[p.material_index].get('engine_name')
   if role not in ['Hull','Accent','Trim','Dark']:continue
   for a,b in zip(p.loop_indices,list(p.loop_indices[1:])+[p.loop_indices[0]]):
    key=(role,tuple(sorted(((m.loops[a].vertex_index,tuple(uv[a])),(m.loops[b].vertex_index,tuple(uv[b]))))))
    if key in edges:faces[fr(p.index)]=fr(edges[key])
    else:edges[key]=p.index
  charts={}
  visible=set(VIS[c.name]['objects'][o.name]['visible_polygons'])
  for p in m.polygons:
   role=m.materials[p.material_index].get('engine_name')
   if role not in ['Hull','Accent','Trim','Dark']:continue
   charts.setdefault(fr(p.index),[]).append(p)
  for id,ps in charts.items():
   role=m.materials[ps[0].material_index].get('engine_name');component=vr(ps[0].vertices[0]);area=sum(p.area for p in ps);vis=any(p.index in visible for p in ps);isrep=(o.name,component,role) in reprs
   row={'object':o.name,'chart':id,'role':role,'area':area,'visible':vis,'prototype':isrep,'faces':[p.index for p in ps]};details.append(row)
   b=stats.setdefault(role,{'all':0,'seen':0,'template':0,'seen_template':0});b['all']+=area;b['seen']+=area if vis else 0;b['template']+=area if isrep else 0;b['seen_template']+=area if vis and isrep else 0
 report[c.name]={'totals':stats,'charts':details}
 print(c.name,stats,flush=True)
with (OUT/'legacy-seam-budget.json').open('x') as f:json.dump(report,f,indent=2)
