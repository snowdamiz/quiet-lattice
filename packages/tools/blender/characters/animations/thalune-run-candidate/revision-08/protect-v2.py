from pathlib import Path
import json,hashlib,stat,os,sys,datetime
O=Path(__file__).parent;review=Path('/private/tmp/t02-native189-r4-independent-ti5i2s4u');reference=review/'after.json';expected=json.loads(reference.read_text());A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');phase=sys.argv[1]
allowed={str(A/name) for name in ['inventory_boundary.py','readiness.json','candidate-index.json','source-audit.json']} if phase.startswith('after') else set();cache={};differences=[];count=0
for name,before in expected['files'].items():
 if name in allowed:continue
 p=Path(name)
 try:s=p.lstat()
 except OSError as error:
  differences.append(dict(path=name,before=before,after=dict(error=type(error).__name__,errno=error.errno,message=str(error))));count+=1;continue
 now=dict(mode=s.st_mode,bytes=s.st_size,dev=s.st_dev,ino=s.st_ino,mtime=s.st_mtime_ns)
 if stat.S_ISLNK(s.st_mode):now['link']=os.readlink(p)
 elif stat.S_ISREG(s.st_mode):
  key=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)
  if key not in cache:
   with p.open('rb') as f:cache[key]=hashlib.file_digest(f,'sha256').hexdigest()
  now['sha256']=cache[key]
 if now!=before:differences.append(dict(path=name,before=before,after=now))
 count+=1
result=dict(phase=phase,observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),reference=str(reference),referenceSha256=hashlib.sha256(reference.read_bytes()).hexdigest(),referenceEntries=len(expected['files']),protectedEntries=count,hashedUniqueContents=len(cache),authorizedMutable=sorted(allowed),differences=differences,status='PASS' if not differences else 'MISMATCH')
(O/('protected-'+phase+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='differences'}));print('differences',len(differences));print('\n'.join(d['path'] for d in differences));assert not differences
