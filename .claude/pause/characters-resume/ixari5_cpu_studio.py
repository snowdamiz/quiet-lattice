from pathlib import Path
import datetime,hashlib,json,os,subprocess,time
root=Path.cwd();stage=root/'.claude/pause/characters-resume';validation=root/'assets/renders/characters/validate'
source=root/'assets/blend/characters/ixari.blend';export=root/'packages/client/public/models/characters/ixari.glb';progress=validation/'ixari-review5-cpu-studio.json';stop=stage/'stop-ixari5-cpu-studio'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
record=json.loads(progress.read_text());assert record['source_sha256']==sha(source) and record['export_sha256']==sha(export)
env={**os.environ,'OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2'}
base=['/Applications/Blender.app/Contents/MacOS/Blender','-b','--factory-startup','-t','2','--python-exit-code','1','-P','packages/tools/blender/characters/cpu_turntables.py','--']
jobs=[]
for kind,count in [('head',6),('suit',4)]:
 for n in range(1,count+1):
  key=f'{kind}{n}';manifest=validation/f'ixari-review5-cpu-{key}-turntable.json';prefix=f'ixari_ixari_ixari_{key}'
  jobs.append((key,base+[str(source),'assets/renders/characters','--samples','48','--variant',f'ixari_{key}','--manifest',str(manifest)],manifest,[root/f'assets/renders/characters/{prefix}_{ending}' for ending in ('turntable.png','materials.png','materials.txt')]))
manifest=validation/'ixari-grid-turntables.json';jobs.append(('grid',base+[str(source),'assets/renders/characters','--samples','48','--grid','10','--manifest',str(manifest)],manifest,[root/f'assets/renders/characters/ixari_{ending}' for ending in ('turntable.png','materials.png','materials.txt')]))
for kind in ('heads','suits'):
 copy=stage/f'ixari_{kind}.blend';info=json.loads(copy.with_suffix('.json').read_text());assert info['source_sha256']==record['source_sha256'] and info['copy_sha256']==sha(copy)
 manifest=validation/f'ixari-{kind}-family.json';jobs.append((kind,base+[str(copy),'assets/renders/characters','--samples','48','--family','--manifest',str(manifest)],manifest,[root/f'assets/renders/characters/ixari_{kind}_family.{extension}' for extension in ('png','txt')]))
for key,command,manifest,artifacts in jobs:
 prior=next((entry for entry in record['steps'] if entry['key']==key),None)
 if prior:
  assert all(sha(root/item['path'])==item['sha256'] for item in prior['artifacts']);continue
 if stop.exists():
  print('IXARI_CPU_STUDIO_STOPPED_AT_BOUNDARY',key,flush=True);break
 assert record['source_sha256']==sha(source) and record['export_sha256']==sha(export)
 start=time.monotonic();event={'key':key,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':command};print('IXARI_CPU_STUDIO_BEGIN',json.dumps(event),flush=True)
 subprocess.run(command,cwd=root,env=env,check=True)
 assert record['source_sha256']==sha(source)
 event['duration_seconds']=round(time.monotonic()-start,2);event['exit_code']=0;event['artifacts']=[]
 for path in artifacts+[manifest]:
  assert path.stat().st_mtime>=source.stat().st_mtime
  event['artifacts'].append({'path':str(path.relative_to(root)),'sha256':sha(path),'bytes':path.stat().st_size})
 record['steps'].append(event);progress.write_text(json.dumps(record,indent=2)+'\n');print('IXARI_CPU_STUDIO_DONE',key,event['duration_seconds'],flush=True)
else:
 record['completed_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();progress.write_text(json.dumps(record,indent=2)+'\n');print('IXARI_CPU_STUDIO_COMPLETE',record['completed_utc'],flush=True)
