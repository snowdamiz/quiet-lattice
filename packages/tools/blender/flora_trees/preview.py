"""Compact saved-source contact sheets, Cycles CPU only. No native review/capture gate."""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[4]


def aim(o,p): o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()


def main(kind,run):
    source=ROOT/'assets/blend/flora'/f'tree_{kind}_t04.blend'
    original=hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
    sc=bpy.context.scene
    sc.render.engine='CYCLES'; sc.cycles.device='CPU'; sc.cycles.samples=12
    sc.cycles.use_denoising=False
    sc.cycles.max_bounces=4
    sc.render.threads_mode='FIXED'; sc.render.threads=2
    sc.render.resolution_x=320; sc.render.resolution_y=320; sc.render.resolution_percentage=100
    sc.render.image_settings.file_format='PNG'
    sc.view_settings.view_transform='AgX'
    sc.render.film_transparent=False
    sc.world=bpy.data.worlds.new('T04_studio'); sc.world.use_nodes=True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.19,.23,1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value=.5
    for o in bpy.data.objects: o.hide_render=True
    camdata=bpy.data.cameras.new('CPU_camera'); cam=bpy.data.objects.new('CPU_camera',camdata)
    sc.collection.objects.link(cam); sc.camera=cam; camdata.type='ORTHO'
    for name,pos,power,size in [('Key',(6,-8,13),1800,8),('Fill',(-8,-2,9),1000,7),('Rim',(2,8,11),1700,6)]:
        dat=bpy.data.lights.new(name,'AREA'); dat.energy=power; dat.shape='DISK'; dat.size=size
        obj=bpy.data.objects.new(name,dat); sc.collection.objects.link(obj); obj.location=pos; aim(obj,(0,0,4))
    bpy.ops.mesh.primitive_plane_add(size=200)
    ground=bpy.context.object; ground.name='CPU_ground'; ground.location.z=-.04
    m=bpy.data.materials.new('CPU_ground_material'); m.diffuse_color=(.08,.105,.12,1)
    ground.data.materials.append(m)
    prefix='cactus' if kind=='cactus' else 'tree_'+kind
    objects=sorted([o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(prefix+'_') and o.name.rsplit('_',1)[-1].isdigit()],key=lambda o:o.name)
    outdir=ROOT/'assets/renders/flora/t04'/run.name
    outdir.mkdir(parents=True,exist_ok=False)
    existing=list((ROOT/'assets/renders/flora/t04').rglob('*.png'))
    assert len(existing)+len(objects)<=48,'preview count cap'
    records=[]
    temp=run/'one-frame.png'
    try:
        for o in objects:
            points=[o.matrix_world@Vector(c) for c in o.bound_box]
            lo=Vector(tuple(min(p[j] for p in points) for j in range(3)))
            hi=Vector(tuple(max(p[j] for p in points) for j in range(3)))
            center=(lo+hi)*.5
            scale=max(hi.x-lo.x,hi.y-lo.y,hi.z-lo.z)*1.18
            sheet=np.ones((640,960,4),np.float32)
            cells=[]
            for i,angle in enumerate([25,115,205,295,25,25]):
                for x in objects: x.hide_render=True
                current=o if i!=4 else bpy.data.objects[o.name+'_lod2']
                current.hide_render=False
                current.hide_set(False)
                target=center.copy(); frame_scale=scale
                if i==5:
                    target.z=hi.z*.62; frame_scale=scale*.40
                a=math.radians(angle)
                cam.location=target+Vector((math.sin(a)*20,-math.cos(a)*20,8))
                aim(cam,target); camdata.ortho_scale=frame_scale
                sc.render.filepath=str(temp)
                bpy.ops.render.render(write_still=True)
                image=bpy.data.images.load(str(temp),check_existing=False)
                arr=np.empty(320*320*4,np.float32); image.pixels.foreach_get(arr)
                row=1-i//3; col=i%3
                sheet[row*320:(row+1)*320,col*320:(col+1)*320]=arr.reshape(320,320,4)
                bpy.data.images.remove(image); current.hide_render=True
                cells.append({'cell':i,'angle':angle,'lod':2 if i==4 else 0,'detail':i==5})
            image=bpy.data.images.new(o.name+'_CPU_sheet',width=960,height=640,alpha=True)
            image.pixels.foreach_set(sheet.ravel())
            image.filepath_raw=str(outdir/(o.name+'.png')); image.file_format='PNG'; image.save()
            records.append({'name':o.name,'path':str(Path(image.filepath_raw).relative_to(ROOT)),
                            'sha256':hashlib.sha256(Path(image.filepath_raw).read_bytes()).hexdigest(),'cells':cells})
            bpy.data.images.remove(image)
    finally:
        temp.unlink(missing_ok=True)
    assert hashlib.sha256(source.read_bytes()).hexdigest()==original
    assert sum(p.stat().st_size for p in (ROOT/'assets/renders/flora/t04').rglob('*.png'))<512*1024**2
    (run/'preview.json').write_text(json.dumps({'source_sha256':original,'renderer':'Cycles CPU 12 samples, 320px cells, author inspection only','sheets':records},indent=2)+'\n')


if __name__=='__main__': main(sys.argv[-2],Path(sys.argv[-1]))
