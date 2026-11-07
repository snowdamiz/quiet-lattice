"""Refresh task-local source bindings and unused identities, without allocating them."""
from pathlib import Path
import hashlib,json,os
D=Path(__file__).resolve().parent;A=D.parent
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
plan_path=A/'native189-plan.json'
plan=json.loads(plan_path.read_text().replace('r10-','r12-'))
assert plan['storage']['combinedReserveBytes']==22066626560 and plan['rssBytes']==8589934592 and plan['perReelBytes']==39354368
paths=json.loads((A/'revision-11/prospective-paths.json').read_text().replace('r10-','r12-'))['paths']
assert len(paths)==11 and all(not os.path.lexists(p) for p in paths)
save(plan_path,plan)
changed={A/n for n in ['caller.py','native189.py','resource_admission.py','native189-plan.json']}
ready=json.loads((A/'readiness.json').read_text())
for row in ready['bindings']:
    p=Path(row['path'])
    if p in changed:row.update(bytes=p.stat().st_size,sha256=sha(p))
    else:assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
for row in ready['softwareBindings']:assert sha(Path(row['path']))==row['sha256'],row['path']
assert ready['nativeFixtureAuthorization'] is True and ready['runtimeAuthorization'] is False
save(A/'readiness.json',ready)
index=json.loads((A/'candidate-index.json').read_text());index['phase']='NATIVE189_R12_BOUNDED_RSS_STARTUP_AWAITING_REVIEW'
for row in index['files']:
    p=A/row['path']
    if p in changed|{A/'readiness.json'}:row.update(bytes=p.stat().st_size,sha256=sha(p))
    else:assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
save(A/'candidate-index.json',index)
save(D/'prospective-paths.json',dict(status='ABSENT_NO_ALLOCATION_R10_SPENT_UNCHANGED',paths=paths))
for name in ['command.json','grant.example.json','grant.schema.json','next-launch.json']:
    value=json.loads((A/'revision-11'/name).read_text().replace('r10-','r12-'))
    for key,path in [('readinessSha256',A/'readiness.json'),('candidateSha256',A/'candidate-index.json'),('planSha256',plan_path)]:
        if key in value:value[key]=sha(path)
        if name=='grant.schema.json':value['properties'][key]['const']=sha(path)
    if name=='next-launch.json':
        value.update(status='AWAITING_FRESH_REVIEW_AND_PARENT_ADMISSION_NO_GRANT',base='ddce6731b1fd465a1160d2f1e49813ff6f8c626c',activationHead='FINAL_CLEAN_DELIVERY_HEAD_REQUIRED',currentFreeSpaceAdmission=False,reportedCapacityBytes=36564295680,requiredCapacityBytes=22066626560,capacityQualification='Historical attempt2 admission only; not fresh capacity for r12',rssQualification='At most three stable-cut attempts within one 3s or earlier enclosing deadline; interrupted intervals retained and not accepted; no peak/quota claim',priorNative189Attempt2='FAILED_SPENT_HOLD_RELEASE_PROOF_FALSE_PRESERVED')
    save(D/name,value)
print(json.dumps(dict(bindings=len(ready['bindings']),software=len(ready['softwareBindings']),candidateRows=len(index['files']),readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'),planSha256=sha(plan_path),absentPaths=len(paths))))
