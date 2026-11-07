"""Finish the saved candidate: camera budget and <=4 normalized skin influences.

An authoring operation, never called by export. Preserves the approved body files.
"""
from pathlib import Path
import bpy
from mathutils import Vector

source=Path(bpy.data.filepath)
assert source.parent.name=='viewmodels'
scene=bpy.context.scene
people=scene['viewmodel_people'];rig=bpy.data.objects[f'RIG_fp_{people}'];arm=bpy.data.objects[f'{people}_arms']

def tris(ob):
    ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();me.calc_loop_triangles();n=len(me.loop_triangles);ev.to_mesh_clear();return n
meshes=[o for o in scene.objects if o.type=='MESH' and not o.name.startswith('REF_')]
other=sum(tris(o) for o in meshes if o!=arm)
if tris(arm)+other>54000:
    dec=arm.modifiers.new('ViewmodelRetopology','DECIMATE');dec.ratio=(48000-other)/tris(arm)
    assert .15<dec.ratio<1
    bpy.context.view_layer.objects.active=arm;bpy.ops.object.modifier_apply(modifier=dec.name)
for ob in meshes:
    for vertex in ob.data.vertices:
        weights=sorted([(g.group,g.weight) for g in vertex.groups if ob.vertex_groups[g.group].name in rig.data.bones and g.weight>1e-7],key=lambda pair:-pair[1])
        assert weights
        for gi in [g.group for g in vertex.groups]:ob.vertex_groups[gi].remove([vertex.index])
        total=sum(w for _,w in weights[:4])
        for gi,w in weights[:4]:ob.vertex_groups[gi].add([vertex.index],w/total,'REPLACE')
if not scene.get('viewmodel_camera_fitted'):
    offset=Vector((0,.08,0))
    for ob in meshes:
        for vertex in ob.data.vertices:vertex.co+=offset
    bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
    for bone in rig.data.edit_bones:bone.head+=offset;bone.tail+=offset
    bpy.ops.object.mode_set(mode='OBJECT')
    scene['viewmodel_camera_fitted']=True
scene['viewmodel_finished']=True
print('FINISH_TRIANGLES',sum(tris(o) for o in meshes),flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
