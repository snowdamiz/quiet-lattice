from pathlib import Path
import datetime,hashlib,json,os,subprocess,time
root=Path.cwd();stage=root/'.claude/pause/characters-resume';release=stage/'gpu-review-release-ixari5';validation=root/'assets/renders/characters/validate'
print('WAITING_FOR_IXARI_REVIEW_GPU',release,flush=True)
while not release.exists():time.sleep(1)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=root/'assets/blend/characters/ixari.blend';export=root/'packages/client/public/models/characters/ixari.glb'
evidence={'source_sha256':sha(source),'export_sha256':sha(export),'steps':[]};manifest=validation/'ixari-review5-run.json';env={**os.environ,'OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2'}
for kind in ('heads','suits'):
 copy=stage/f'ixari_{kind}.blend';info=json.loads(copy.with_suffix('.json').read_text());assert info['source_sha256']==evidence['source_sha256'] and info['copy_sha256']==sha(copy)
cpu_details=json.loads((validation/'ixari-review5-cpu-details.json').read_text());assert cpu_details['source_sha256']==evidence['source_sha256'] and cpu_details['deformation']['exit_code']==0
for artifact in cpu_details['artifacts']:assert sha(root/artifact['path'])==artifact['sha256']
evidence['cpu_details_sha256']=sha(validation/'ixari-review5-cpu-details.json')
completed=set();cpu_path=validation/'ixari-review5-cpu-studio.json'
if cpu_path.exists():
 cpu=json.loads(cpu_path.read_text());assert cpu['source_sha256']==evidence['source_sha256'] and cpu['export_sha256']==evidence['export_sha256']
 for event in cpu['steps']:
  assert event['exit_code']==0 and all(sha(root[item['path']])==item['sha256'] for item in event['artifacts'])
  completed.add(event['key'])
 evidence['steps'].extend(cpu['steps']);evidence['cpu_studio_sha256']=sha(cpu_path)
print('IXARI_GPU_BEGIN',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
def run(command):
 event={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':command};print(json.dumps(event),flush=True);start=time.monotonic();subprocess.run(command,cwd=root,env=env,check=True);event['duration_seconds']=round(time.monotonic()-start,2);evidence['steps'].append(event);manifest.write_text(json.dumps(evidence,indent=2)+'\n')
variants=[f'{kind}{n}' for kind,count in [('head',6),('suit',4)] for n in range(1,count+1)]
for variant in variants:
 if variant not in completed:
  run(['pnpm','-s','turntable','--',str(source),'assets/renders/characters','--samples','48','--variant',f'ixari_{variant}','--manifest',f'assets/renders/characters/validate/ixari-review5-{variant}-turntable.json'])
individual=[]
for variant in variants:
 path=validation/f'ixari-review5-{"cpu-" if variant in completed else ""}{variant}-turntable.json';data=json.loads(path.read_text());assert Path(data['source'])==source and len(data['sheets'])==1;individual.extend(data['sheets'])
(validation/'ixari-turntables.json').write_text(json.dumps({'source':str(source),'targets':[['ixari',f'ixari_{variant}'] for variant in variants],'sheets':individual,'source_sha256':evidence['source_sha256']},indent=2)+'\n')
if 'grid' not in completed:run(['pnpm','-s','turntable','--',str(source),'assets/renders/characters','--samples','48','--grid','10','--manifest','assets/renders/characters/validate/ixari-grid-turntables.json'])
for kind in ('heads','suits'):
 if kind not in completed:run(['pnpm','-s','turntable','--',str(stage/f'ixari_{kind}.blend'),'assets/renders/characters','--samples','48','--family','--manifest',f'assets/renders/characters/validate/ixari-{kind}-family.json'])
print('IXARI_BROWSER_CAPTURE_BEGIN',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
run(['pnpm','capture','--','--review','characters/ixari'])
assert evidence['source_sha256']==sha(source) and evidence['export_sha256']==sha(export)
print('IXARI_GPU_END',datetime.datetime.now(datetime.timezone.utc).isoformat(),flush=True)
