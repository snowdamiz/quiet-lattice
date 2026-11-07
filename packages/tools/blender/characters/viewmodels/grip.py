"""Saved-source contact correction after side-view CPU inspection.

Lower the support palm below the barrel and oppose the right thumb onto the
back of the grip. Change skin and bind joints together, with no runtime clips.
"""
from pathlib import Path
import bpy
from mathutils import Vector

scene=bpy.context.scene;p=scene['viewmodel_people'];source=Path(bpy.data.filepath)
assert source.parent.name=='viewmodels' and not scene.get('viewmodel_contact_fitted')
rig=bpy.data.objects[f'RIG_fp_{p}']
deltas={}
for bone in rig.data.bones:
    delta=Vector((0,0,-.04)) if bone.name.endswith('_L') else Vector()
    if bone.name.startswith('vm_thumb_') and bone.name.endswith('_R'):
        joint=int(bone.name.split('_')[2]);delta+=Vector((0,[0,.012,.027][joint-1],-.004))
    deltas[bone.name]=delta
for ob in scene.objects:
    if ob.type!='MESH' or ob.name.startswith('REF_'):continue
    for v in ob.data.vertices:
        v.co+=sum((deltas.get(ob.vertex_groups[g.group].name,Vector())*g.weight for g in v.groups),Vector())
bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
for bone in rig.data.edit_bones:
    delta=deltas[bone.name];bone.head+=delta;bone.tail+=delta
b=rig.data.edit_bones
for side in ('R','L'):
    for parent,child in [('upperarm','lowerarm'),('lowerarm','hand')]:
        b[f'vm_{parent}_{side}'].tail=b[f'vm_{child}_{side}'].head
        b[f'vm_{child}_{side}'].use_connect=True
    for digit in ('index','middle','ring','thumb'):
        for j in (1,2):
            parent=b[f'vm_{digit}_{j:02}_{side}'];child=b[f'vm_{digit}_{j+1:02}_{side}']
            parent.tail=child.head;child.use_connect=True
bpy.ops.object.mode_set(mode='OBJECT')
scene['viewmodel_connected_joints']=True
scene['viewmodel_contact_fitted']=True
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
