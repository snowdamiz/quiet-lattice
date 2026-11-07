"""Remove R3's repeated broad floating replacement plates; keep lost panels and the authored R4 fracture sites."""
import bpy,bmesh,json,os,math
from pathlib import Path
from mathutils import Vector
source=Path('assets/blend/hulls/swift.blend').resolve();bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.preferences.filepaths.save_version=0
assert not bpy.context.scene.get('SwiftR4FractureCleanup')
def groups(mesh):
 bm=bmesh.new();bm.from_mesh(mesh);bm.verts.ensure_lookup_table();seen=set();out=[]
 for v in bm.verts:
  if v.index in seen:continue
  stack=[v];seen.add(v.index);vs=[];fs=set()
  while stack:
   a=stack.pop();vs.append(a);fs.update(a.link_faces)
   for e in a.link_edges:
    b=e.other_vert(a)
    if b.index not in seen:seen.add(b.index);stack.append(b)
  lo=Vector(tuple(min(v.co[i] for v in vs) for i in range(3)));hi=Vector(tuple(max(v.co[i] for v in vs) for i in range(3)))
  out.append({'ids':[v.index for v in vs],'lo':lo,'hi':hi,'tri':sum(len(f.verts)-2 for f in fs),'mat':next(iter(fs)).material_index if fs else 0})
 bm.free();return out
base=groups(bpy.data.objects['Body'].data);keys={(tuple(round(x,4) for x in g['lo']),tuple(round(x,4) for x in g['hi'])) for g in base}
report={}
for variant,suffix in [('swift_damaged','_dmg'),('swift_husked','_husk')]:
 body=bpy.data.objects['Body'+suffix];remove=set();selected=[]
 for g in groups(body.data):
  lo,hi=g['lo'],g['hi'];span=hi-lo;center=(lo+hi)*.5;mat=body.material_slots[g['mat']].material;role=mat.get('engine_name','')
  key=(tuple(round(x,4) for x in lo),tuple(round(x,4) for x in hi))
  if key not in keys and g['tri']<=20 and span.x>.22 and span.y>.45 and abs(center.x)<4.5 and -5<center.y<.5 and center.z<1.8 and (role=='Dark' or 'Crystal' in mat.name):
   remove.update(g['ids']);selected.append({'center':list(center),'triangles':g['tri'],'material':mat.name})
 bm=bmesh.new();bm.from_mesh(body.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.verts[i] for i in sorted(remove)],context='VERTS');bm.to_mesh(body.data);bm.free();body.data.update()
 rear=[]
 for g in groups(body.data):
  if g['lo'].y<-5.4:rear+=g['ids']
 for lod,ratio in [(1,.38),(2,.19),(3,.018)]:
  old=next(o for o in bpy.data.collections[variant+f'_LOD{lod}'].objects if o.name.startswith('Body'));old.data=body.data.copy()
  bpy.ops.object.select_all(action='DESELECT');old.hide_set(False);old.select_set(True);bpy.context.view_layer.objects.active=old
  for vg in list(old.vertex_groups):old.vertex_groups.remove(vg)
  group=old.vertex_groups.new(name='R4_silhouette_keep');group.add(rear,1,'REPLACE');mod=old.modifiers.new('R4_body_reduction','DECIMATE');mod.ratio=ratio;mod.vertex_group=group.name;mod.invert_vertex_group=True;mod.vertex_group_factor=1;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
 report[variant]={'removedFloatingPlates':selected,'removedVertices':len(remove)}
# The prominent grown spikes use the livery Trim/Accent materials, not only the Crystal material.
# Preserve the livery input while giving their cores dark depth and localized cloudy bands.
report['cloudedLiveryMaterials']=[]
for mat in bpy.data.materials:
 if mat.get('lib_source')!='LIB_GrownCrystal' or mat.name.startswith('SwiftHusk') or not mat.node_tree.nodes.get('Livery'):continue
 nt=mat.node_tree;cloud=nt.nodes.get('Mix');noise=nt.nodes.get('Noise Texture.001');bs=nt.nodes.get('Principled BSDF')
 ramp=nt.nodes.new('ShaderNodeMapRange');ramp.label='R4 internal crystal cloud bands';ramp.clamp=True;ramp.inputs['From Min'].default_value=.32;ramp.inputs['From Max'].default_value=.68
 nt.links.new(noise.outputs['Fac'],ramp.inputs['Value']);nt.links.new(ramp.outputs[0],cloud.inputs[0])
 for index,scale in [(6,.12),(7,.82)]:
  mul=nt.nodes.new('ShaderNodeMixRGB');mul.label='R4 livery core depth';mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;mul.inputs[2].default_value=(scale,scale,scale,1);nt.links.new(nt.nodes['Livery'].outputs[0],mul.inputs[1]);nt.links.new(mul.outputs[0],cloud.inputs[index])
 rough=nt.nodes.new('ShaderNodeMapRange');rough.label='R4 crystal roughness';rough.inputs['To Min'].default_value=.08;rough.inputs['To Max'].default_value=.24;nt.links.new(ramp.outputs[0],rough.inputs['Value']);nt.links.new(rough.outputs[0],bs.inputs['Roughness'])
 bs.inputs['Emission Strength'].default_value=.12
 report['cloudedLiveryMaterials'].append(mat.name)
bpy.context.scene['SwiftR4FractureCleanup']=True
for authored_mesh in bpy.data.meshes:authored_mesh.validate()
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
Path(os.environ['SWIFT_JOB'],'fracture-cleanup.json').write_text(json.dumps(report,indent=2));print({k:len(v['removedFloatingPlates']) for k,v in report.items() if isinstance(v,dict)})
