"""CPU-only real-source positive/negative controls for the neutral morph guard."""
from pathlib import Path
import ast,datetime,hashlib,json,os,sys
import bpy
import numpy as np
source,report_path=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:])
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(source)=='be08a7c2dfcbb5697325be289d232e3853dc4e0afd8b7cc2cd20062afea514ed'
assert not report_path.exists()
bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
helper=Path(__file__).with_name('bake_ulgani5.py');tree=ast.parse(helper.read_text());functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='assert_neutral_morphs'];assert len(functions)==1
exec(compile(ast.Module(body=functions,type_ignores=[]),str(helper),'exec'),globals())
utility=Path(__file__).with_name('cleanup_ulgani5_source.py');tree=ast.parse(utility.read_text());functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('array_digest','snapshot')];assert len(functions)==2
exec(compile(ast.Module(body=functions,type_ignores=[]),str(utility),'exec'),globals())
def key_state():
 return {o.name:{'use_relative':o.data.shape_keys.use_relative,'reference':o.data.shape_keys.reference_key.name,'show_only_shape_key':o.show_only_shape_key,'key_animation':str(o.data.shape_keys.animation_data),'object_animation':str(o.animation_data),'keys':{k.name:{'value':k.value,'mute':k.mute,'relative':k.relative_key.name,'vertex_group':k.vertex_group} for k in o.data.shape_keys.key_blocks}} for o in bpy.data.objects if o.type=='MESH' and o.data.shape_keys}
def evaluated(o):
 e=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();a=np.empty(len(m.vertices)*3,np.float32);m.vertices.foreach_get('co',a);e.to_mesh_clear();return a
before=snapshot();original_keys=key_state();references=assert_neutral_morphs();old_guard_rejected=any(abs(k.value)>=1e-7 for o in bpy.data.objects if o.type=='MESH' and o.data.shape_keys for k in o.data.shape_keys.key_blocks)
assert old_guard_rejected and len(references)==10 and all(r['key']=='Basis' and r['value']==1 for r in references)
obj=bpy.data.objects['UL_Head1_head1_L0'];neutral_evaluated=evaluated(obj);key=obj.data.shape_keys.key_blocks['vis_FV'];original=key.value;assert original==0
try:
 key.value=.25;bpy.context.view_layer.update()
 try:assert_neutral_morphs()
 except AssertionError as exc:negative_error=str(exc)
 else:raise AssertionError('Guard incorrectly accepted an active vis_FV key')
 assert 'vis_FV' in negative_error and 'UL_Head1' in negative_error,negative_error
finally:
 key.value=original;bpy.context.view_layer.update()
assert references==assert_neutral_morphs()
assert before==snapshot(),'Guard control changed geometry,UVs,weights,morph data,bindings,packed images or rig'
assert original_keys==key_state(),'Guard control changed saved shape-key values/settings or animation state'
assert np.array_equal(neutral_evaluated,evaluated(obj)),'RAM negative control failed to restore evaluated pose'
assert sha(source)=='be08a7c2dfcbb5697325be289d232e3853dc4e0afd8b7cc2cd20062afea514ed'
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':os.getpid(),'pgid':os.getpgrp(),'threads':2,'source':str(source),'source_sha256':sha(source),'helper_sha256':sha(helper),'old_guard_false_positive_reproduced':old_guard_rejected,'corrected_guard_accepts_saved_neutral':True,'excluded_reference_entries':references,'negative_control':{'object':obj.name,'key':'vis_FV','value':.25,'corrected_guard_rejected':True,'message':negative_error,'restored_original_value':original},'source_and_every_morph_data_geometry_uv_weights_material_bindings_packed_images_69bone_rest_unchanged':True,'saved_pose_values_animation_settings_unchanged':True,'evaluated_pose_restored_exactly':True,'scope':'CPU-only guard extraction and tests;no bake helper module execution,no source save,no render/export/browser/GPU'}
report_path.write_text(json.dumps(report,indent=2)+'\n');print('POSE_GUARD_VALIDATED',report['utc'],sha(report_path),flush=True)
