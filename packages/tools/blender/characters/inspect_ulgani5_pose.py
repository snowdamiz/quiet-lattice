"""Read saved fourth/fifth morph state and measure neutralization in RAM only."""
from pathlib import Path
import datetime, hashlib, json, os, sys
import bpy
import numpy as np
fourth,fifth,report_path=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(fourth)=='d0ab87a61e5b50ccb336c03b14a1553b7b2b063c7935af334ba12218bc013bc7'
assert sha(fifth)=='be08a7c2dfcbb5697325be289d232e3853dc4e0afd8b7cc2cd20062afea514ed'
assert not report_path.exists()
def array(data):
 a=np.empty(len(data)*3,np.float32);data.foreach_get('co',a);return a.reshape(-1,3)
def animation(id):
 ad=id.animation_data
 if not ad:return None
 return {'action':ad.action.name if ad.action else None,'action_slot':getattr(getattr(ad,'action_slot',None),'identifier',None),'use_nla':ad.use_nla,'nla_tracks':[{'name':t.name,'mute':t.mute,'strips':[{'name':s.name,'action':s.action.name if s.action else None,'mute':s.mute} for s in t.strips]} for t in ad.nla_tracks],'drivers':[{'data_path':d.data_path,'array_index':d.array_index,'mute':d.mute,'valid':d.is_valid,'type':d.driver.type,'expression':d.driver.expression,'variables':[{'name':v.name,'type':v.type,'targets':[{'id_name':t.id.name if t.id else None,'data_path':t.data_path} for t in v.targets]} for v in d.driver.variables]} for d in ad.drivers]}
def evaluated(o):
 deps=bpy.context.evaluated_depsgraph_get(); e=o.evaluated_get(deps);me=e.to_mesh();a=array(me.vertices);e.to_mesh_clear();return a
sources={}
for label,path in [('fourth',fourth),('fifth',fifth)]:
 bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene;scene.render.threads_mode='FIXED';scene.render.threads=2;bpy.context.view_layer.update()
 state={'path':str(path),'sha256':sha(path),'frame_current':scene.frame_current,'scene_animation':animation(scene),'objects':[],'neutral_measurements':[],'rig_pose':{}}
 rig=bpy.data.objects['RIG_ulgani'];state['rig_animation']=animation(rig);state['rig_data_animation']=animation(rig.data)
 state['rig_pose']={b.name:float(np.max(np.abs(np.asarray(b.matrix_basis)-np.eye(4)))) for b in rig.pose.bones}
 unique={}
 for o in sorted(bpy.data.objects,key=lambda x:x.name):
  if o.type!='MESH' or not o.data.shape_keys:continue
  k=o.data.shape_keys;ref=k.reference_key
  keys=[]
  for key in k.key_blocks:
   delta=array(key.data)-array(key.relative_key.data)
   keys.append({'name':key.name,'value':key.value,'reference':key==ref,'relative_key':key.relative_key.name,'mute':key.mute,'vertex_group':key.vertex_group,'slider_min':key.slider_min,'slider_max':key.slider_max,'relative_delta_max_m':float(np.linalg.norm(delta,axis=1).max()),'data_sha256':hashlib.sha256(array(key.data).tobytes()).hexdigest()})
  state['objects'].append({'object':o.name,'mesh':o.data.name,'key_datablock':k.name,'use_relative':k.use_relative,'eval_time':k.eval_time,'reference_key':ref.name,'show_only_shape_key':o.show_only_shape_key,'active_shape_key_index':o.active_shape_key_index,'object_animation':animation(o),'key_animation':animation(k),'keys':keys})
  unique.setdefault(k.as_pointer(),o)
 for o in unique.values():
  keys=o.data.shape_keys;ad=keys.animation_data
  before=evaluated(o);original={k.name:k.value for k in keys.key_blocks}
  # Inspect only: compare with all non-reference contributions zero, never save.
  for k in keys.key_blocks:
   if k!=keys.reference_key:k.value=0
  bpy.context.view_layer.update();after=evaluated(o)
  for k in keys.key_blocks:k.value=original[k.name]
  bpy.context.view_layer.update();restored=evaluated(o)
  assert before.shape==after.shape==restored.shape
  d=np.linalg.norm(before-after,axis=1);restore=np.linalg.norm(before-restored,axis=1)
  state['neutral_measurements'].append({'representative':o.name,'mesh':o.data.name,'vertices':len(before),'saved_to_zero_nonreference_evaluated_max_m':float(d.max()),'saved_to_zero_nonreference_evaluated_vertices_changed_above_1e_7_m':int((d>1e-7).sum()),'in_ram_restore_max_m':float(restore.max()),'key_animation_present':ad is not None,'saved_evaluated_sha256':hashlib.sha256(before.tobytes()).hexdigest(),'zero_nonreference_evaluated_sha256':hashlib.sha256(after.tobytes()).hexdigest()})
 sources[label]=state
fourth_by_name={o['object']:o for o in sources['fourth']['objects']}
nonzero=[]
for o in sources['fifth']['objects']:
 prior=fourth_by_name.get(o['object']);pk={k['name']:k for k in prior['keys']} if prior else {}
 for k in o['keys']:
  if abs(k['value'])<1e-7:continue
  old=pk.get(k['name']);nonzero.append({'object':o['object'],'mesh':o['mesh'],'key_datablock':o['key_datablock'],**k,'use_relative':o['use_relative'],'show_only_shape_key':o['show_only_shape_key'],'object_animation':o['object_animation'],'key_animation':o['key_animation'],'fourth_value':old['value'] if old else None,'fourth_mute':old['mute'] if old else None,'fourth_reference':old['reference'] if old else None,'inherited_same_value':old is not None and old['value']==k['value']})
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':os.getpid(),'pgid':os.getpgrp(),'threads':2,'scope':'Read-only source load;RAM-only neutral-evaluation comparisons;no source save,bake,render,export or browser','nonzero_fifth_keys':nonzero,'sources':sources,'sources_unchanged':sha(fourth)=='d0ab87a61e5b50ccb336c03b14a1553b7b2b063c7935af334ba12218bc013bc7' and sha(fifth)=='be08a7c2dfcbb5697325be289d232e3853dc4e0afd8b7cc2cd20062afea514ed'}
report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n')
print('POSE_INSPECTION_COMPLETE',report['utc'],json.dumps(nonzero),flush=True)
