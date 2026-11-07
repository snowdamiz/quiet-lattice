import bpy, sys
sys.path.insert(0, '/Users/andreyyurlov/Documents/dev/space/.claude/pause/art-bodies')
from lib import preview
old_setup=preview.setup

def cpu_setup(scene,samples=12,engine='CYCLES'):
 old_setup(scene,samples,engine)
 scene.cycles.device='CPU'
 scene.cycles.use_denoising=False

preview.setup=cpu_setup
out='.claude/pause/characters-resume'
b=bpy.data.objects['TH_Body_head1_L0'];h=bpy.data.objects['TH_Head1_head1_L0']
rig=bpy.data.objects['RIG_thalune'];hand=rig.data.bones['hand_L'];c=hand.head_local+(hand.tail_local-hand.head_local)*1.5
preview.render_views([b],out+'/thalune_r5_hands.png',views=((90,50),(-90,-40)),size=(480,440),samples=12,focus=tuple(c),radius=0.14,label='Thalune fifth-pass hands')
preview.render_views([b,h],out+'/thalune_r5_head.png',views=((0,6),(90,6)),size=(480,540),samples=12,focus=(0,0.008,1.70),radius=0.23,label='Thalune fifth-pass head')
