"""Bounded CPU authoring inspection of saved viewmodels; not engine evidence.

Blender -b source.blend -t 2 --python-exit-code 1 -P preview.py -- output.png [detail]
One still per invocation, Cycles CPU, no bake, no source save.
"""
from pathlib import Path
import math
import sys
import bpy
from mathutils import Vector

args=sys.argv[sys.argv.index('--')+1:]
out=Path(args[0]).resolve()
root=Path(__file__).resolve().parents[5]/'assets/renders/characters/viewmodels/cpu'
assert out.is_relative_to(root) and out.suffix=='.png'
images=list(root.glob('*.png'))
assert len(images)<48 and sum(p.stat().st_size for p in images)<512*1024**2
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.device='CPU'
scene.render.threads_mode='FIXED';scene.render.threads=2
scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=960;scene.render.resolution_y=540;scene.render.resolution_percentage=100
for coll in bpy.data.collections:
    if coll.name=='REF':coll.hide_render=True
world=bpy.data.worlds.new('VM_InspectionWorld');world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.12,.15,.18,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
scene.world=world
camdata=bpy.data.cameras.new('VM_Inspection');cam=bpy.data.objects.new('VM_Inspection',camdata);scene.collection.objects.link(cam);scene.camera=cam
cam.location=(0,0,0);target=Vector((0,1,0))
if len(args)>1 and args[1]=='detail':
    cam.location=(.95,.22,.12);target=Vector((.15,.50,-.25));camdata.type='ORTHO';camdata.ortho_scale=.9
cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
camdata.lens_unit='FOV';camdata.sensor_fit='VERTICAL';camdata.angle=math.radians(66);camdata.clip_start=.01
for name,loc,energy,size in [('key',(-1,-.3,1.1),100,1.5),('rim',(.5,1.5,.7),120,1),('fill',(1,-.5,.2),35,1)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=loc;ob.rotation_euler=(Vector((0,.5,-.2))-ob.location).to_track_quat('-Z','Y').to_euler()
scene.view_settings.view_transform='AgX'
scene.render.filepath=str(out);scene.render.image_settings.file_format='PNG'
out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.render.render(write_still=True)
print('CPU_PREVIEW_ONLY',out,flush=True)
