from pathlib import Path
import json,stat,os,hashlib,sys,datetime
O=Path(__file__).parent;A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');reference=Path('/private/tmp/t02-native189-r5-independent-znhry9ge/after.json');expected=json.loads(reference.read_text());phase=sys.argv[1];allowed={str(A/n) for n in ['readiness.json','candidate-index.json','source-audit.json','rgb-primary.py','native189_producer.py','native189-plan.json']} if phase=='after' else set();cache={};changes=[]
for name,before in expected['files'].items():
 if name in allowed:continue
 p=Path(name);s=p.lstat();now=dict(mode=s.st_mode,bytes=s.st_size,dev=s.st_dev,ino=s.st_ino,mtime=s.st_mtime_ns)
 if stat.S_ISLNK(s.st_mode):now['link']=os.readlink(p)
 elif stat.S_ISREG(s.st_mode):
  key=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)
  if key not in cache:
   with p.open('rb') as f:cache[key]=hashlib.file_digest(f,'sha256').hexdigest()
  now['sha256']=cache[key]
 if now!=before:changes.append(dict(path=name,before=before,after=now))
result=dict(phase=phase,observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),reference=str(reference),referenceSha256=hashlib.sha256(reference.read_bytes()).hexdigest(),originalEntries=len(expected['files']),comparedEntries=len(expected['files'])-len(allowed),allowed=sorted(allowed),changes=changes,status='PASS_CURRENT_R5_SNAPSHOT' if not changes else 'MISMATCH',historicalSnapshot='FAILED_THREE_PNPM_TASK_STATE_DEVIATIONS_UNCHANGED')
(O/('preservation-'+phase+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));assert not changes
