import bpy,sys
sys.path.insert(0,'/Users/andreyyurlov/Documents/dev/space/.claude/pause/art-bodies')
from lib import preview
original=preview.setup
def setup(scene,*args,**kwargs):
    original(scene,*args,**kwargs)
    scene.cycles.device='CPU'
    scene.cycles.denoising_use_gpu=False
preview.setup=setup
rig=bpy.data.objects['RIG_ixari']; h=rig.data.bones['head'].head_local
objects=[bpy.data.objects['IX_Head1_head1_L0'],bpy.data.objects['IX_Body_head1_L0']]
preview.render_views(objects,'.claude/pause/characters-resume/ixari_r4_head.png',views=((20,6),(95,6)),size=(480,540),samples=12,focus=(0,h.y,h.z+.1),radius=.32,label='Ixari fourth-pass head')
