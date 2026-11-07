"""Saved-source CPU still composites. Scratch still is reused and removed, never a raw sequence."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[5]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, rules as R, scene as S


def main():
    p=argparse.ArgumentParser()
    p.add_argument('group');p.add_argument('name')
    p.add_argument('--views',type=int,choices=(1,8),default=8)
    p.add_argument('--cell',type=int,default=384)
    p.add_argument('--lod',type=int,choices=(0,2),default=0)
    p.add_argument('--detail',action='store_true')
    p.add_argument('--export',action='store_true',help='render the actual compressed artifact after stock CPU decoding')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    source=ROOT/f'assets/blend/cities/ixari_{a.group}.blend'
    out=ROOT/'assets/renders/cities/ixari'/a.name
    out.mkdir(parents=True,exist_ok=False)
    asset=ROOT/f'packages/client/public/models/cities/ixari_{a.group}.glb' if a.export else source
    core.load(asset);rules=R.load();model=S.collect_export(rules) if a.export else S.collect_source(rules)
    if a.export:
        with bpy.data.libraries.load(str(source),link=False) as (src,dst):dst.collections=['REF']
        bpy.context.scene.collection.children.link(dst.collections[0])
    variants=[v for aa in model.assets for v in aa.variants.values()]
    sc=bpy.context.scene
    sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.cycles.samples=12
    sc.cycles.use_denoising=True;sc.cycles.max_bounces=4
    sc.render.threads_mode='FIXED';sc.render.threads=2
    sc.render.resolution_x=a.cell;sc.render.resolution_y=a.cell;sc.render.resolution_percentage=100
    sc.world=bpy.data.worlds.new('CPUStudio');sc.world.use_nodes=True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.16,.24,1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value=.45
    sc.view_settings.view_transform='AgX'
    sc.view_settings.exposure=.4
    for o in sc.objects:o.hide_render=True
    for c in bpy.data.collections:c.hide_render=False
    camera=bpy.data.objects.new('CPUCamera',bpy.data.cameras.new('CPUCamera'));sc.collection.objects.link(camera)
    sc.camera=camera;camera.data.type='ORTHO'
    text_material=bpy.data.materials.new('CPUCaption');text_material.use_nodes=True
    bs=text_material.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(.8,.84,.92,1)
    bs.inputs['Emission Color'].default_value=(.8,.84,.92,1);bs.inputs['Emission Strength'].default_value=1
    font=bpy.data.curves.new('CPUCaption','FONT');caption=bpy.data.objects.new('CPUCaption',font)
    sc.collection.objects.link(caption);caption.parent=camera;font.materials.append(text_material)
    lights=[]
    for name,direction,energy,col in [('Key',(-.8,-1,1.4),1700,(.88,.92,1)),
                                       ('Fill',(1,-.3,.6),900,(.72,.77,1)),('Rim',(.4,1,1.2),2100,(.75,.91,1))]:
        ob=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA'));sc.collection.objects.link(ob)
        ob.data.color=col;lights.append((ob,Vector(direction),energy))
    # A scale biped is placed beside each entrance, and a one metre grid spans its base.
    ref=bpy.data.objects.get('REF_Biped');ref.hide_render=False
    m=bpy.data.materials.new('CPUReference');m.diffuse_color=(.65,.66,.7,1);ref.data.materials.append(m)
    grid_data=bpy.data.curves.new('CPU_OneMetreGrid','CURVE');grid_data.dimensions='3D';grid_data.bevel_depth=.006
    for i in range(-10,11):
        for ends in (((-10,i,.005),(10,i,.005)),((i,-10,.005),(i,10,.005))):
            spline=grid_data.splines.new('POLY');spline.points.add(1)
            for point,co in zip(spline.points,ends):point.co=(*co,1)
    grid=bpy.data.objects.new('CPU_OneMetreGrid',grid_data);sc.collection.objects.link(grid);grid_data.materials.append(m)
    sheet=np.zeros((len(variants)*a.cell,a.views*a.cell,4),np.float32)
    cells=[]
    scratch=out/'scratch.png'
    for row,v in enumerate(variants):
        meshes=S.render_meshes(rules,v.lods[a.lod])
        for o in meshes:o.hide_render=False
        lo,hi=(Vector(x) for x in S.bounds(meshes));size=max(hi-lo);center=(lo+hi)*.5
        if a.detail:
            size=min(size,12);center=Vector((0,lo.y+1.5,2.2))
        ref.location=(min(hi.x,4.1),lo.y-.8,0)
        for col in range(a.views):
            angle=-math.pi/2+col*math.pi/4
            direction=Vector((math.cos(angle),math.sin(angle),.38)).normalized()
            camera.location=center+direction*size*2.5
            camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
            camera.data.ortho_scale=size*1.27;camera.data.clip_end=max(1000,size*8)
            font.body=f'CPU ITERATION | LOD{a.lod}\n{v.id} | {col*45} deg'
            font.size=camera.data.ortho_scale*.024
            caption.location=(-camera.data.ortho_scale*.48,-camera.data.ortho_scale*.45,-.5)
            for ob,d,e in lights:
                ob.location=center+d*size
                ob.rotation_euler=(center-ob.location).to_track_quat('-Z','Y').to_euler()
                ob.data.size=size*.75;ob.data.energy=e*(size/10)**2
            sc.render.filepath=str(scratch)
            bpy.ops.render.render(write_still=True)
            im=bpy.data.images.load(str(scratch),check_existing=False)
            pix=np.array(im.pixels[:],np.float32).reshape(a.cell,a.cell,4)
            y=(len(variants)-row-1)*a.cell;x=col*a.cell
            sheet[y:y+a.cell,x:x+a.cell]=pix
            bpy.data.images.remove(im);scratch.unlink()
            cells.append(dict(asset=v.id,row=row,col=col,angleDegrees=math.degrees(angle),
                              bounds=[list(lo),list(hi)],scaleReference='1.85m biped'))
        for o in meshes:o.hide_render=True
    image=bpy.data.images.new('CPU iteration composite',a.views*a.cell,len(variants)*a.cell,alpha=True)
    image.pixels.foreach_set(sheet.ravel());image.filepath_raw=str(out/'sheet.png');image.file_format='PNG';image.save()
    (out/'readout.json').write_text(json.dumps(dict(backend='CYCLES_CPU',claim='CPU iteration, not GPU visual PASS',
        source=str(asset.relative_to(ROOT)),sourceSha256=hashlib.sha256(asset.read_bytes()).hexdigest(),
        artifactKind='compressed GLB, stock CPU decoded' if a.export else 'saved source',
        threads=2,samples=12,lod=a.lod,exposure=.4,cells=cells,rawSequence=False),indent=2)+'\n')
    print('CPU ITERATION SHEET',out/'sheet.png')


if __name__=='__main__':main()
