"""Bounded CPU-only source contact sheets. Iteration evidence, not independent visual acceptance.

Eight angles per beat, front/oblique glyphs, no retained per-frame PNGs. A single
temporary EXR slot is overwritten for readback and deleted on completion/failure.
"""
import json
import math
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).parent))
from catalog import BEATS, ROOT, SOURCES, sha

OUT=ROOT/'.claude/pause/P1-E07-T14/previews'
W,H=192,160

def aim(obj,target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

def setup():
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.device='CPU'
    scene.cycles.samples=12
    scene.cycles.use_denoising=False
    scene.cycles.max_bounces=4
    scene.cycles.transparent_max_bounces=8
    scene.render.threads_mode='FIXED'
    scene.render.threads=2
    scene.render.resolution_x=W; scene.render.resolution_y=H
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='OPEN_EXR'
    scene.view_settings.view_transform='AgX'
    scene.world=bpy.data.worlds.new('_PreviewWorld')
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.035,.045,.065,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
    cam=bpy.data.objects.new('_PreviewCamera',bpy.data.cameras.new('_PreviewCamera'))
    scene.collection.objects.link(cam)
    cam.data.type='ORTHO'
    scene.camera=cam
    font=bpy.data.curves.new('_PreviewLabel','FONT')
    font.size=1
    label=bpy.data.objects.new('_PreviewLabel',font)
    scene.collection.objects.link(label)
    label.parent=cam
    mat=bpy.data.materials.new('_PreviewLabel')
    mat.use_nodes=True
    shader=mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(.8,.8,.8,1)
    shader.inputs['Emission Color'].default_value=(.8,.8,.8,1)
    shader.inputs['Emission Strength'].default_value=.5
    label.data.materials.append(mat)
    for name,pos,power,size in [('Key',(3,-4,5),300,4),('Rim',(-3,1,3),180,3)]:
        data=bpy.data.lights.new('_'+name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size
        obj=bpy.data.objects.new('_'+name,data); scene.collection.objects.link(obj); obj.location=pos; aim(obj,(0,0,0))
    return scene,cam

def frame(scene,cam,obj,azimuth,elevation,slot,fixed_lattice=False):
    bpy.context.view_layer.update()
    v=np.array([(obj.matrix_world @ p.co)[:] for p in obj.data.vertices])
    centre=(v.min(0)+v.max(0))/2
    size=max(v.max(0)-v.min(0))
    if fixed_lattice:
        centre=np.zeros(3)
        size=1.08
    cam.data.ortho_scale=max(size*1.6,.14)
    label=bpy.data.objects['_PreviewLabel']
    label.data.body=obj.name.removesuffix('_Surface').replace('_',' ')
    label.location=(-cam.data.ortho_scale*.46,-cam.data.ortho_scale*.385,-1)
    label.scale=(cam.data.ortho_scale*.035,)*3
    direction=Vector((math.sin(azimuth)*math.cos(elevation),-math.cos(azimuth)*math.cos(elevation),math.sin(elevation)))
    cam.location=Vector(centre)+direction*max(4,size*3)
    aim(cam,centre)
    scene.render.filepath=str(slot)
    bpy.ops.render.render(write_still=True)
    im=bpy.data.images.load(str(slot),check_existing=False)
    pixels=np.empty(W*H*4,np.float32); im.pixels.foreach_get(pixels)
    bpy.data.images.remove(im)
    return pixels.reshape(H,W,4)

def save(sheet,name,scene):
    im=bpy.data.images.new('_Composite',width=sheet.shape[1],height=sheet.shape[0],alpha=True,float_buffer=True)
    im.pixels.foreach_set(sheet.ravel())
    scene.render.image_settings.file_format='PNG'
    path=OUT/(name+'.png')
    im.save_render(str(path),scene=scene)
    bpy.data.images.remove(im)
    scene.render.image_settings.file_format='OPEN_EXR'
    return str(path.relative_to(ROOT))

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    m=json.loads((SOURCES/'manifest.json').read_text())
    inventory=[]
    with tempfile.TemporaryDirectory(prefix='p1-e07-t14-cpu-') as scratch:
        slot=Path(scratch)/'tile.exr'
        material_sheet=np.zeros((len(BEATS)*H,5*W,4),np.float32)
        for branch_index,branch in enumerate(BEATS):
            source=SOURCES/(branch+'.blend')
            bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
            for obj in bpy.context.scene.objects: obj.hide_render=True
            scene,cam=setup()
            rows=[a for a in m['assets'] if a['branch']==branch and a['role']=='beat']
            sheet=np.zeros((len(rows)*H,8*W,4),np.float32)
            for r,row in enumerate(rows):
                obj=bpy.data.objects[row['mesh']]; obj.hide_render=False
                for i in range(8):
                    pixels=frame(scene,cam,obj,i*math.pi/4,math.radians(25),slot)
                    y=(len(rows)-r-1)*H
                    sheet[y:y+H,i*W:(i+1)*W]=pixels
                obj.hide_render=True
            path=save(sheet,branch+'_eight_views',scene)
            inventory.append(dict(path=path,source=str(source.relative_to(ROOT)),sourceSha256=sha(source),rows=[a['id'] for a in rows],columns='azimuth 0..315 by 45 deg, elevation 25 deg',width=8*W,height=len(rows)*H))
            first=bpy.data.objects[rows[0]['mesh']]
            first.hide_render=False
            y=(len(BEATS)-branch_index-1)*H
            material_sheet[y:y+H,:W]=frame(scene,cam,first,.5,.4,slot)
            first.hide_render=True
            carrier=bpy.data.objects[branch+'_particle_Surface']
            carrier.hide_render=False
            base_uv=[v.uv.copy() for v in carrier.data.uv_layers.active.data]
            for col in range(4):
                for v,base in zip(carrier.data.uv_layers.active.data,base_uv): v.uv=(base.x+col*.25,base.y)
                material_sheet[y:y+H,(col+1)*W:(col+2)*W]=frame(scene,cam,carrier,0,0,slot)
            carrier.hide_render=True
            if branch=='recall':
                rows=[a for a in m['assets'] if a['role']=='glyph']
                for view,az,el in [('front',0,0),('oblique',.45,.3)]:
                    sheet=np.zeros((4*H,6*W,4),np.float32)
                    for i,row in enumerate(rows):
                        obj=bpy.data.objects[row['mesh']]; obj.hide_render=False
                        pixels=frame(scene,cam,obj,az,el,slot,fixed_lattice=True)
                        y=(3-i//6)*H; x=(i%6)*W
                        sheet[y:y+H,x:x+W]=pixels
                        obj.hide_render=True
                    path=save(sheet,'recall_glyphs_'+view,scene)
                    inventory.append(dict(path=path,sourceSha256=sha(source),cells=[a['id'] for a in rows],view=view))
        path=save(material_sheet,'materials_and_particle_decay',scene)
        inventory.append(dict(path=path,rows=list(BEATS),columns=['filament material','particle frame 0','particle frame 1','particle frame 2','particle frame 3']))
    files=list(OUT.glob('*.png'))
    total=sum(p.stat().st_size for p in files)
    assert len(files)<=48 and total<=512*1024**2
    (OUT/'inventory.json').write_text(json.dumps(dict(backend='Cycles CPU',threads=2,samples=12,images=len(files),bytes=total,
      qualification='Iteration contact sheets only; no GPU/native/browser or independent grade.',sheets=inventory),indent=2)+'\n')
    print('CPU PREVIEW',len(files),'composites;',total,'bytes')

if __name__=='__main__': main()
