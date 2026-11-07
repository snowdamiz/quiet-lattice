"""Refresh only changed candidate identities; no software lookup or runtime launch."""
from pathlib import Path
import hashlib,json,os,subprocess
A=Path(__file__).resolve().parent.parent;R=A.parents[5];D=Path(__file__).parent
# Root is taken from the reviewed readiness instead of assuming directory depth.
ready=json.loads((A/'readiness.json').read_text());R=Path(ready['root'])
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
changed={str(A/n) for n in ['rgb-primary.py','native189_producer.py','native189-plan.json']}
for row in ready['bindings']:
 p=Path(row['path'])
 if str(p) in changed:row.update(bytes=p.stat().st_size,sha256=sha(p))
 else:assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
for row in ready['softwareBindings']:assert sha(Path(row['path']))==row['sha256']
assert ready['nativeFixtureAuthorization'] is True and ready['runtimeAuthorization'] is False
save(A/'readiness.json',ready)
index=json.loads((A/'candidate-index.json').read_text());index.update(phase='NATIVE189_R10_AWAITING_FRESH_REVIEW_AND_GRANT',nativeFixtureAuthorization=True,runtimeAuthorization=False)
for row in index['files']:
 p=A/row['path']
 if str(p) in changed|{str(A/'readiness.json')}:row.update(bytes=p.stat().st_size,sha256=sha(p))
 else:assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
save(A/'candidate-index.json',index)
plan=json.loads((A/'native189-plan.json').read_text());paths=json.loads((D/'prospective-paths.json').read_text())['paths'];assert all(not os.path.lexists(p) for p in paths)
command=json.loads((A/'revision-09/command.json').read_text());command['argv'][-1]=plan['grantPath'];save(D/'command.json',command)
example=json.loads((A/'revision-09/grant.example.json').read_text())
example.update(runRoot=plan['runRoot'],readinessSha256=sha(A/'readiness.json'),planSha256=sha(A/'native189-plan.json'),candidateSha256=sha(A/'candidate-index.json'))
assert example['head']=='0'*40 and example['expiresUnix']==0;save(D/'grant.example.json',example)
schema=json.loads((A/'revision-09/grant.schema.json').read_text())
for key in ['runRoot','readinessSha256','planSha256','candidateSha256']:schema['properties'][key]['const']=example[key]
save(D/'grant.schema.json',schema)
print(json.dumps(dict(sourceBindings=len(ready['bindings']),softwareBindings=len(ready['softwareBindings']),candidateRows=len(index['files']),readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'),planSha256=sha(A/'native189-plan.json'),prospectiveAbsent=len(paths))))
