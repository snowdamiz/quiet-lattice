"""Bounded CPU Cycles views of saved source or the decoded compressed export."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[5]
OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, rules, scene as S


def main():
    p=argparse.ArgumentParser();p.add_argument('--draft',action='store_true');p.add_argument('--export',action='store_true');p.add_argument('--variant',default='kestrel');p.add_argument('--view',choices=['hero','cockpit','boarding','hardpoint','pilot','aft','material','port','front','rear','top'],default='hero');p.add_argument('--open',action='store_true');p.add_argument('--lod',type=int,default=0);p.add_argument('--name',required=True);p.add_argument('--angle',type=float)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    src=ROOT/('packages/client/public/models/hulls/kestrel.glb' if a.export else 'assets/blend/hulls/kestrel.blend')
    before=hashlib.sha256(src.read_bytes()).hexdigest();core.load(src)
    r=rules.load();m=S.collect_export(r) if a.export else S.collect_source(r)
    asset=next(x for x in m.assets if x.name=='kestrel');v=asset.variants[a.variant]
    keep={o.as_pointer() for o in v.lods[a.lod]}
    for o in bpy.context.scene.objects:o.hide_render=o.as_pointer() not in keep or o.name.startswith('COL_')
    if a.open:
        for o in v.lods[a.lod]:
            if o.type=='EMPTY' and o.name.split('.')[0]=='Canopy':o.rotation_euler.x+=math.radians(72)
    review=bpy.data.collections.new('_CPUReview');bpy.context.scene.collection.children.link(review)
    def put(o):
        for c in list(o.users_collection):c.objects.unlink(o)
        review.objects.link(o);o.hide_render=False
    def mat(name,color,rough=0.7):
        m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough;return m
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-1.72));ground=bpy.context.object;put(ground);ground.data.materials.append(mat('_ReviewGround',(.09,.105,.105)))
    if a.view in ('boarding','port') and not a.export:
        ref=bpy.data.objects.get('REF_Biped')
        if ref:
            ref.hide_render=False;ref.location=(-3.9,3.3,-1.71)
        for i in range(-10,11):
            for axis in (0,1):
                bpy.ops.mesh.primitive_cube_add(size=1,location=((i,0,-1.715) if axis==0 else (0,i,-1.715)))
                o=bpy.context.object;put(o);o.scale=(.009,20,.002) if axis==0 else (20,.009,.002);o.data.materials.append(mat('_Grid',(.25,.29,.28)))
    views={'hero':((14,16,11),(0,0,.1),21),'aft':((-13,-15,9),(0,-1,0),21),'front':((0,22,7),(0,0,0),21),'rear':((0,-22,7),(0,-1,0),21),'port':((-17,4,6),(0,0,0),21),'top':((0,0,25),(0,0,0),21),'cockpit':((-3.5,5.5,3.7),(0,2.2,.25),4.8),'boarding':((-7,5,2.8),(-1.65,2,.0),7.5),'hardpoint':((4,2,-.25),(.6,.8,-.45),5.8),'material':((8,-2,5),(3.5,-1.8,.35),5.5)}
    views['pilot']=((0,2.08,1.08),(0,3.20,.37),2.0)
    if a.view=='hardpoint':views['hardpoint']=((5,7,-1.35),(0,.9,-.65),6.2)
    loc,target,scale=views[a.view]
    if a.angle is not None:
        t=math.radians(a.angle);loc=(20*math.cos(t),20*math.sin(t),10);target=(0,0,0);scale=21
    bpy.ops.object.camera_add(location=loc);cam=bpy.context.object;put(cam);cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=scale;bpy.context.scene.camera=cam
    if a.view=='hardpoint':
        ground.hide_render=True
        right=cam.rotation_euler.to_quaternion()@Vector((1,0,0));up=cam.rotation_euler.to_quaternion()@Vector((0,1,0));centre=Vector((0,.9,-1.70))
        reference=mat('_ReviewOneMetre',(.9,.9,.9))
        def rod(start,end,radius):
            bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=(end-start).length,location=(start+end)*.5)
            o=bpy.context.object;put(o);o.rotation_euler=(end-start).to_track_quat('Z','Y').to_euler();o.data.materials.append(reference)
        rod(centre-right*.5,centre+right*.5,.012)
        for sign in (-1,1):rod(centre+right*sign*.5-up*.07,centre+right*sign*.5+up*.07,.012)
        curve=bpy.data.curves.new('_ReviewScaleLabel','FONT');curve.body='1 m';curve.align_x='CENTER';curve.size=.14
        label=bpy.data.objects.new('_ReviewScaleLabel',curve);review.objects.link(label);label.location=centre-up*.25;label.rotation_euler=cam.rotation_euler;curve.materials.append(reference)
    for name,pos,energy,size,color in [('Key',(-5,7,12),2400,7,(1,.91,.76)),('Fill',(8,2,6),1700,8,(.70,.85,1)),('Rim',(1,-9,9),2300,6,(.90,1,.90))]:
        bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;put(o);o.name='_Review'+name;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.data.color=color;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
    if a.view=='hardpoint':
        bpy.ops.object.light_add(type='AREA',location=(0,3,-1.3));o=bpy.context.object;put(o);o.name='_ReviewUnderside';o.data.energy=160;o.data.size=3;o.rotation_euler=(Vector((0,1,-.5))-o.location).to_track_quat('-Z','Y').to_euler()
    sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.cycles.samples=12 if a.draft else 32;sc.cycles.use_denoising=True
    sc.render.threads_mode='FIXED';sc.render.threads=2;sc.render.resolution_x=960 if a.draft else 1200;sc.render.resolution_y=720 if a.draft else 900;sc.render.resolution_percentage=100
    if sc.world is None:sc.world=bpy.data.worlds.new('_CPUReviewWorld')
    sc.world.use_nodes=True;sc.world.node_tree.nodes.get('Background').inputs[0].default_value=(.14,.16,.18,1);sc.world.node_tree.nodes.get('Background').inputs[1].default_value=.35
    sc.view_settings.view_transform='AgX';sc.render.image_settings.file_format='PNG';sc.render.filepath=str(OUT/(a.name+'.png'));sc.render.film_transparent=False
    bpy.ops.render.render(write_still=True)
    assert hashlib.sha256(src.read_bytes()).hexdigest()==before
    (OUT/(a.name+'.json')).write_text(json.dumps({'artifact':str(src.relative_to(ROOT)),'sha256':before,'variant':a.variant,'lod':a.lod,'view':a.view,'turntableAngleDegrees':a.angle,'cameraPosition':list(loc),'lookAt':list(target),'orthographicScaleMetres':scale,'scaleReference':('1 m labelled physical ruler' if a.view=='hardpoint' else ('1 m floor grid and 1.85 m biped' if a.view in ('boarding','port') and not a.export else None)),'canopyOpen':a.open,'CPU':True,'renderEngine':'CYCLES','threads':2,'samples':sc.cycles.samples,'imageSha256':hashlib.sha256((OUT/(a.name+'.png')).read_bytes()).hexdigest(),'purpose':'CPU authoring evidence; not runtime or visual approval'},indent=2)+'\n')


if __name__=='__main__':main()
