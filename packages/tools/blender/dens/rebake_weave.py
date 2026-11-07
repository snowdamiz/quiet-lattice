"""Rebake the repaired strand surfaces from their saved paint source on CPU."""
from pathlib import Path
import sys
import bpy
import bmesh

ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from artlib import bake

for name in ['den_nest_0','den_nest_1','den_roost_0','den_roost_1']:
    file=ROOT/'assets/blend/sites'/(name+'.blend')
    bpy.ops.wm.open_mainfile(filepath=str(file))
    scene=bpy.context.scene
    assert scene.get('den_weave_repair') and not scene.get('den_weave_rebaked')
    ob=bpy.data.objects[name+'_Sculpt']; paint=bpy.data.objects['PaintSource_'+name]
    bm=bmesh.new(); bm.from_mesh(paint.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(paint.data); bm.free()
    old=ob.data.materials[0]; old.name='RetiredAtlas_'+name
    ob.data=paint.data.copy()
    mat=paint.data.materials[0].copy(); mat.name='Den_'+name+'_Organic'
    ob.data.materials[0]=mat
    scene.render.threads_mode='FIXED'; scene.render.threads=2
    bake.ensure_cycles(scene,samples=16)
    bake.bake_material(mat,[ob],2048,ao=True,label=name+'_weave_r4',occluders=[ob])
    for attr in list(ob.data.color_attributes): ob.data.color_attributes.remove(attr)
    for img in bpy.data.images:
        if img.size[0]>8 and img.source!='VIEWER': img.pack()
    scene['den_weave_rebaked']='2K colour, roughness, normals and AO rebaked after ring-frame repair'
    bpy.ops.wm.save_as_mainfile(filepath=str(file),compress=True)
    print('REBAKED',name,flush=True)
