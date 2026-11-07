import bpy, numpy as np, json, hashlib, sys, os
from pathlib import Path
root=Path(sys.argv[sys.argv.index('--')+1]);out=Path('/tmp/characters-whole-review-sol-20261102');result={'species':{}}
for species in ['thalune','ixari','ulgani']:
 path=root/'assets/blend/characters'/f'{species}.blend';bpy.ops.wm.open_mainfile(filepath=str(path));bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
 rigs=[o for o in bpy.data.objects if o.type=='ARMATURE'];assert len(rigs)==1
 rig=rigs[0]; entry={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'rig_name':rig.name,'rig_matrix':[list(r) for r in rig.matrix_world],'bones':{b.name:{'parent':b.parent.name if b.parent else None,'head':list(b.head_local),'tail':list(b.tail_local),'matrix':[list(r) for r in b.matrix_local]} for b in rig.data.bones},'nonzero_pose':{b.name:list(b.matrix_basis) for b in []},'variants':{},'images':{},'materials':{},'morph_meshes':{},'skin_issues':[]}
 entry['nonzero_pose']={b.name:float(np.abs(np.asarray(b.matrix_basis)-np.eye(4)).max()) for b in rig.pose.bones if not np.allclose(np.asarray(b.matrix_basis),np.eye(4),atol=1e-6)}
 checked=set()
 for kind,n in [('head',6),('suit',4)]:
  for k in range(1,n+1):
   var=f'{species}_{kind}{k}';levels=[]
   for lod in range(4):
    coll=bpy.data.collections[f'{var}_LOD{lod}'];tris=0;objects=[]
    for o in coll.all_objects:
     if o.type!='MESH':continue
     me=o.data;me.calc_loop_triangles();tris+=len(me.loop_triangles);objects.append(o.name)
     if o.name in checked:continue
     checked.add(o.name)
     arm=[m for m in o.modifiers if m.type=='ARMATURE']
     if len(arm)!=1 or arm[0].object!=rig:entry['skin_issues'].append([o.name,'armature'])
     invalid=[v.index for v in me.vertices if not v.groups or abs(sum(g.weight for g in v.groups)-1)>1e-4 or len([g for g in v.groups if g.weight>1e-6])>4]
     if invalid:entry['skin_issues'].append([o.name,'weights',len(invalid),invalid[:5]])
     group_names={g.name for g in o.vertex_groups};bad=group_names-set(entry['bones'])
     if bad:entry['skin_issues'].append([o.name,'unknown_groups',list(bad)])
     pos=np.empty(len(me.vertices)*3,np.float32);me.vertices.foreach_get('co',pos)
     if not np.isfinite(pos).all():entry['skin_issues'].append([o.name,'nonfinite'])
     if me.shape_keys:
      keys=me.shape_keys;basis=np.empty(len(keys.reference_key.data)*3,np.float32);keys.reference_key.data.foreach_get('co',basis)
      info={'relative':keys.use_relative,'active_nonreference':{},'deltas':{}}
      for key in keys.key_blocks:
       a=np.empty(len(key.data)*3,np.float32);key.data.foreach_get('co',a)
       if key!=keys.reference_key:
        info['deltas'][key.name]=float(np.linalg.norm((a-basis).reshape(-1,3),axis=1).max())
        if abs(key.value)>1e-7:info['active_nonreference'][key.name]=key.value
      entry['morph_meshes'][o.name]=info
    levels.append({'triangles':tris,'objects':objects})
   entry['variants'][var]=levels
 for im in bpy.data.images:
  if im.source=='VIEWER':continue
  entry['images'][im.name]={'size':list(im.size),'packed':bool(im.packed_file),'colorspace':im.colorspace_settings.name}
 for mat in bpy.data.materials:
  if not mat.use_nodes:continue
  entry['materials'][mat.name]={'engine_name':mat.get('engine_name'),'images':[n.image.name for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image],'bsdf_inputs':{s.name:{'linked':s.is_linked,'default':list(s.default_value) if hasattr(s.default_value,'__iter__') else s.default_value} for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED' for s in n.inputs if s.name in ['Base Color','Roughness','Metallic','Normal','Emission Color','Emission Strength']}}
 entry['reference_objects']=[o.name for o in bpy.data.objects if o.name.startswith('REF')]
 result['species'][species]=entry
 print(species,'bones',len(entry['bones']),'morphs',len(entry['morph_meshes']),'issues',len(entry['skin_issues']),flush=True)
(out/'source-audit.json').write_text(json.dumps(result,indent=2))
