"""Compact CPU source inspection only; not native Review or a grading turntable."""
import bpy
import json
import math
import sys
from pathlib import Path
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[4]
stem=sys.argv[sys.argv.index('--')+1]
revision=sys.argv[sys.argv.index('--')+2]
family='constructs' if stem.startswith('outpost') else 'creatures'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blend'/family/(stem+'.blend')))
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.device='CPU'; sc.cycles.samples=20
sc.cycles.use_denoising=True; sc.cycles.denoiser='OPENIMAGEDENOISE'; sc.cycles.denoising_use_gpu=False
sc.render.threads_mode='FIXED'; sc.render.threads=2
sc.render.resolution_x=720; sc.render.resolution_y=640; sc.render.resolution_percentage=100
sc.render.image_settings.file_format='PNG'; sc.render.image_settings.color_mode='RGB'
sc.view_settings.view_transform='AgX'
sc.world=bpy.data.worlds.new('CPU_studio'); sc.world.use_nodes=True
sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.16,.20,1)
sc.world.node_tree.nodes['Background'].inputs[1].default_value=.4
if family=='creatures':
    # Stock maskColors math from modelLibrary.js, with gameLook's dun palette.
    palette=[]
    for rgb in [(138,107,79),(216,198,160),(47,38,34)]:
        c=np.asarray(rgb)/255; c=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
        c*=min(1,.75/c.max()); palette.append(c)
    material=bpy.data.materials.new('CPU_stock_mask_look'); material.use_nodes=True
    bs=material.node_tree.nodes.get('Principled BSDF'); bs.inputs['Roughness'].default_value=.65; bs.inputs['Metallic'].default_value=.05
    node=material.node_tree.nodes.new('ShaderNodeVertexColor'); node.layer_name='PreviewLook'
    material.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
    for obj in bpy.data.objects:
        if obj.type!='MESH' or not obj.data.color_attributes: continue
        me=obj.data; a=me.color_attributes[0]; raw=np.empty(len(a.data)*4,np.float32); a.data.foreach_get('color',raw)
        raw=raw.reshape(-1,4); weights=raw[:,:3]/raw[:,:3].sum(1)[:,None]
        col=weights@np.asarray(palette); col*= (.05+.95*raw[:,3])[:,None]
        ca=me.color_attributes.new(name='PreviewLook',type='FLOAT_COLOR',domain='POINT')
        ca.data.foreach_set('color',np.column_stack((col,np.ones(len(col)))).astype(np.float32).ravel())
        me.materials.clear(); me.materials.append(material)
for obj in bpy.data.objects: obj.hide_render=True
floor_mat=bpy.data.materials.new('CPU_floor'); floor_mat.use_nodes=True
floor_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.055,.07,.09,1)
floor_mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.9
bpy.ops.mesh.primitive_plane_add(size=500,location=(0,0,-.025)); floor=bpy.context.object; floor.data.materials.append(floor_mat)
camdata=bpy.data.cameras.new('CPU_Camera'); cam=bpy.data.objects.new('CPU_Camera',camdata); sc.collection.objects.link(cam); sc.camera=cam
camdata.type='ORTHO'; camdata.lens=50
lights=[]
for name,energy,size in [('Key',1800,6),('Fill',950,5),('Rim',2100,4)]:
    d=bpy.data.lights.new('CPU_'+name,'AREA'); o=bpy.data.objects.new('CPU_'+name,d); sc.collection.objects.link(o); d.energy=energy; d.shape='DISK'; d.size=size; lights.append(o)
out=ROOT/'assets/renders'/family/'e08t08'; out.mkdir(parents=True,exist_ok=True)
records=[]
for coll in sorted(bpy.data.collections,key=lambda c:c.name):
    if not coll.name.endswith('_LOD0'):continue
    meshes=[o for o in coll.all_objects if o.type=='MESH']
    coords=np.concatenate([np.asarray([o.matrix_world@v.co for v in o.data.vertices]) for o in meshes])
    lo=coords.min(0); hi=coords.max(0); centre=Vector((lo+hi)/2); size=float(max(hi-lo))
    for o in meshes:o.hide_render=False
    floor.location.z=lo[2]-.03
    cam.location=centre+Vector((1.15,-1.65,.80))*size
    cam.rotation_euler=(centre-cam.location).to_track_quat('-Z','Y').to_euler(); camdata.ortho_scale=size*1.32
    for light,loc in zip(lights,[(1,-1.2,1.8),(-1,-.5,.8),(.2,1.2,1.5)]):
        light.location=centre+Vector(loc)*size; light.rotation_euler=(centre-light.location).to_track_quat('-Z','Y').to_euler()
        light.data.energy={'CPU_Key':35,'CPU_Fill':15,'CPU_Rim':40}[light.name]*size*size; light.data.size=size
    path=out/(coll.name[:-5]+'-'+revision+'.png'); sc.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    records.append(dict(variant=coll.name[:-5],path=str(path.relative_to(ROOT)),source=str(stem)+'.blend',device='CPU',samples=20,look='stock dun mask math' if family=='creatures' else 'authored PBR'))
    for o in meshes:o.hide_render=True
(ROOT/'packages/tools/blender/e08t08/reports'/('preview-'+stem+'-'+revision+'.json')).write_text(json.dumps(records,indent=2)+'\n')
cols=min(3,len(records)); rows=math.ceil(len(records)/cols)
canvas=np.ones((rows*320,cols*360,4),np.float32)
for i,record in enumerate(records):
    im=bpy.data.images.load(str(ROOT/record['path'])); im.scale(360,320)
    pixels=np.empty(360*320*4,np.float32); im.pixels.foreach_get(pixels)
    row=rows-1-i//cols; col=i%cols
    canvas[row*320:(row+1)*320,col*360:(col+1)*360]=pixels.reshape(320,360,4)
    bpy.data.images.remove(im)
sheet=bpy.data.images.new(stem+'_CPU_sheet',width=cols*360,height=rows*320)
sheet.pixels.foreach_set(canvas.ravel()); sheet.file_format='PNG'; sheet.filepath_raw=str(out/(stem+'-sheet-'+revision+'.png')); sheet.save()
