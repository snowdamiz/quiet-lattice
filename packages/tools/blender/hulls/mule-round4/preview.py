"""Bounded CPU authoring previews. These are not standard engine captures or a grade."""
import bpy
import math
import os
import sys
import json
import hashlib
from pathlib import Path
from mathutils import Vector, Matrix
sys.path.insert(0,str(Path(__file__).resolve().parent))
from checkpoint import check

out=Path(os.environ['MULE_ATTEMPT'])
args=sys.argv[sys.argv.index('--')+1:]
source=Path(args[0]).resolve()
lod_objects={}
if source.suffix=='.glb':
    sys.path.insert(0,str(Path(__file__).resolve().parents[5]/'packages/tools/blender'))
    from artlib import core,scene as S,rules as R
    os.environ['KTX']='/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx'
    os.environ['ART_KTX_JOBS']='1';os.cpu_count=lambda:2
    check('decode exported KTX2 and meshopt')
    core.load(source)
    for a in S.collect_export(R.load()).assets:
        for v in a.variants.values():
            for lod,objects in v.lods.items():lod_objects[(v.id,lod)]=objects
else:
    bpy.ops.wm.open_mainfile(filepath=str(source))
    for v in ['mule','mule_damaged','mule_husked']:
        for lod in range(4):lod_objects[(v,lod)]=list(bpy.data.collections[v+'_LOD'+str(lod)].objects)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16
scene.cycles.use_denoising=True;scene.cycles.denoiser='OPENIMAGEDENOISE'
scene.cycles.denoising_use_gpu=False
scene.render.threads_mode='FIXED';scene.render.threads=2
scene.render.resolution_x=1000;scene.render.resolution_y=760;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
scene.world.color=(.22,.22,.22)
scene.view_settings.view_transform='AgX'
# Source LOD collections are intentionally hidden for authoring; object-level
# isolation below determines exactly which LOD this preview renders.
for collection in bpy.data.collections:
    collection.hide_render=False;collection.hide_viewport=False
def enable_layers(layer):
    layer.exclude=False;layer.hide_viewport=False
    for child in layer.children:enable_layers(child)
enable_layers(bpy.context.view_layer.layer_collection)
for obj in bpy.data.objects:
    obj.hide_render=True;obj.hide_viewport=False;obj.hide_set(False)
def area(name,loc,power,size,target):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=loc
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
area('_R4_Key',(5,8,18),5000,12,(0,0,0))
area('_R4_Fill',(-10,4,7),2800,10,(0,0,0))
area('_R4_Rim',(1,-14,10),6000,8,(0,0,0))
camera=bpy.data.objects.new('_R4_Camera',bpy.data.cameras.new('_R4_Camera'));scene.collection.objects.link(camera);scene.camera=camera
camera.data.lens=48;camera.data.clip_end=300
seen=[]
def render(name,variant,lod,eye,target,scale=None,open_canopy=False):
    check('render '+name)
    for obj in bpy.data.objects:
        if obj.type not in ['LIGHT','CAMERA']:obj.hide_render=True
    objects=lod_objects[(variant,lod)]
    for obj in objects:obj.hide_render=False
    canopy=next((o for o in objects if o.type=='EMPTY' and o.name.startswith('Canopy')),None)
    original=canopy.matrix_basis.copy() if canopy else None
    if canopy and open_canopy:canopy.matrix_basis=original @ Matrix.Rotation(math.radians(75),4,'X')
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.lens=26 if name=='cockpit_seated' else 48
    camera.data.type='ORTHO' if scale else 'PERSP'
    if scale:camera.data.ortho_scale=scale
    scene.render.filepath=str(out/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    if canopy:canopy.matrix_basis=original
    seen.append(name+'.png');(out/'images.json').write_text(json.dumps({'source':str(source),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'images':seen,'qualification':'CPU authoring previews only; no engine qualification'},indent=2))

mode=args[1] if len(args)>1 else 'all'
if mode in ['all','surfaces','far','near-details']:
    for variant in ['mule','mule_damaged','mule_husked']:
        for lod in ([3] if mode=='far' else [0,2] if mode=='near-details' else [0,2,3]):
            render(variant+'_lod'+str(lod),variant,lod,(26,-32,19),(0,0,.0),27)
if mode in ['all','details','seat','cockpit','near-details']:
    area('_R4_Cockpit',(0,8,4),240,3,(0,9,0))
    render('cockpit_seated','mule',0,(0,8.66,.62),(0,9.27,.03),None,True)
if mode in ['all','details','cockpit','near-details']:
    render('cockpit_top','mule',0,(0,9.65,4.1),(0,8.85,-.1),3.2,True)
if mode in ['all','details','near-details','details-tail']:
    render('ladder_grips','mule',0,(-4.9,10.8,1.5),(-1.57,8.9,-.45),3.9,True)
if mode in ['all','details','cockpit','near-details','details-tail']:
    render('hardpoint_joint','mule',0,(2.1,-9.3,5.8),(0,-7.35,3.15),2.2)
if mode in ['all','details','near-details','details-tail']:
    render('canopy_impact','mule_damaged',0,(2.6,10.2,3.8),(0,9.1,.9),3.8)
    render('husk_canopy','mule_husked',0,(2.6,10.2,3.8),(0,9.1,.9),3.8)
print('PREVIEW_COMPLETE',seen,flush=True)
