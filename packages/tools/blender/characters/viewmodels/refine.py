"""CPU-preview-driven edits to the saved first candidate, not an export stage.

Brings the support hand onto the barrel, rounds the Thalune return, and assigns
shell inlay faces. Retains skinning and editable per-part meshes. One-time guard.
"""
from pathlib import Path
import sys
import bpy
from mathutils import Vector

path=Path(bpy.data.filepath)
assert path.parent.name=='viewmodels'
scene=bpy.context.scene
assert not scene.get('viewmodel_grip_refined')
people=scene['viewmodel_people']
rig=bpy.data.objects[f'RIG_fp_{people}']
shift=Vector((.12,.085,.105))
# The source's posed-bind geometry and joints move together; no animation is baked.
for ob in scene.objects:
    if ob.type!='MESH' or ob.name.startswith('REF_'):continue
    for vertex in ob.data.vertices:
        left=sum(g.weight for g in vertex.groups if ob.vertex_groups[g.group].name.endswith('_L'))
        vertex.co += shift*left
    # glTF supports four weights. Preserve the strongest contributions and normalise.
    for vertex in ob.data.vertices:
        pairs=sorted([(g.group,g.weight) for g in vertex.groups if ob.vertex_groups[g.group].name in rig.data.bones],key=lambda x:-x[1])
        if not pairs:continue
        for gi,w in pairs: ob.vertex_groups[gi].remove([vertex.index])
        total=sum(w for _,w in pairs[:4])
        for gi,w in pairs[:4]:ob.vertex_groups[gi].add([vertex.index],w/total,'REPLACE')
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for bone in rig.data.edit_bones:
    if bone.name.endswith('_L'):bone.head+=shift;bone.tail+=shift
bpy.ops.object.mode_set(mode='OBJECT')
if people=='thalune':
    shell=bpy.data.objects['Tool_TidalShell']
    uv=shell.data.uv_layers.active.data
    for face in shell.data.polygons:
        center=face.center
        if .54<center.y<.77 and abs(center.x-.20)>.045 and center.z>-.17:
            for i in face.loop_indices:uv[i].uv.x+=.25
    scroll=bpy.data.objects['Tool_ScrollReturn']
    sub=scroll.modifiers.new('RoundedShellReturn','SUBSURF');sub.levels=2
    bpy.context.view_layer.objects.active=scroll;bpy.ops.object.modifier_apply(modifier=sub.name)
scene['viewmodel_grip_refined']=True
bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
