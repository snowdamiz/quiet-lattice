from pathlib import Path
import datetime,hashlib,json,os,shutil,subprocess
root=Path.cwd(); stage=root/'.claude/pause/characters-resume'; author=Path('/Users/andreyyurlov/Documents/dev/space/.claude/pause/art-bodies')
source=stage/'ulgani.blend'; tex=stage/'textures/ulgani'; final=root/'assets/blend/characters/ulgani.blend'
recovery=json.loads((root/'assets/renders/characters/validate/ulgani-checkpoint-recovery.json').read_text())
assert recovery.get('completed_utc') and hashlib.sha256(source.read_bytes()).hexdigest()==recovery['output_sha256'], 'Require successful recovered authoring before postprocess'
commands=[]; env={**os.environ,'OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2'}
def blender(script,args,input=source):
 cmd=['/Applications/Blender.app/Contents/MacOS/Blender','-b',str(input),'-t','2','--python-exit-code','1','-P',str(script),'--',*[str(x) for x in args]]
 event={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':cmd,'script_sha256':hashlib.sha256(Path(script).read_bytes()).hexdigest()}
 print(json.dumps(event),flush=True); subprocess.run(cmd,cwd=root,env=env,check=True); commands.append(event)
 (stage/'ulgani-postprocess.json').write_text(json.dumps(commands,indent=2)+'\n')
blender(author/'r3/trim_suits.py',['ulgani','146000',source])
blender(author/'r3/fill_bg.py',['ulgani',tex,source])
blender(author/'r3/ao_floor.py',[tex,source,'UL_Frond=0.65','UL_SuitA=0.4','UL_SuitB=0.4','UL_Skin=0.6'])
blender(author/'fix_meshes.py',[source])
blender(root/'packages/tools/blender/validate.py',['--family','characters','--report',stage/'ulgani-source-validation.json',source])
blender(author/'embed_save.py',[author,final])
print('ULGANI_SOURCE_FINAL_SAVED',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
subprocess.run(['pnpm','art:export','--','characters','--only','ulgani'],cwd=root,env=env,check=True)
print('ULGANI_SOURCE_EXPORTED',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)

validation=root/'assets/renders/characters/validate'
for suffix in ('blend','glb'):
 report=root/f'packages/tools/blender/reports/characters__ulgani.{suffix}.json'
 data=json.loads(report.read_text()); assert data['status']=='PASS' and data['summary']['fail']==0
 shutil.copyfile(report,validation/report.name)
blender(root/'packages/tools/blender/characters/audit.py',[root,validation/'source-audit.json'],input=final)
provenance={'note':'Checkpoint recovery and bake/postprocess provenance; not a visual grade.', 'source_sha256':hashlib.sha256(final.read_bytes()).hexdigest(),'export_sha256':hashlib.sha256((root/'packages/client/public/models/characters/ulgani.glb').read_bytes()).hexdigest(),'checkpoint_recovery':recovery,'postprocess':commands}
sample=stage/'ulgani-bake-sample.txt'
if sample.exists():
 lines=sample.read_text().splitlines(); provenance['sample_header']=lines[:20]; provenance['sample_gpu_stack']=[line for line in lines if 'PathTraceWorkGPU::render_samples' in line or 'MetalDeviceQueue::synchronize' in line]
(validation/'ulgani-authoring.json').write_text(json.dumps(provenance,indent=2)+'\n')
for kind in ('heads','suits'):
 blender(root/'packages/tools/blender/characters/family_copy.py',['ulgani',kind,stage/f'ulgani_{kind}.blend'],input=final)
print('ULGANI_CPU_SOURCE_FINISH',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
