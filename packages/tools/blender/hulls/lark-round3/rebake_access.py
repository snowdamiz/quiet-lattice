"""Rebake normal/AO from final posed LOD0 access geometry; preserve painted albedo and UVs."""
import bpy,sys,json,hashlib,time
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import bake
SRC=ROOT/'assets/blend/hulls/lark.blend';OUT=ROOT/'assets/renders/hulls/lark-round3-current'
before=hashlib.sha256(SRC.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(SRC));bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;bake.ensure_cycles(scene,8);scene.render.threads_mode='FIXED';scene.render.threads=2
records=[]
for vid in ('lark','lark_damaged','lark_husked'):
    allmeshes=[o for o in bpy.data.collections[vid+'_LOD0'].objects if o.type=='MESH']
    meshes=[o for o in allmeshes if any(s.material.get('engine_name') in ('Hull','Accent','Trim','Dark') for s in o.material_slots if s.material)]
    mats={s.material for o in meshes for s in o.material_slots if s.material};pbr={m for m in mats if m.get('engine_name') in ('Hull','Accent','Trim','Dark')}
    for o in list(scene.objects):o.hide_render=o not in allmeshes
    assert all(not o.hide_render for o in allmeshes)
    bake._select(meshes)
    scratch=bpy.data.images.new('AccessScratch',8,8);guards=[]
    for m in mats-pbr:
        n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=scratch;m.node_tree.nodes.active=n;guards.append((m,n))
    baked={}
    for channel,kind in (('normal','NORMAL'),('AO','AO')):
        image=bake._new_target(vid+'_final_4k_'+channel,4096,False);targets=[];start=time.monotonic()
        for m in pbr:
            node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;m.node_tree.nodes.active=node;targets.append((m,node))
        bpy.ops.object.bake(type=kind,use_clear=False,normal_space='TANGENT');bake._finish(image,vid,'normal' if channel=='normal' else 'occlusion')
        for m,node in targets:m.node_tree.nodes.remove(node)
        baked[channel]=image
        records.append({'variant':vid,'channel':channel,'resolution':4096,'source_lod':0,'seconds':time.monotonic()-start})
        print('FINAL ACCESS BAKE',vid,channel,flush=True)
    for m,node in guards:m.node_tree.nodes.remove(node)
    bpy.data.images.remove(scratch)
    old_normals=set()
    for m in pbr:
        for node in m.node_tree.nodes:
            if node.type=='TEX_IMAGE' and node.image and node.image.name in (vid+'_4k_normal',vid+'_final_4k_normal'):
                old_normals.add(node.image);node.image=baked['normal']
        m['final_normal_ao_source_sha256']=before
    for image in old_normals:
        assert image.users==0;bpy.data.images.remove(image)
    assert old_normals
    baked['normal'].name=vid+'_final_4k_normal'
    orm=bpy.data.images[vid+'_4k_ORM'];pixels=np.empty(len(orm.pixels),np.float32);ao=np.empty_like(pixels);orm.pixels.foreach_get(pixels);baked['AO'].pixels.foreach_get(ao);pixels[0::4]=ao[0::4];orm.pixels.foreach_set(pixels);orm.update();orm.pack();bpy.data.images.remove(baked['AO']);baked['normal'].pack()
bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
(OUT/'final-access-bake.json').write_text(json.dumps({'input_source_sha256':before,'output_source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'records':records,'geometry_policy':'Final LOD0 only; identical maps on LOD1-3, no lower-LOD bake'},indent=2)+'\n')
