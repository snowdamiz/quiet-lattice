"""Bake one revised LOD0 atlas on CPU and save it in the editable source; no export-time authoring."""
import bpy,sys,json,hashlib,time
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import bake,materials as M
vid=sys.argv[sys.argv.index('--')+1]
SRC=ROOT/'assets/blend/hulls/lark.blend';OUT=ROOT/'assets/renders/hulls/lark-round3-current'
before=hashlib.sha256(SRC.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SRC));bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;bake.ensure_cycles(scene,samples=8);scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.bake.margin=12
coll=bpy.data.collections[vid+'_LOD0'];allmeshes=[o for o in coll.objects if o.type=='MESH']
meshes=[o for o in allmeshes if any(s.material.get('engine_name') in ('Hull','Accent','Trim','Dark') for s in o.material_slots if s.material)]
mats={s.material for o in meshes for s in o.material_slots if s.material}
pbr={m for m in mats if m.get('engine_name') in ('Hull','Accent','Trim','Dark')}
assert all(not m.get('round3_baked') for m in pbr),'Fresh bake only'
for o in list(scene.objects):o.hide_render=o not in allmeshes
assert all(not o.hide_render for o in allmeshes)
assert all(o.hide_render for o in scene.objects if o.type=='MESH' and o not in allmeshes)
bake._select(meshes)
keep={m:next(n for n in m.node_tree.nodes if n.type=='OUTPUT_MATERIAL') for m in mats}
surfaces={m:out.inputs['Surface'].links[0].from_socket for m,out in keep.items()}
guards=[];scratch=bpy.data.images.new('BakeScratch',8,8)
for m in mats-pbr:
    n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=scratch;m.node_tree.nodes.active=n;guards.append((m,n))
images={};receipts=[]
for channel,kind,layer in [('baseColor','EMIT','PaintColor'),('ORM','EMIT','PaintORM'),('normal','NORMAL',None),('AO','AO',None)]:
    start=time.monotonic();image=bake._new_target(vid+'_4k_'+channel,4096,channel=='baseColor');images[channel]=image
    nodes=[];emissions=[]
    for m in pbr:
        nt=m.node_tree;n=nt.nodes.new('ShaderNodeTexImage');n.image=image;nt.nodes.active=n;nodes.append((m,n))
        if kind=='EMIT':
            attr=nt.nodes.new('ShaderNodeVertexColor');attr.layer_name=layer
            em=nt.nodes.new('ShaderNodeEmission');nt.links.new(attr.outputs['Color'],em.inputs['Color']);nt.links.new(em.outputs['Emission'],keep[m].inputs['Surface']);emissions.extend([(m,em),(m,attr)])
    bpy.ops.object.bake(type=kind,use_clear=False,normal_space='TANGENT')
    bake._finish(image,vid, 'occlusion' if channel=='AO' else 'roughness' if channel=='ORM' else channel)
    for m,n in nodes:m.node_tree.nodes.remove(n)
    for m,n in emissions:m.node_tree.nodes.remove(n)
    for m in pbr:m.node_tree.links.new(surfaces[m],keep[m].inputs['Surface'])
    raw=np.empty(4096*4096*4,np.float32);image.pixels.foreach_get(raw)
    receipts.append({'channel':channel,'size':[4096,4096],'bake_type':kind,'source_lod':0,'pixel_float_sha256':hashlib.sha256(raw.tobytes()).hexdigest(),'std_rgb':raw.reshape(-1,4)[:,:3].std(0).tolist(),'seconds':time.monotonic()-start})
    print('BAKE',vid,channel,round(time.monotonic()-start,1),flush=True)
for m,n in guards:m.node_tree.nodes.remove(n)
bpy.data.images.remove(scratch)
orm=np.empty(4096*4096*4,np.float32);ao=np.empty_like(orm)
images['ORM'].pixels.foreach_get(orm);images['AO'].pixels.foreach_get(ao);orm[0::4]=ao[0::4];images['ORM'].pixels.foreach_set(orm);images['ORM'].update();images['ORM'].pack();bpy.data.images.remove(images['AO'])
for m in pbr:
    nt=m.node_tree;nt.nodes.clear();bs=nt.nodes.new('ShaderNodeBsdfPrincipled');out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
    textures={}
    for ch in ('baseColor','ORM','normal'):
        n=nt.nodes.new('ShaderNodeTexImage');n.image=images[ch];textures[ch]=n
    nt.links.new(textures['baseColor'].outputs['Color'],bs.inputs['Base Color'])
    sep=nt.nodes.new('ShaderNodeSeparateColor');nt.links.new(textures['ORM'].outputs['Color'],sep.inputs['Color']);nt.links.new(sep.outputs['Green'],bs.inputs['Roughness']);nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
    grp=nt.nodes.new('ShaderNodeGroup');grp.node_tree=bake._gltf_group();nt.links.new(sep.outputs['Red'],grp.inputs['Occlusion'])
    norm=nt.nodes.new('ShaderNodeNormalMap');nt.links.new(textures['normal'].outputs['Color'],norm.inputs['Color']);nt.links.new(norm.outputs['Normal'],bs.inputs['Normal'])
    m['round3_baked']=True;m['bake_source_lod']=0;m['bake_resolution']=4096;m['bake_source_sha256']=before
# Packed maps are editable texture-paint masters. No active vertex colours may double-multiply these in glTF.
for c in bpy.data.collections:
    if c.name.startswith(vid+'_LOD'):
        for o in c.objects:
            if o.type=='MESH':
                for a in list(o.data.color_attributes):o.data.color_attributes.remove(a)
for ch in ('baseColor','ORM','normal'):
    images[ch].pack()
bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
path=OUT/(vid+'-bake-receipt.json');assert not path.exists()
path.write_text(json.dumps({'variant':vid,'input_source_sha256':before,'output_source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'resolution':4096,'device':'CPU','threads':2,'geometry':[{'name':o.name,'vertices':len(o.data.vertices),'polygons':len(o.data.polygons)} for o in meshes],'maps':receipts,'low_lod_policy':'identical shared image datablocks, inherited UVs from revised LOD0; no lower-LOD bake'},indent=2)+'\n')
