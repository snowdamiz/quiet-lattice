"""Refresh one production source identity, keeping flags, plan and software pins."""
import hashlib,json,os
from pathlib import Path
D=Path(__file__).resolve().parent;A=D.parent
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
changed=A/'release_accounting.py';ready=json.loads((A/'readiness.json').read_text())
for r in ready['bindings']:
    p=Path(r['path'])
    if p==changed:r.update(bytes=p.stat().st_size,sha256=sha(p))
    else:assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256'],p
for r in ready['softwareBindings']:assert sha(Path(r['path']))==r['sha256']
assert ready['nativeFixtureAuthorization'] is True and ready['runtimeAuthorization'] is False
save(A/'readiness.json',ready)
index=json.loads((A/'candidate-index.json').read_text());index['phase']='NATIVE189_R13_TERMINAL_DURABILITY_AND_RED_CORRECTION_AWAITING_REVIEW'
for r in index['files']:
    p=A/r['path']
    if p in [changed,A/'readiness.json']:r.update(bytes=p.stat().st_size,sha256=sha(p))
    else:assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256'],p
save(A/'candidate-index.json',index)
paths=json.loads((A/'revision-12/prospective-paths.json').read_text())['paths'];assert len(paths)==11 and all(not os.path.lexists(p) for p in paths)
save(D/'prospective-paths.json',dict(status='UNCHANGED_ABSENT_NO_ALLOCATION',paths=paths))
for name in ['command.json','grant.example.json','grant.schema.json','next-launch.json']:
    value=json.loads((A/'revision-12'/name).read_text())
    for key,path in [('readinessSha256',A/'readiness.json'),('candidateSha256',A/'candidate-index.json'),('planSha256',A/'native189-plan.json')]:
        if key in value:value[key]=sha(path)
        if name=='grant.schema.json':value['properties'][key]['const']=sha(path)
    if name=='next-launch.json':value.update(status='AWAITING_FRESH_REVIEW_NO_GRANT',base='ff497e5525f8e93c71df67827446d7e426bbc20d',activationHead='FINAL_CLEAN_DELIVERY_HEAD_REQUIRED',currentFreeSpaceAdmission=False,capacityQualification='No live capacity observation in this unit; parent must make fresh admission',terminalReleaseQualification='Positive terminal release audit AND a verified complete terminal-summary destination')
    save(D/name,value)
print(json.dumps(dict(bindings=len(ready['bindings']),software=len(ready['softwareBindings']),indexRows=len(index['files']),absentPaths=len(paths),readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'))))
