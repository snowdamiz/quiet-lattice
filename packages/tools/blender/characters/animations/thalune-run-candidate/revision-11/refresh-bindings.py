"""Refresh only the encoder identity and derived metadata; no runtime admission."""
from pathlib import Path
import hashlib,json,os
D=Path(__file__).parent;A=D.parent

def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
ready=json.loads((A/'readiness.json').read_text());changed=A/'rgb-primary.py'
for row in ready['bindings']:
 p=Path(row['path'])
 if p==changed:row.update(bytes=p.stat().st_size,sha256=sha(p))
 else:assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
for row in ready['softwareBindings']:assert sha(Path(row['path']))==row['sha256']
assert ready['nativeFixtureAuthorization'] is True and ready['runtimeAuthorization'] is False
save(A/'readiness.json',ready)
index=json.loads((A/'candidate-index.json').read_text());index['phase']='NATIVE189_R11_ACK_ACCOUNTING_AWAITING_REVIEW_CAPACITY_HOLD'
for row in index['files']:
 p=A/row['path']
 if p in [changed,A/'readiness.json']:row.update(bytes=p.stat().st_size,sha256=sha(p))
 else:assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
save(A/'candidate-index.json',index)
paths=json.loads((A/'revision-10/prospective-paths.json').read_text())['paths'];assert all(not os.path.lexists(p) for p in paths)
save(D/'prospective-paths.json',dict(status='UNCHANGED_ABSENT_NO_ALLOCATION',paths=paths))
for name in ['command.json','grant.example.json','grant.schema.json','next-launch.json']:
 value=json.loads((A/'revision-10'/name).read_text())
 for key,path in [('readinessSha256',A/'readiness.json'),('candidateSha256',A/'candidate-index.json'),('planSha256',A/'native189-plan.json')]:
  if key in value:value[key]=sha(path)
  if name=='grant.schema.json':value['properties'][key]['const']=sha(path)
 if name=='next-launch.json':value.update(status='AWAITING_FRESH_REVIEW_AND_CAPACITY_NO_GRANT',base='3503cd7d5187b78140bc22fbb5e418ee9f2c6798',activationHead='FINAL_CLEAN_DELIVERY_HEAD_REQUIRED',currentFreeSpaceAdmission=False,reportedCapacityBytes=19745017856,requiredCapacityBytes=22066626560,capacityQualification='Parent/reviewer observation retained; no fresh runtime admission in this unit')
 save(D/name,value)
print(json.dumps(dict(bindings=len(ready['bindings']),software=len(ready['softwareBindings']),candidateRows=len(index['files']),readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'),planSha256=sha(A/'native189-plan.json'))))
