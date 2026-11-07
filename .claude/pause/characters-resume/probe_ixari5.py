import bpy,sys,json,hashlib,mathutils
import numpy as np
from pathlib import Path
sys.path.insert(0,'/Users/andreyyurlov/Documents/dev/space/.claude/pause/art-bodies')
from lib import preview
out=Path('.claude/pause/characters-resume/ixari5-probe');out.mkdir(exist_ok=True)
source=Path(bpy.data.filepath); original_sha=hashlib.sha256(source.read_bytes()).hexdigest()
def cpu_setup(scene,samples=16,engine='CYCLES'):
 scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.cycles.denoising_use_gpu=False
 scene.view_settings.view_transform='AgX';w=bpy.data.worlds.get('pv_world') or bpy.data.worlds.new('pv_world');w.use_nodes=True;bg=next(n for n in w.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.05,.055,.06,1);bg.inputs['Strength'].default_value=1;scene.world=w
preview.setup=cpu_setup
body=bpy.data.objects['IX_Body_head1_L0'];rig=bpy.data.objects['RIG_ixari']
hand=rig.data.bones['hand_L'];hc=hand.head_local+(hand.tail_local-hand.head_local)*1.5
ball=rig.data.bones['ball_L'];fc=ball.head_local+(ball.tail_local-ball.head_local)*.35+mathutils.Vector((0,0,-.01))
report={'premise':'Repeated geometry smoothing assumes that the dark digit seams are geometric; compare unchanged geometry with mapped normal, disconnected normal and neutral clay before choosing the fifth correction.','source_sha256':original_sha,'objects':{},'materials':{}}
for name in ['IX_Body_head1_L0','IX_Head1_head1_L0','IX_Suit3_suit3_L0']:
 obj=bpy.data.objects[name];me=obj.data;attrs={}
 for a in me.attributes:
  if a.domain=='POINT' and a.data_type in ('FLOAT','INT'):
   values=np.empty(len(a.data),np.float32 if a.data_type=='FLOAT' else np.int32);a.data.foreach_get('value',values);attrs[a.name]={'min':float(values.min()),'max':float(values.max()),'unique':np.unique(values).tolist() if len(np.unique(values))<=20 else None}
 report['objects'][name]={'attributes':attrs,'materials':[m.name for m in me.materials]}
for mat in bpy.data.materials:
 if mat.name.startswith('IX_'):
  p=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');report['materials'][mat.name]={'emission_strength':p.inputs['Emission Strength'].default_value,'maps':{n.image.name:list(n.image.size) for n in mat.node_tree.nodes if n.type=='TEX_IMAGE'}}
paths=[]
for mode in ['mapped','normal_disconnected','clay']:
 if mode=='normal_disconnected':
  mat=bpy.data.materials['IX_Skin'];p=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
  for link in list(p.inputs['Normal'].links):mat.node_tree.links.remove(link)
 if mode=='clay':
  material=preview.clay('ixari_probe_clay',col=(.25,.28,.32),rough=.7)
  for i,m in enumerate(body.data.materials):
   if m.name=='IX_Skin':body.data.materials[i]=material
 for part,focus,radius,view in [('hand',hc,.13,(90,50)),('toes',fc,.09,(0,68))]:
  path=str(out/f'{mode}_{part}.png');preview.render_views([body],path,views=(view,),size=(480,400),samples=16,focus=tuple(focus),radius=radius,label=f'{mode}: {part}');paths.append(path)
preview.compose(paths,2,str(out/'comparison.png'))
assert hashlib.sha256(source.read_bytes()).hexdigest()==original_sha
(out/'probe.json').write_text(json.dumps(report,indent=2)+'\n')
print('IXARI_PROBE_DONE',flush=True)
