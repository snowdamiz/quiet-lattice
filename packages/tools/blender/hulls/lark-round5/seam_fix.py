import bpy,numpy as np,json,hashlib
from pathlib import Path
D=Path(__file__).resolve().parent;src=D.parents[4]/'assets/blend/hulls/lark.blend'
bpy.ops.wm.open_mainfile(filepath=str(src))
m=bpy.data.materials['LIB_HollowSeam_Lark'];nt=m.node_tree;p=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED');uv=next(n for n in nt.nodes if n.type=='UVMAP')
i=bpy.data.images['lark_husked_4k_emissive'];a=np.array(i.pixels[:]).reshape(4096,4096,4)
base=bpy.data.images['lark_husked_4k_density_baseColor'];b=np.array(base.pixels[:]).reshape(4096,4096,4)
n=nt.nodes.new('ShaderNodeTexImage');n.image=i;nt.links.new(uv.outputs['UV'],n.inputs['Vector']);nt.links.new(n.outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=.5
rows=[]
for o in bpy.data.objects:
 if o.type!='MESH':continue
 ids=[j for j,x in enumerate(o.data.materials) if x==m]
 if not ids:continue
 u=o.data.uv_layers.active
 for f in o.data.polygons:
  if f.material_index not in ids:continue
  # Map each physical strip to the existing teal seam band, retaining its longitudinal response.
  coords=[o.data.vertices[o.data.loops[k].vertex_index].co for k in f.loop_indices]
  origin=coords[0];axis=max((v-origin for v in coords),key=lambda v:v.length).normalized();normal=f.normal;side=normal.cross(axis).normalized()
  xy=np.array([((v-origin).dot(axis),(v-origin).dot(side)) for v in coords]);lo=xy.min(0);span=np.maximum(xy.max(0)-lo,1e-9)
  for k,v in zip(f.loop_indices,(xy-lo)/span):u.data[k].uv=((3320+v[0]*50)/4096,(2000+v[1]*180)/4096)
 samples=[a[min(4095,int(u.data[k].uv.y*4096)),min(4095,int(u.data[k].uv.x*4096)),:3].tolist() for f in o.data.polygons if f.material_index in ids for k in f.loop_indices]
 if not samples:continue
 rows.append({'object':o.name,'emissive_samples_min':np.min(samples,axis=0).tolist(),'emissive_samples_max':np.max(samples,axis=0).tolist()})
bpy.context.scene.cycles.device='CPU';bpy.context.scene.cycles.denoising_use_gpu=False
bpy.ops.wm.save_as_mainfile(filepath=str(src))
(D/'seam-authoring.json').write_text(json.dumps({'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'atlas_reused':i.name,'strength':.5,'samples':rows},indent=2))
