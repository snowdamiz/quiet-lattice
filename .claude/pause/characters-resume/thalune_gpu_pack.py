from pathlib import Path
import datetime,hashlib,json,os,subprocess,time
root=Path.cwd(); staging=root/'.claude/pause/characters-resume'
release=staging/'gpu-review-release-thalune'
print('WAITING_FOR_THALUNE_REVIEW_GPU',str(release),flush=True)
while not release.exists(): time.sleep(1)
source=root/'assets/blend/characters/thalune.blend'; export=root/'packages/client/public/models/characters/thalune.glb'
evidence={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'export_sha256':hashlib.sha256(export.read_bytes()).hexdigest(),'steps':[]}
manifest=root/'assets/renders/characters/validate/thalune-review5-run.json'
env={**os.environ,'OPENBLAS_NUM_THREADS':'4','OMP_NUM_THREADS':'4'}
print('THALUNE_GPU_BEGIN',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
def run(command):
    event={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':command}
    print(json.dumps(event),flush=True)
    start=time.monotonic()
    subprocess.run(command,cwd=root,env=env,check=True)
    event['duration_seconds']=round(time.monotonic()-start,2)
    evidence['steps'].append(event)
    manifest.write_text(json.dumps(evidence,indent=2)+'\n')
for variant in ('head2','head3','head4','head5','head6','suit1','suit2','suit4'):
    run(['pnpm','-s','turntable','--',str(source),'assets/renders/characters','--samples','48','--variant','thalune_'+variant,'--manifest',f'assets/renders/characters/validate/thalune-{variant}-turntables.json'])
run(['pnpm','-s','turntable','--',str(source),'assets/renders/characters','--samples','48','--grid','10','--manifest','assets/renders/characters/validate/thalune-grid-turntables.json'])
for kind in ('heads','suits'):
    run(['pnpm','-s','turntable','--',str(staging/f'thalune_{kind}.blend'),'assets/renders/characters','--samples','48','--family','--manifest',f'assets/renders/characters/validate/thalune-{kind}-family.json'])
for variant in ('head1','suit3'):
    run(['/Applications/Blender.app/Contents/MacOS/Blender','-b',str(source),'-t','4','--python-exit-code','1','-P','packages/tools/blender/characters/render_details.py','--','bendtest','GPU','thalune',variant,f'assets/renders/characters/thalune_bendtest_{variant}.png'])
print('THALUNE_BROWSER_CAPTURE_BEGIN',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
run(['pnpm','capture','--','--review','characters/thalune'])
assert evidence['source_sha256']==hashlib.sha256(source.read_bytes()).hexdigest()
assert evidence['export_sha256']==hashlib.sha256(export.read_bytes()).hexdigest()
print('THALUNE_GPU_END',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
