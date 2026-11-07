from pathlib import Path
import hashlib,json,os,stat,sys
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';P=Path('/private/tmp/t02-native189-c2-independent-2NeVsiha');S=Path(__file__).parent
ref=json.loads((P/'after.json').read_text());allowed={str(A/n) for n in ['rgb-primary.py','readiness.json','candidate-index.json','source-audit.json']};cache={};changes=[]
def sha(p):
 s=p.stat();key=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)
 if key not in cache:
  with p.open('rb') as f:cache[key]=hashlib.file_digest(f,'sha256').hexdigest()
 return cache[key]
for name,before in ref['files'].items():
 if name in allowed:continue
 p=Path(name)
 try:
  s=p.lstat();now=dict(mode=s.st_mode,bytes=s.st_size,dev=s.st_dev,ino=s.st_ino,mtime=s.st_mtime_ns)
  if stat.S_ISREG(s.st_mode):now['sha256']=sha(p)
  elif stat.S_ISLNK(s.st_mode):now['link']=os.readlink(p)
 except BaseException as e:now=dict(errorType=type(e).__name__,error=str(e))
 if now!=before:changes.append(dict(path=name,before=before,after=now))
seal=json.loads((P/'artifact-hashes.json').read_text())['evidence']
for row in seal:
 p=P/row['path'];assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256']
prospective=json.loads((A/'revision-10/prospective-paths.json').read_text())['paths'];assert len(prospective)==11 and all(not os.path.lexists(p) for p in prospective)
result=dict(status='PASS' if not changes else 'MISMATCH',reference=str(P/'after.json'),referenceSha256=sha(P/'after.json'),referenceEntries=len(ref['files']),protectedEntries=len(ref['files'])-len(allowed),allowed=sorted(allowed),changes=changes,sealedReviewFiles=len(seal),prospectiveAbsent=11,historicalFullSnapshot='FAILED_THREE_PNPM_TASK_STATE_DEVIATIONS_RETAINED',nativeJobs=0)
with (S/('preservation-'+sys.argv[1]+'.json')).open('x') as f:json.dump(result,f,indent=2)
print(json.dumps(result));assert not changes
