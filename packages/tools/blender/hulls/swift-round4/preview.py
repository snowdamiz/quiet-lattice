"""Compact CPU diagnostic stills from the saved source; not engine/visual qualification."""
import bpy,sys,os,math,json,hashlib
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];variant,view,level=args[:3];level=int(level)
source=Path('assets/blend/hulls/swift.blend').resolve()
metadata={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'variant':variant,'view':view,'lod':level,'livery':args[3] if len(args)>3 else 'ixari','device':'CPU','qualifiesEngine':False}
if len(args)>4:
 assert args[3]=='ixari', 'alternate-livery diagnostic uses editable source Livery nodes, not decoded GLB nodes'
 sys.path.insert(0,str(Path(__file__).resolve().parents[2]));os.environ['KTX']=str(Path(__file__).with_name('ktx_cpu.py'))
 from artlib import core,scene as S,rules as R
 glb=Path(args[4]).resolve();metadata['glbSha256']=hashlib.sha256(glb.read_bytes()).hexdigest();core.load(glb)
 model=S.collect_export(R.load());v=next(v for a in model.assets for v in a.variants.values() if v.id==variant);selected_objects=v.lods[level]
else:
 bpy.ops.wm.open_mainfile(filepath=str(source));selected_objects=list(bpy.data.collections[variant+f'_LOD{level}'].objects)
Path(os.environ['SWIFT_JOB'],'input.json').write_text(json.dumps(metadata,indent=2))
if len(args)>3 and args[3]!='ixari':
 palette={'compact':['#F4F4F0','#22406A','#F28C28'],'working':['#9A968C','#3A3B3D','#E3B341']}[args[3]]
 def linear(h):
  values=[int(h[i:i+2],16)/255 for i in (1,3,5)]
  return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values)+(1,)
 for m in bpy.data.materials:
  if m.node_tree and m.node_tree.nodes.get('Livery') and m.get('engine_name') in ['Hull','Accent','Trim']:
   m.node_tree.nodes['Livery'].outputs[0].default_value=linear(palette[['Hull','Accent','Trim'].index(m['engine_name'])])
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.denoising_use_gpu=False;scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=2
visible=set(selected_objects)
for item in selected_objects:
 parent=item.parent
 while parent:visible.add(parent);parent=parent.parent
for o in bpy.data.objects:o.hide_render=o not in visible or o.type not in ['MESH']
for o in visible:
 if o.type=='EMPTY':o.hide_render=False
if view.startswith('cockpit'):
 for o in selected_objects:
  if o.name.startswith('CanopyGlass'):o.hide_render=True
world=bpy.data.worlds.new('R4_CPU_Studio');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.16,.22,1);world.node_tree.nodes['Background'].inputs[1].default_value=.4
for name,pos,power,size,col in [('key',(3,4,8),1700,7,(.85,.91,1)),('fill',(-5,0,4),1100,6,(.72,.79,1)),('rim',(0,-7,6),2100,5,(1,.86,.72))]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=col;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,.2))-o.location).to_track_quat('-Z','Y').to_euler()
cam=bpy.data.objects.new('R4_CPU_Camera',bpy.data.cameras.new('R4_CPU_Camera'));scene.collection.objects.link(cam);scene.camera=cam
if view=='cockpit-top':pos=(1.35,.3,3.1);target=(0,1.63,.4);lens=50
elif view=='cockpit-pilot':pos=(0,1.13,1.10);target=(0,2.1,.52);lens=20
elif view=='damage':pos=(-5,-.2,4);target=(-1.1,-2.5,.10);lens=55
elif view=='fracture':pos=(-5,-4.2,2.5);target=(-2.95,-2.68,-.20);lens=55
elif view=='rear':pos=(4,-10,3.4);target=(0,-2,.1);lens=52
elif view=='gear':pos=(3,3,-.3);target=(0,2.5,-.95);lens=60
else:pos=(11,14,9);target=(0,0,.25);lens=47
cam.location=pos;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=lens;cam.data.clip_start=.02
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.compression=45
scene.view_settings.view_transform='AgX';scene.render.film_transparent=False
scene.render.filepath=str(Path(os.environ['SWIFT_JOB'])/f'{variant}-{view}-lod{level}.png');bpy.ops.render.render(write_still=True)
print('CPU_ONLY',scene.render.filepath)
