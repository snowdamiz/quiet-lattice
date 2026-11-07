from pathlib import Path
import datetime,hashlib,json,os,shutil,subprocess
root=Path.cwd();stage=root/'.claude/pause/characters-resume/ixari5';source=stage/'ixari_final.blend';final=root/'assets/blend/characters/ixari.blend';validation=root/'assets/renders/characters/validate'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
geometry=json.loads((stage/'ixari.geometry.json').read_text());materials=json.loads((stage/'ixari_final.materials.json').read_text());invariants=json.loads((stage/'revision-invariants.json').read_text());report=json.loads((stage/'source-validation.json').read_text())
assert geometry['source_sha256']==sha(final) and materials['source_sha256']==geometry['output_sha256'] and sha(source)==materials['output_sha256']
assert invariants['before_sha256']==sha(final) and invariants['after_sha256']==sha(source) and invariants['status']=='PASS'
assert report['status']=='PASS' and report['error'] is None and report['summary']['fail']==0
assert subprocess.check_output(['git','branch','--show-current'],cwd=root,text=True).strip()=='task/P1-E05-T01'
shutil.copyfile(source,final)
for name in ('revision-invariants.json',):shutil.copyfile(stage/name,validation/f'ixari-review5-{name}')
provenance={'note':'Fifth authored revision and CPU map painting; fresh visual grade pending. No renderer/performance repair claim.', 'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'previous_source_commit':'f905f9c548ffec1cc0d48d7a01efa733f484a55a','previous_complete_artifact_commit':'6be95980aadbbd69544c141cf3b2b2e5e586e5bb','source_sha256':sha(final),'geometry':geometry,'materials':materials,'scripts':{name:sha(root/'packages/tools/blender/characters'/name) for name in ('refine_ixari_geometry.py','refine_ixari_materials.py','revision_invariants.py')}}
(validation/'ixari-review5-authoring.json').write_text(json.dumps(provenance,indent=2)+'\n')
env={**os.environ,'OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2'}
subprocess.run(['pnpm','art:export','--','characters','--only','ixari'],cwd=root,env=env,check=True)
for extension in ('blend','glb'):
 p=root/f'packages/tools/blender/reports/characters__ixari.{extension}.json';d=json.loads(p.read_text());assert d['status']=='PASS' and d['error'] is None and d['summary']['fail']==0;shutil.copyfile(p,validation/p.name)
provenance['export_sha256']=sha(root/'packages/client/public/models/characters/ixari.glb');(validation/'ixari-review5-authoring.json').write_text(json.dumps(provenance,indent=2)+'\n')
base=['/Applications/Blender.app/Contents/MacOS/Blender','-b',str(final),'-t','2','--python-exit-code','1','-P']
subprocess.run(base+[str(root/'packages/tools/blender/characters/audit.py'),'--',str(root),str(validation/'source-audit.json')],cwd=root,env=env,check=True)
for kind in ('heads','suits'):
 subprocess.run(base+[str(root/'packages/tools/blender/characters/family_copy.py'),'--','ixari',kind,str(root/f'.claude/pause/characters-resume/ixari_{kind}.blend')],cwd=root,env=env,check=True)
print('IXARI_FIFTH_FROZEN',sha(final),provenance['export_sha256'],flush=True)
