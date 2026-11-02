"""Small explicitly CPU-only Cycles inspection of the saved source; never saves the scene."""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[4]
OUT=ROOT/'assets/renders/stations/round5/syrock_20261102_a1'
sys.path.insert(0,str(HERE.parent))
from round4_common import digest

view=sys.argv[sys.argv.index('--')+1]
assert view in {'front','side'}
source=OUT/'staged02/stations/scrapyard.blend'
assert digest(source)=='c4b3adf0dc1f4870116c958e50a22b8fe6b566aab9f4c17a075a92e7798b85af'
image=OUT/f'preview_{view}_cpu.png';assert not image.exists()
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.device='CPU'
scene.render.threads_mode='FIXED';scene.render.threads=2
scene.cycles.samples=8;scene.cycles.use_denoising=False;scene.cycles.use_adaptive_sampling=False
scene.cycles.max_bounces=4;scene.cycles.diffuse_bounces=2;scene.cycles.glossy_bounces=2
scene.render.resolution_x=768;scene.render.resolution_y=768;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=False;scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=0 if view=='front' else 1
for obj in bpy.data.objects:obj.hide_render=obj.name!='sy_rock_L0'
world=bpy.data.worlds.new('R5_CPU_Preview_World');world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.06,.075,.09,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.4;scene.world=world
for label,position,energy,colour in [('Key',(-200,-250,300),2.1,(1,.94,.84)),
                                    ('Fill',(300,-180,120),.65,(.72,.84,1)),
                                    ('Rim',(0,250,200),1.0,(.86,.92,1))]:
    data=bpy.data.lights.new(f'R5_CPU_{label}','SUN');data.energy=energy;data.angle=.18;data.color=colour
    obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj);obj.location=position
    obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
camera=bpy.data.cameras.new('R5_CPU_Camera');camera.type='ORTHO';camera.ortho_scale=295;camera.clip_end=1500
obj=bpy.data.objects.new(camera.name,camera);scene.collection.objects.link(obj)
obj.location=(255,-345,185) if view=='front' else (-285,-170,160)
obj.rotation_euler=(Vector((0,3,0))-obj.location).to_track_quat('-Z','Y').to_euler();scene.camera=obj
scene.render.filepath=str(image)
assert scene.render.engine=='CYCLES' and scene.cycles.device=='CPU' and scene.render.threads==2
bpy.ops.render.render(write_still=True)
(OUT/f'preview_{view}_cpu.json').write_text(json.dumps({'source':str(source),'source_sha256':digest(source),
    'png':str(image),'png_sha256':digest(image),'engine':'CYCLES','device':'CPU','threads':2,'samples':8,
    'pixels':[768,768],'camera_location':list(obj.location),'orthographic_scale':295,'exposure':scene.view_settings.exposure,
    'preview_only':True,'not_engine_review':True,'source_saved_by_preview':False},indent=2)+'\n')
print('CPU PREVIEW COMPLETE',view,digest(image))
