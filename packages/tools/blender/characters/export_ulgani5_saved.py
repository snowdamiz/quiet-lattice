"""Guarded CPU-only entry to the unchanged shared exporter for one saved Ulgani source.

No procedural bake/LOD generation is permitted. A preflight-only run proves the
actual material plans and saved/reopened source bindings before promotion.
"""
from pathlib import Path
import argparse,ast,datetime,hashlib,json,os,sys
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from artlib import bake,checks as C,core,export as E,lods,materials as M,rules as R
parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);parser.add_argument('--report',type=Path,required=True);parser.add_argument('--report-dir',type=Path);parser.add_argument('--out-dir',type=Path);parser.add_argument('--preflight-only',action='store_true');args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
root=R.REPO;source=args.input.resolve();report_path=args.report.resolve();sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();expected='06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b'
assert sha(source)==expected and not report_path.exists();assert not (root/'.claude/pause/characters-resume/gpu-release-ulgani5-bake').exists()
report={'started_utc':utc(),'pid':os.getpid(),'pgid':os.getpgrp(),'threads':2,'source':str(source),'source_sha256':expected,'scope':'CPU-only saved source preflight or unchanged exporter;no bake/LOD generation/peer export','preflight_only':args.preflight_only,'exporter_sha256':sha(Path(E.__file__)),'entrypoint_sha256':sha(root/'packages/tools/blender/export_characters.py'),'children':[],'forbidden_calls':[],'status':'preflight'}
def save():report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n')
save();rules=R.load();check=core.validate_path(rules,source,family='characters');assert check.status=='PASS' and not check.failures();model=check.model
bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2
assert not bpy.context.scene.get('review5_material_bake_pending')
assert all(not bpy.data.materials['UL_'+g].get('review5_bake_pending') for g in ('Skin','SuitA','SuitB'))
plans=[];variants=[]
for asset in model.assets:
 assert asset.name=='ulgani',asset.name
 for variant in asset.variants.values():
  assert sorted(variant.lods)==[0,1,2,3]
  variants.append(variant.id)
  for mat in C._materials_of(rules,variant):
   info=M.MaterialInfo(mat);ao=C.ao_to_bake(rules,'characters',variant.cls,info);todo=bake.channels_to_bake(info,ao) if info.bsdf else []
   item={'variant':variant.id,'material':mat.name,'engine_name':R.material_name(mat),'ao_to_bake':ao,'channels_to_bake':todo,'linked':bool(mat.library),'channels':{k:v.kind for k,v in info.channels.items()}}
   plans.append(item);assert info.bsdf is not None and not info.problem and not todo,item
assert set(variants)=={f'ulgani_{kind}{n}' for kind,count in [('head',6),('suit',4)] for n in range(1,count+1)}
report.update(material_plans=plans,variants=variants,explicit_four_lods_all_variants=True,no_material_bake_needed=True)
# Reopen the exact saved file and compare full geometry/morph/material/image/rig data.
utility=Path(__file__).with_name('cleanup_ulgani5_source.py');tree=ast.parse(utility.read_text());functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('array_digest','snapshot')];assert len(functions)==2;exec(compile(ast.Module(body=functions,type_ignores=[]),str(utility),'exec'),globals())
before=snapshot();bpy.ops.wm.open_mainfile(filepath=str(source));assert before==snapshot();report['saved_reopened_geometry_uv_weights_all_morphs_material_bindings_packed_images_69bone_rest_identical']=True
bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2;report.update(preflight_completed_utc=utc(),status='preflight_pass');save();print('ULGANI5_EXPORT_PREFLIGHT_PASS',report['preflight_completed_utc'],flush=True)
if args.preflight_only:sys.exit(0)
assert source==(root/'assets/blend/characters/ulgani.blend').resolve();assert args.report_dir and args.out_dir
# Keep exporter implementation unchanged. These boundaries fail before any unexpected heavy stage.
def forbidden(name):
 def reject(*a,**kw):
  report['forbidden_calls'].append({'name':name,'utc':utc()});save();raise RuntimeError('CPU-only saved-source export forbids '+name)
 return reject
bake.ensure_cycles=forbidden('ensure_cycles');bake.bake_material=forbidden('bake_material');lods.generate=forbidden('lods.generate')
# Record each owned external codec process without changing its arguments/behavior.
import subprocess
OriginalPopen=subprocess.Popen
class RecordedPopen(OriginalPopen):
 def __init__(self,*a,**kw):
  super().__init__(*a,**kw)
  command=kw.get('args',a[0] if a else None)
  report['children'].append({'pid':self.pid,'pgid':os.getpgid(self.pid),'start_observed_utc':utc(),'command':list(command) if isinstance(command,(list,tuple)) else command});save()
subprocess.Popen=RecordedPopen
report.update(export_started_utc=utc(),status='exporting');save()
result=E.main('characters',['--only','ulgani','--report-dir',str(args.report_dir),'--out-dir',str(args.out_dir)])
assert result==0 and not report['forbidden_calls'];assert sha(source)==expected
output=args.out_dir/'characters/ulgani.glb';assert output.exists();report.update(export_completed_utc=utc(),status='EXPORTED_CPU_ONLY_NO_BAKE_NO_GENERATION',output=str(output.resolve()),output_sha256=sha(output),output_bytes=output.stat().st_size);save();print('ULGANI5_SAVED_SOURCE_EXPORTED',report['export_completed_utc'],report['output_sha256'],flush=True)
