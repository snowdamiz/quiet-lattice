exec(open(__file__.replace('wear2_atlas','wear2_probe')).read())
im=bpy.data.images['lark_4k_density_baseColor'];im.scale(768,768);im.filepath_raw=str(D/'previews/wear2-atlas-before.png');im.file_format='PNG';im.save()
for role in ('Hull','Accent','Trim','Dark'):
 vals=[]
 for o in bpy.data.collections['lark_LOD0'].all_objects:
  if o.type!='MESH':continue
  u=o.data.uv_layers.active
  for p in o.data.polygons:
   if o.data.materials[p.material_index].get('engine_name')==role:vals.extend(tuple(u.data[i].uv) for i in p.loop_indices)
 print(role,np.min(vals,axis=0),np.max(vals,axis=0))
