"""Align saved viewmodels to the existing sharedRig.js bind-relative contract.

Joint origins retain species anatomy; local joint orientations match the Thalune
viewmodel reference. Bone tails are editor handles, not required child pivots.
No body file, skin geometry, weight, or runtime animation is changed.
"""
from pathlib import Path
import hashlib
import json
import bpy
import numpy as np
from mathutils import Matrix

ROOT=Path(__file__).resolve().parents[5]
source_dir=ROOT/'assets/blend/characters/viewmodels'
bpy.ops.wm.open_mainfile(filepath=str(source_dir/'fp_thalune.blend'))
rig=bpy.data.objects['RIG_fp_thalune']
axes={b.name:[list(row) for row in b.matrix_local.to_3x3()] for b in rig.data.bones}
profile=hashlib.sha256(json.dumps(axes,sort_keys=True).encode()).hexdigest()
Path(__file__).with_name('bind_axes.json').write_text(json.dumps({'id':profile,'axes':axes},indent=2)+'\n')

def positions():
    bpy.context.view_layer.update();result={}
    for o in bpy.context.scene.objects:
        if o.type!='MESH' or o.name.startswith('REF_'):continue
        ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh()
        a=np.empty(len(me.vertices)*3,np.float32);me.vertices.foreach_get('co',a);result[o.name]=a;ev.to_mesh_clear()
    return result

for people in ('thalune','ixari','ulgani'):
    path=source_dir/f'fp_{people}.blend';bpy.ops.wm.open_mainfile(filepath=str(path))
    scene=bpy.context.scene;rig=bpy.data.objects[f'RIG_fp_{people}'];before=positions()
    markers={name:bpy.data.objects[name].matrix_world.copy() for name in ('Muzzle','Grip_R','Grip_L')}
    bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
    for bone in rig.data.edit_bones:bone.use_connect=False
    for bone in rig.data.edit_bones:
        head=bone.head.copy();length=bone.length
        bone.matrix=Matrix.Translation(head)@Matrix(axes[bone.name]).to_4x4();bone.length=length
    bpy.ops.object.mode_set(mode='OBJECT');bpy.context.view_layer.update()
    for name,matrix in markers.items():bpy.data.objects[name].matrix_world=matrix
    after=positions();error=max(float(np.abs(before[n]-a).max()) for n,a in after.items())
    assert error<1e-6,error
    scene['viewmodel_axes_profile']=profile
    scene['viewmodel_contract']='sharedRig.js bind-relative TRS; 35 vm_ joints; +Y forward, eye origin, metres'
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    print('SHARED_VIEWMODEL_AXES',people,'neutral_vertex_error',error,'profile',profile,flush=True)
