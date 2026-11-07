from pathlib import Path
import datetime,hashlib,json,os,shutil,subprocess
root=Path.cwd(); stage=root/'.claude/pause/characters-resume'; author=Path('/Users/andreyyurlov/Documents/dev/space/.claude/pause/art-bodies')
authored=stage/'ulgani.blend'; source=stage/'ulgani_postprocess2.blend'; tex=stage/'textures/ulgani-postprocess2'; final=root/'assets/blend/characters/ulgani.blend'
recovery=json.loads((root/'assets/renders/characters/validate/ulgani-checkpoint-recovery2.json').read_text())
assert recovery.get('completed_utc') and hashlib.sha256(authored.read_bytes()).hexdigest()==recovery['output_sha256'], 'Require successful recovered authoring before postprocess'
assert recovery['cache_source_invariants_pass'] and len(recovery['reused_completed_maps'])==10
previous=json.loads((stage/'before-ulgani-recovery2/manifest.json').read_text())
commands=json.loads((stage/'ulgani-postprocess2.json').read_text())
env={**os.environ,'OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2','ART_KTX_JOBS':'1','BLENDER':str(stage/'blender_cpu2.py'),'KTX':str(stage/'ktx_cpu2.py'),'UV_THREADPOOL_SIZE':'2'}
def blender(script,args,input=source):
 cmd=['/Applications/Blender.app/Contents/MacOS/Blender','-b',str(input),'-t','2','--python-exit-code','1','-P',str(script),'--',*[str(x) for x in args]]
 event={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':cmd,'script_sha256':hashlib.sha256(Path(script).read_bytes()).hexdigest()}
 print(json.dumps(event),flush=True); subprocess.run(cmd,cwd=root,env=env,check=True); commands.append(event)
 (stage/'ulgani-postprocess2.json').write_text(json.dumps(commands,indent=2)+'\n')
subprocess.run(['pnpm','art:export','--','characters','--only','ulgani'],cwd=root,env=env,check=True)
print('ULGANI_SOURCE_EXPORTED',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
subprocess.run(['pnpm','art:validate','--','characters'],cwd=root,env=env,check=True)
print('CHARACTERS_SOURCE_VALIDATION_COMPLETE',flush=True)

validation=root/'assets/renders/characters/validate'
for suffix in ('blend','glb'):
 report=root/f'packages/tools/blender/reports/characters__ulgani.{suffix}.json'
 data=json.loads(report.read_text()); assert data['status']=='PASS' and data['summary']['fail']==0
 shutil.copyfile(report,validation/report.name)
blender(root/'packages/tools/blender/characters/audit.py',[root,validation/'source-audit.json'],input=final)
provenance={'note':'Checkpoint recovery and bake/postprocess provenance; not a visual grade.', 'source_sha256':hashlib.sha256(final.read_bytes()).hexdigest(),'export_sha256':hashlib.sha256((root/'packages/client/public/models/characters/ulgani.glb').read_bytes()).hexdigest(),'checkpoint_recovery':recovery,'postprocess':commands,'previous_final_assets':previous,'thread_limits':{'blender':2,'ktx_jobs':1,'ktx_threads':2,'openblas':2,'omp':2}}
sample=stage/'ulgani-recovery2-metal-sample.txt'
if sample.exists():
 lines=sample.read_text().splitlines(); provenance['sample_header']=lines[:20]; provenance['sample_gpu_stack']=[line for line in lines if 'PathTraceWorkGPU::render_samples' in line or 'MetalDeviceQueue::synchronize' in line]
(validation/'ulgani-authoring.json').write_text(json.dumps(provenance,indent=2)+'\n')
for kind in ('heads','suits'):
 blender(root/'packages/tools/blender/characters/family_copy.py',['ulgani',kind,stage/f'ulgani_{kind}.blend'],input=final)
print('ULGANI_CPU_SOURCE_FINISH',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
