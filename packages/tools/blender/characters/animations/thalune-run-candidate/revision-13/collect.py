"""Preserve new proof, verify immutable histories, and account only owned scratch."""
import hashlib,importlib.util,json,os,stat,sys
from pathlib import Path
sys.dont_write_bytecode=True
D=Path(__file__).resolve().parent;A=D.parent;ready=json.loads((A/'readiness.json').read_text());R=Path(ready['root'])
baseline=json.loads((D/'baseline.json').read_text());S=Path(baseline['scratch']);review=Path(baseline['review'])
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(p,v):
    with p.open('x') as f:json.dump(v,f,indent=2);f.write('\n')
def inventory(root):
    rows=[]
    def walk(p):
        s=p.lstat()
        if stat.S_ISDIR(s.st_mode):
            with os.scandir(p) as entries:
                for entry in entries:walk(Path(entry.path))
        else:
            assert stat.S_ISREG(s.st_mode),p
            rows.append(dict(path=str(p),bytes=s.st_size,sha256=sha(p)))
    walk(root);return sorted(rows,key=lambda r:r['path'])
review_rows=json.loads((review/'artifact-hashes.json').read_text())['evidence']
for row in review_rows:
    p=review/row['path'];assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
mutable={str((A/n).relative_to(R)) for n in ['release_accounting.py','readiness.json','candidate-index.json','source-audit.json']}
old=json.loads((A/'revision-12/combined-hash-manifest.json').read_text());protected=[]
for row in old['files']:
    if row['path'] in mutable:continue
    p=R/row['path'];assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
    protected.append(row)
attempt=json.loads((A/'revision-12/baseline.json').read_text())['retainedAttempt2']
for row in attempt:
    p=Path(row['path']);s=p.lstat()
    assert [s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_size,s.st_mtime_ns]==[row[k] for k in ['dev','ino','mode','uid','bytes','mtime']],p
    if 'sha256' in row:assert sha(p)==row['sha256'],p
required=json.loads((A/'revision-12/protected.json').read_text())['files'];exceptions=[]
for row in required:
    p=R/row['path']
    if p==A/'release_accounting.py':exceptions.append(dict(original=row,currentSha256=sha(p),reason='Explicit C2-R12-F1 production correction'))
    else:assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],p
assert len(required)==1368 and len(exceptions)==1
save(D/'protected.json',dict(status='PASS_OUTSIDE_EXPLICIT_ACCOUNTING_CORRECTION',priorManifestRows=len(protected),requiredPriorProtectedRows=1368,requiredPriorUnchangedRows=1367,authorizedSourceExceptions=exceptions,attempt2Rows=len(attempt),reviewSealRows=len(review_rows),historicalFullSnapshot='FAILED_MISMATCH_THREE_PNPM_TASK_STATE_DEVIATIONS_UNCHANGED',files=protected))
E=D/'evidence';E.mkdir();copies=[]
for phase in ['RED','GREEN']:
    target=E/phase;target.mkdir()
    for p in sorted((S/phase).iterdir()):
        if p.is_file() and p.suffix in ['.json','.stdout','.stderr']:
            dest=target/p.name;dest.write_bytes(p.read_bytes());copies.append(dict(source=str(p),path=str(dest.relative_to(R)),bytes=dest.stat().st_size,sha256=sha(dest)))
for relative,name in [('RED/supplied-red/results.json','supplied-red-results.json'),('GREEN/matrix/results.json','matrix-results.json'),('GREEN/compatible-milestones/results.json','compatible-milestones-results.json'),('GREEN/supplied54/results.json','supplied54-results.json'),('GREEN/supplied66/native-results.json','supplied-native-results.json'),('GREEN/supplied66/ordering-results.json','supplied-ordering-results.json')]:
    p=S/relative;dest=E/name;dest.write_bytes(p.read_bytes());copies.append(dict(source=str(p),path=str(dest.relative_to(R)),bytes=dest.stat().st_size,sha256=sha(dest)))
save(D/'evidence-provenance.json',copies)
raw=inventory(S);save(D/'scratch-manifest.json',dict(root=str(S),files=raw,bytes=sum(r['bytes'] for r in raw),allOriginalScratchRetained=True))
children={}
for relative in ['RED/supplied-red/results.json','RED/compatible-red.json','GREEN/compatible-milestones/results.json','GREEN/supplied54/results.json']:
    value=json.loads((S/relative).read_text());rows=value if isinstance(value,list) else value['rows']
    for row in rows:
        for child in row.get('details',{}).get('children',[]):children[child['pid']]=child
spec=importlib.util.spec_from_file_location('readonly_children',A/'retained-station/round4_capture_children.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for pid,row in children.items():row['freshIdentity']=m.identity(pid);assert row['exit']==0 and row['identity'] is None and row['freshIdentity'] is None
save(D/'child-release.json',dict(status='ALL_OWNED_HARMLESS_CHILDREN_TERMINAL_ABSENT',count=len(children),children=list(children.values()),maxConcurrentHarmlessChildren=1,nativeJobs=0))
unit=json.loads((A/'revision-12/unit-provenance.json').read_text())
unit.update(base=baseline['base'],baseTree=baseline['tree'],revision='13',recoveriesAdded=[],counts=dict(supplied=142,sinkMatrix=41,exactReviewerGreen=3,currentSourcePassingExecutions=186,oldBaseMilestones=5,cliRefusals=3),currentSourceReview='PENDING_FRESH_PARENT_REVIEW',currentCapacityAdmission=False,newNativeExecutions=0,reviewReportSha256=baseline['reviewSha256'])
unit['sourceHashes']['release_accounting.py']=sha(A/'release_accounting.py')
for name in unit['sourceHashes']:assert sha(A/name)==unit['sourceHashes'][name],name
for key,name in [('readinessSha256','readiness.json'),('candidateSha256','candidate-index.json'),('planSha256','native189-plan.json')]:unit[key]=sha(A/name)
unit['priorReview']=dict(verdict='REVISE',report=str(review/'REPORT.md'),findings=['C2-R12-F1','C2-R12-F2'],historicalSealedRed='Two constructor TypeErrors plus two genuine old failures; erroneous four-failure claim preserved and corrected only in revision-13')
save(D/'unit-provenance.json',unit)
total=sum(r['bytes'] for r in raw)+sum(r['bytes'] for r in inventory(D));assert total<=256*1024**2
save(D/'scratch-budget.json',dict(status='WITHIN_BOUND',scratchAndNewRepositoryProofBytes=total,limitBytes=256*1024**2,noCapacityProbe=True))
print(json.dumps(dict(protectedRows=len(protected),requiredProtectedRows=1368,attemptRows=len(attempt),reviewSealRows=len(review_rows),terminalChildren=len(children),scratchAndProofBytes=total,evidenceCopies=len(copies))))
