"""Bake painted den atlases into the saved source, retaining editable paint backup.

Blender's export_vertex_color=ACTIVE otherwise emits Wear again after its colour
is baked, multiplying the base map twice. Keep the painted mesh and shader in an
excluded authoring collection; export the textured sculpt without COLOR_0. This
uses the existing CPU baker and makes no shared exporter changes.
"""
from pathlib import Path
import sys
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from artlib import bake

ROOT=Path(__file__).resolve().parents[4]
for file in sorted((ROOT/'assets/blend/sites').glob('den_*.blend')):
    bpy.ops.wm.open_mainfile(filepath=str(file))
    scene=bpy.context.scene
    if scene.get('den_packed_atlas'): raise RuntimeError('Atlas already baked; edit the saved source')
    ob=bpy.data.objects[file.stem+'_Sculpt']
    if file.stem=='den_apex_lair_0':
        for v in ob.data.vertices:
            v.co.z=max(v.co.z,-.18)
        ob.data.update()
    backup=bpy.data.collections.new('_PaintSource'); scene.collection.children.link(backup)
    cp=ob.copy(); cp.data=ob.data.copy(); cp.name='PaintSource_'+file.stem
    backup.objects.link(cp); cp.hide_render=True
    old=ob.data.materials[0]; mat=old.copy(); old.name='PaintShader_'+file.stem
    mat.name='Den_'+file.stem+'_Organic'; ob.data.materials[0]=mat
    scene.render.threads_mode='FIXED'; scene.render.threads=2
    bake.ensure_cycles(scene,samples=16)
    bake.bake_material(mat,[ob],2048,ao=True,label=file.stem,occluders=[ob])
    for attr in list(ob.data.color_attributes): ob.data.color_attributes.remove(attr)
    for image in bpy.data.images:
        if image.size[0]>8 and image.source!='VIEWER': image.pack()
    backup.hide_render=True; backup.hide_viewport=True
    scene['den_packed_atlas']='2K colour/roughness/normal/AO, CPU Cycles 16; original editable Wear mesh in _PaintSource'
    bpy.ops.wm.save_as_mainfile(filepath=str(file),compress=True)
    print('PACKED '+str(file),flush=True)
