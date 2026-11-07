"""Additional saved-viewmodel CPU checks; the exporter also runs artlib's five gates."""
from pathlib import Path
import hashlib
import json
import math

import bpy
from mathutils import Matrix


def validate_loaded(people, report_path):
    scene = bpy.context.scene
    assert scene.get('viewmodel_people') == people
    rigs = [o for o in scene.objects if o.type == 'ARMATURE']
    assert len(rigs) == 1
    rig = rigs[0]
    required = {'vm_root'}
    for side in ('R', 'L'):
        required.update('vm_' + n + '_' + side for n in ('upperarm','upperarm_twist','lowerarm','lowerarm_twist','hand'))
        required.update(f'vm_{digit}_{joint:02}_{side}' for digit in ('index','middle','ring','thumb') for joint in (1,2,3))
    assert set(rig.data.bones.keys()) == required
    for side in ('R','L'):
        assert rig.data.bones[f'vm_hand_{side}'].parent.name == f'vm_lowerarm_{side}'
        for digit in ('index','middle','ring','thumb'):
            for joint in (1,2,3):
                bone = rig.data.bones[f'vm_{digit}_{joint:02}_{side}']
                parent = f'vm_hand_{side}' if joint == 1 else f'vm_{digit}_{joint-1:02}_{side}'
                assert bone.parent.name == parent

    axes=json.loads(Path(__file__).with_name('bind_axes.json').read_text())
    assert scene.get('viewmodel_axes_profile')==axes['id']
    for name,rotation in axes['axes'].items():
        assert rig.data.bones[name].matrix_local.to_quaternion().rotation_difference(Matrix(rotation).to_quaternion()).angle<1e-4
    points=[]; triangles=0; influences=set(); meshes=[]
    for ob in scene.objects:
        if ob.type != 'MESH' or ob.name.startswith('REF_'):
            continue
        assert any(m.type=='ARMATURE' and m.object==rig for m in ob.modifiers), ob.name
        assert ob.data.uv_layers
        for v in ob.data.vertices:
            weights=[(ob.vertex_groups[g.group].name,g.weight) for g in v.groups if ob.vertex_groups[g.group].name in required]
            assert abs(sum(w for _,w in weights)-1)<1e-4, (ob.name,v.index,weights)
            assert len(weights)<=4, (ob.name,v.index,weights)
            influences.update(n for n,w in weights if w>.01)
        ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh()
        me.calc_loop_triangles(); triangles+=len(me.loop_triangles)
        points.extend(ob.matrix_world @ v.co for v in me.vertices); ev.to_mesh_clear()
        meshes.append(ob.name)
    assert 15000<=triangles<=60000, triangles
    assert required-{'vm_root'} <= influences, required-influences
    assert all(all(math.isfinite(x) for x in p) for p in points)
    # Eye origin, Blender +Y forward: every surface is ahead of the .01 m near plane.
    assert min(p.y for p in points) > .015, min(p.y for p in points)
    assert max(p.y for p in points) < 1.5
    assert max(p.z for p in points) < -.025, 'Keep the crosshair region unobscured'
    for marker in ('Muzzle','Grip_R','Grip_L'):
        ob=bpy.data.objects.get(marker)
        assert ob and ob.parent==rig and ob.parent_type=='BONE' and ob.parent_bone=='vm_hand_R'
    images={node.image for ob in scene.objects if ob.type=='MESH' and not ob.name.startswith('REF_') for mat in ob.data.materials if mat and mat.node_tree for node in mat.node_tree.nodes if node.type=='TEX_IMAGE' and node.image}
    assert images
    assert all(tuple(im.size)==(2048,2048) and im.packed_file for im in images)
    path=Path(bpy.data.filepath)
    report={'status':'PASS','people':people,'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'triangles':triangles,'bones':len(required),'weighted_bones':sorted(influences),'meshes':meshes,'bounds_blender':[[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]],'packed_2k_images':len(images),'animation_contract':'sharedRig.js; separate 35-joint viewmodel profile', 'axes_profile':axes['id'],'visual_acceptance':False}
    report_path=Path(report_path);report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n')
    return report
