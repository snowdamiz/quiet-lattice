"""Bounded CPU source previews, never gameplay or standard review evidence."""
import bpy
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[5]
OUT = Path(__file__).resolve().parent / 'previews'
OUT.mkdir(exist_ok=True)
args = sys.argv[sys.argv.index('--')+1:]
prefix = args[0]
bpy.ops.wm.open_mainfile(filepath=str(Path(__file__).resolve().parent/'scratch/repaired.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=12
scene.cycles.use_denoising=True
if hasattr(scene.cycles,'denoising_use_gpu'):scene.cycles.denoising_use_gpu=False
scene.render.threads_mode='FIXED'
scene.render.threads=2
scene.render.resolution_x=640
scene.render.resolution_y=480
scene.render.resolution_percentage=100
scene.world.color=(.18,.18,.18)
scene.view_settings.view_transform='AgX'
for o in list(scene.objects):
    o.hide_render=True
for loc,power,size in [((1,5,12),2300,9),((-9,1,6),1700,8),((3,-8,8),2400,7)]:
    d=bpy.data.lights.new('CPU_area','AREA'); d.energy=power; d.shape='DISK'; d.size=size
    o=bpy.data.objects.new('CPU_area',d); scene.collection.objects.link(o); o.location=loc
    o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
cam=bpy.data.objects.new('CPU_camera',bpy.data.cameras.new('CPU_camera')); scene.collection.objects.link(cam);scene.camera=cam
cam.data.type='ORTHO'
views=[('front', 'lark', (12,17,11),(0,0,.1),21),('aft','lark',(-13,-16,10),(0,0,.1),21),('cockpit','lark',(4,4,5),(0,1.6,.7),5.8)]
if prefix!='before':
    views=[('front','lark',(12,17,11),(0,0,.1),21),('aft','lark',(-13,-16,10),(0,0,.1),21),('damaged','lark_damaged',(12,17,11),(0,0,.1),21),('husked','lark_husked',(12,17,11),(0,0,.1),21),('cockpit','lark',(3.6,3.3,4.4),(0,1.4,.7),4.7),('boarding','lark',(-9,6,4),(-1.2,1,.1),8),('hardpoint','lark',(5,6,-3),(1.72,2.78,-.7),3.4),('wear','lark',(-10,6,6),(-3,1,.7),7)]
if prefix=='liveries':
    views=[(scheme,'lark',(12,17,11),(0,0,.1),21) for scheme in ('compact','working')]
if prefix=='details':
    views=[('pilot','lark',(1.5,-.7,3.2),(0,1.5,.9),2.9),('reference','lark',(-9,6,4),(-1.2,1,.1),8),('socket-lit','lark',(3.4,4.5,-3),(1.72,2.78,-.7),2.5)]
    d=bpy.data.lights.new('CPU_underfill','AREA');d.energy=700;d.size=3
    fill=bpy.data.objects.new('CPU_underfill',d);scene.collection.objects.link(fill);fill.location=(4,6,-5)
    fill.rotation_euler=(Vector((1.72,2.78,-.7))-fill.location).to_track_quat('-Z','Y').to_euler()
if prefix=='geometry-check':
    views=[view for view in views if view[0] in ('front','cockpit','boarding')]
if prefix=='rail-check':
    views=[view for view in views if view[0]=='boarding']
if prefix.startswith('interior-'):
    views=[('isolated','lark',(3,3,3),(0,1.3,.9),3.4)]
if prefix=='turntable':
    scene.render.resolution_x=512;scene.render.resolution_y=384
    views=[(str(i),'lark',(18*math.sin(i*math.pi/4),18*math.cos(i*math.pi/4),9),(0,0,.1),20) for i in range(8)]
    import numpy as np
    sheet=np.zeros((768,2048,4),np.float32)
views=[('LOD'+str(i),'lark',(12,17,11),(0,0,.1),17) for i in (0,2)]
mode='material'
if mode=='no-normal':
 for mat in bpy.data.materials:
  if mat.use_nodes:
   for node in mat.node_tree.nodes:
    if node.type=='BSDF_PRINCIPLED':
     for link in list(node.inputs['Normal'].links):mat.node_tree.links.remove(link)
if mode in ('neutral','neutral-flat'):
 mat=bpy.data.materials.new('TEMP_diagnostic');mat.use_nodes=True
 bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.35,.35,.35,1);bs.inputs['Roughness'].default_value=.45
 for o in bpy.data.objects:
  if o.type=='MESH':
   o.data=o.data.copy();o.data.materials.clear();o.data.materials.append(mat)
   if mode=='neutral-flat':
    for f in o.data.polygons:f.use_smooth=False
for name,variant,loc,target,scale in views:
    for o in list(scene.objects):
        if o.type not in ('LIGHT','CAMERA'): o.hide_render=True
    for o in list(bpy.data.collections[variant+'_'+name].all_objects):
        o.hide_render=False
    if prefix=='details':
        fill.hide_render=name!='socket-lit'
        if name=='reference':bpy.data.objects['REF_Biped'].hide_render=False
    if prefix.startswith('interior-'):
        for o in list(bpy.data.collections[variant+'_'+name].all_objects):
            if o.type=='MESH' and not o.name.startswith('Cockpit'):o.hide_render=True
        if prefix=='interior-clay':
            o=bpy.data.objects['CockpitMechanismMesh']
            bpy.context.view_layer.objects.active=o;o.select_set(True)
            for modifier in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
            mat=bpy.data.materials.new('Diagnostic_clay');mat.use_nodes=True;mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.5,.5,.5,1)
            o.data.materials.clear();o.data.materials.append(mat)
    if prefix=='liveries':
        for matname in ('Lark_Hull','Lark_Accent','Lark_Trim'):
            for node in bpy.data.materials[matname].node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image and ('baseColor' in node.image.name or 'lark_livery_' in node.image.name):
                    node.image=bpy.data.images['lark_livery_'+name]
    canopy=bpy.data.objects['Canopy']
    rest=canopy.rotation_euler.copy()
    if name in ('cockpit','boarding','pilot','reference'):
        canopy.rotation_euler.x=math.radians(55)
        bpy.context.view_layer.update()
    cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale
    if prefix=='interior-debug':
        from bpy_extras.object_utils import world_to_camera_view
        bpy.context.view_layer.update()
        for o in bpy.data.collections['lark_LOD0'].objects:
            print('VIS_RENDER',o.name,o.hide_render,o.visible_camera if o.type=='MESH' else None,o.parent.name if o.parent else None)
        o=bpy.data.objects['CockpitMechanismMesh'];ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        print('CAMERA',list(cam.location),list(cam.rotation_euler),'CENTER',list(world_to_camera_view(scene,cam,Vector((0,1.3,.9)))),'POLYS',len(ev.data.polygons),'BOUNDS',[list(ev.matrix_world@Vector(p)) for p in ev.bound_box]);sys.exit(0)
    dest=OUT/(prefix+'-'+name+'.png');assert not dest.exists()
    scene.render.filepath=str(dest)
    scene.cycles.device='CPU'
    scene.cycles.denoising_use_gpu=False
    bpy.ops.render.render(write_still=prefix!='turntable')
    if prefix=='turntable':
        import tempfile,os
        fd,tmp=tempfile.mkstemp(prefix='turntable-cell-',suffix='.png',dir=OUT/'.scratch');os.close(fd)
        bpy.data.images['Render Result'].save_render(tmp,scene=scene)
        render=bpy.data.images.load(tmp);pixels=np.empty(512*384*4,np.float32);render.pixels.foreach_get(pixels)
        idx=int(name);sheet[(1-idx//4)*384:(2-idx//4)*384,(idx%4)*512:(idx%4+1)*512]=pixels.reshape(384,512,4)
        bpy.data.images.remove(render);os.unlink(tmp)
    canopy.rotation_euler=rest
    print('TURNTABLE CELL' if prefix=='turntable' else 'PREVIEW',name if prefix=='turntable' else dest,flush=True)
if prefix=='turntable':
    result=bpy.data.images.new('CPU_turntable_sheet',2048,768,alpha=False);result.pixels.foreach_set(sheet.ravel());result.file_format='PNG';result.filepath_raw=str(OUT/'turntable-sheet.png');result.save()
