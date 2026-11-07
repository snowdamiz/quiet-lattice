"""CPU-only preview of saved den sources/exports; no modelling or source writes.

--out must name a new directory. Hero packet: seven views, then a single render
per asset showing eight rotated copies (turntable sheet), plus material details.
The whole packet is 21 PNGs. No temporary frame sequences are retained.
"""
import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from artlib import core

p=argparse.ArgumentParser()
p.add_argument('--out',type=Path,required=True)
p.add_argument('--mode',choices=['hero','sheet','detail'],default='hero')
p.add_argument('files',nargs='+')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
a.out.mkdir(parents=True,exist_ok=False)


def mat(name,col,rough=1):
    m=bpy.data.materials.new(name); m.diffuse_color=(*col,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*col,1); bs.inputs['Roughness'].default_value=rough
    return m


def light(name,pos,power,size):
    d=bpy.data.lights.new(name,'AREA'); d.energy=power; d.shape='DISK'; d.size=size
    o=bpy.data.objects.new(name,d); bpy.context.scene.collection.objects.link(o); o.location=pos
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()


for file in a.files:
    core.load(file)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=16
    scene.cycles.use_denoising=True; scene.cycles.max_bounces=4
    scene.render.threads_mode='FIXED'; scene.render.threads=2
    scene.render.resolution_x=880; scene.render.resolution_y=720; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
    scene.view_settings.view_transform='AgX'
    objects=[]
    for o in list(scene.objects):
        if o.name.startswith(('COL_','REF_')) or ('_LOD' in o.name and not '_LOD0' in o.name): o.hide_render=True
        # Saved explicit LOD objects live in collections, not parent empties.
        if any('_LOD' in c.name and not c.name.endswith('_LOD0') for c in o.users_collection): o.hide_render=True
        if o.type=='MESH' and not o.hide_render:
            # Imported exports: only LOD0, even if Blender makes children names unique.
            parent=o.parent
            hidden=False
            while parent:
                if '_LOD' in parent.name and not '_LOD0' in parent.name: hidden=True
                parent=parent.parent
            o.hide_render=hidden
            if not hidden: objects.append(o)
    # Baked images or the source's painted material, with all real topology.
    verts=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    lo=Vector(tuple(min(v[k] for v in verts) for k in range(3)))
    hi=Vector(tuple(max(v[k] for v in verts) for k in range(3)))
    span=max(hi.x-lo.x,hi.y-lo.y,hi.z-lo.z)
    center=Vector((0,0,hi.z*.42))
    if a.mode=='sheet':
        scene.render.resolution_x=1920; scene.render.resolution_y=960
        # Rotate linked geometry around its own origin in eight review cells.
        for i in range(8):
            offset=Vector(((i%4-1.5)*span*1.22,(i//4-.5)*span*1.5,0))
            for ob in objects:
                cp=ob.copy(); cp.data=ob.data; scene.collection.objects.link(cp)
                cp.parent=None; cp.matrix_world=ob.matrix_world.copy()
                from mathutils import Matrix
                cp.matrix_world=Matrix.Translation(offset)@Matrix.Rotation(i*math.tau/8,4,'Z')@cp.matrix_world
        for o in objects: o.hide_render=True
        scale=span*5.2; center=Vector((0,0,hi.z*.35))
        camera_pos=Vector((0,-span*9,span*8))
    elif a.mode=='detail':
        scale=span*.43
        center=Vector((lo.x*.48,-.2,hi.z*.43))
        camera_pos=center+Vector((span*.5,-span,span*.45))
    else:
        scale=span*1.75
        camera_pos=Vector((span*.8,-span*1.6,span*.95))
        # A 1.85m A-pose next to the model makes the planner scale readable.
        ref=bpy.data.objects.get('REF_Biped')
        if ref:
            cp=ref.copy(); cp.data=ref.data.copy(); cp.name='ScaleBiped'; scene.collection.objects.link(cp)
            cp.hide_render=False; cp.location=(lo.x-.6,-1,0)
            cp.data.materials.append(mat('ScaleBronze',(.48,.3,.12)))
    bpy.ops.mesh.primitive_plane_add(size=span*20,location=(0,0,-.12))
    floor=bpy.context.object; floor.name='PreviewFloor'; floor.data.materials.append(mat('PreviewGround',(.075,.085,.068)))
    world=bpy.data.worlds.new('PreviewWorld'); world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.22,.28,.32,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.5; scene.world=world
    light('Key',(-span*1.5,-span*1.4,span*2.2),span*span*35,span*1.5)
    light('Fill',(span*1.4,-span*.2,span),span*span*12,span)
    light('Rim',(0,span*1.6,span*2),span*span*45,span)
    cam=bpy.data.cameras.new('PreviewCamera'); co=bpy.data.objects.new('PreviewCamera',cam); scene.collection.objects.link(co)
    co.location=camera_pos; co.rotation_euler=(center-co.location).to_track_quat('-Z','Y').to_euler()
    cam.type='ORTHO'; cam.ortho_scale=scale; scene.camera=co
    scene.render.filepath=str(a.out/(Path(file).stem+'.png'))
    bpy.ops.render.render(write_still=True)
    print('PREVIEW '+scene.render.filepath,flush=True)
