from pathlib import Path
import datetime,hashlib,json,os,subprocess,time
root=Path.cwd(); staging=root/'.claude/pause/characters-resume'; release=staging/'gpu-review-release-ulgani'
print('WAITING_FOR_ULGANI_REVIEW_GPU',release,flush=True)
while not release.exists(): time.sleep(1)
source=root/'assets/blend/characters/ulgani.blend'; export=root/'packages/client/public/models/characters/ulgani.glb'
provenance=json.loads((root/'assets/renders/characters/validate/ulgani-authoring.json').read_text())
assert provenance['checkpoint_recovery']['completed_utc'], 'Recovered fourth-pass authoring must finish first'
assert provenance['source_sha256']==hashlib.sha256(source.read_bytes()).hexdigest()
assert provenance['export_sha256']==hashlib.sha256(export.read_bytes()).hexdigest()
for kind in ('heads','suits'):
    copy=staging/f'ulgani_{kind}.blend'; info=json.loads(copy.with_suffix('.json').read_text())
    assert info['source_sha256']==hashlib.sha256(source.read_bytes()).hexdigest()
    assert info['copy_sha256']==hashlib.sha256(copy.read_bytes()).hexdigest()
evidence={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'export_sha256':hashlib.sha256(export.read_bytes()).hexdigest(),'steps':[]}
manifest=root/'assets/renders/characters/validate/ulgani-review4-run.json'; env={**os.environ,'OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2'}
print('ULGANI_GPU_BEGIN',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
def run(command):
    event={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':command}; print(json.dumps(event),flush=True); start=time.monotonic()
    subprocess.run(command,cwd=root,env=env,check=True)
    event['duration_seconds']=round(time.monotonic()-start,2); evidence['steps'].append(event); manifest.write_text(json.dumps(evidence,indent=2)+'\n')
run(['pnpm','-s','turntable','--',str(source),'assets/renders/characters','--samples','48','--manifest','assets/renders/characters/validate/ulgani-turntables.json'])
run(['pnpm','-s','turntable','--',str(source),'assets/renders/characters','--samples','48','--grid','10','--manifest','assets/renders/characters/validate/ulgani-grid-turntables.json'])
for kind in ('heads','suits'):
    run(['pnpm','-s','turntable','--',str(staging/f'ulgani_{kind}.blend'),'assets/renders/characters','--samples','48','--family','--manifest',f'assets/renders/characters/validate/ulgani-{kind}-family.json'])
for variant in ('head1','suit3'):
    run(['/Applications/Blender.app/Contents/MacOS/Blender','-b',str(source),'-t','2','--python-exit-code','1','-P','packages/tools/blender/characters/render_details.py','--','bendtest','GPU','ulgani',variant,f'assets/renders/characters/ulgani_bendtest_{variant}.png'])
print('ULGANI_BROWSER_CAPTURE_BEGIN',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
run(['pnpm','capture','--','--review','characters/ulgani'])
assert evidence['source_sha256']==hashlib.sha256(source.read_bytes()).hexdigest()
assert evidence['export_sha256']==hashlib.sha256(export.read_bytes()).hexdigest()
print('ULGANI_GPU_END',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
