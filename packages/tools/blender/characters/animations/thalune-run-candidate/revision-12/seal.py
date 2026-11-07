"""Seal source-only evidence after focused controls; never admit or run a native job."""
from pathlib import Path
import ast,hashlib,json,os,subprocess,sys
sys.dont_write_bytecode=True
D=Path(__file__).resolve().parent;A=D.parent;ready=json.loads((A/'readiness.json').read_text());R=Path(ready['root']);sys.path.insert(0,str(A))
from inventory_boundary import paths
BASE='ddce6731b1fd465a1160d2f1e49813ff6f8c626c'
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def row(p):return dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
commands=[]
for mode in ['--write','--check']:
    argv=[ready['node'],str(R/'node_modules/prettier/bin/prettier.cjs'),mode,'--ignore-path','/dev/null',*[str(D/n) for n in ['REPORT.md','LAUNCH.md','grant.schema.json','grant.example.json','command.json','next-launch.json']]]
    r=subprocess.run(argv,cwd=R,env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=30)
    commands.append(dict(argv=argv,cwd=str(R),exitCode=r.returncode,stdout=r.stdout,stderr=r.stderr));assert r.returncode==0,r.stdout+r.stderr
save(D/'format-commands.json',commands)
syntax=[]
for p in [*A.glob('*.py'),*D.glob('*.py')]:ast.parse(p.read_text(),filename=str(p));syntax.append(str(p))
save(D/'syntax.json',dict(status='PASS',count=len(syntax),files=syntax,nativeProcesses=0,tsOrJsProductSourceChanges=False))
for record in ready['bindings']:
    p=Path(record['path']);assert p.stat().st_size==record['bytes'] and sha(p)==record['sha256'],p
for record in ready['softwareBindings']:assert sha(Path(record['path']))==record['sha256']
index=json.loads((A/'candidate-index.json').read_text())
for record in index['files']:
    p=A/record['path'];assert p.stat().st_size==record['bytes'] and sha(p)==record['sha256'],p
absent=json.loads((D/'prospective-paths.json').read_text())['paths'];assert len(absent)==11 and all(not os.path.lexists(p) for p in absent)
save(D/'binding-checks.json',dict(status='PASS',bindings=len(ready['bindings']),software=len(ready['softwareBindings']),indexRows=len(index['files']),absentPaths=absent,nativeFixtureAuthorization=ready['nativeFixtureAuthorization'],runtimeAuthorization=ready['runtimeAuthorization'],currentCapacityAdmission=False))
audit=dict(status='R12_BOUNDED_RSS_STARTUP_SOURCE_CPU_CORRECTED_AWAITING_REVIEW',revision='12',base=BASE,
    sourceAndDataBindings=len(ready['bindings']),softwareBindings=len(ready['softwareBindings']),originalRecoveryRows=21,additionalEarlierRecoveries=2,newRecoveryRows=0,
    totalCPUControls=142,newControls=54,retainedFocusedControls=66,admissionControls=22,actualCLIRefusals=3,priorSuppliedCPUControls=525,priorFullSuiteRerun=False,
    runtimeJobs=0,blenderProcesses=0,hydration=False,runtimeAuthorization=False,nativeFixtureAuthorization=True,nativeQualification=False,
    priorLibraryAcceptance=dict(head='c61699dcde61ff9dee699be7e0b7d42ae06ff326',tests=28,clipPeoplePairs=126,actions=42,rerunInThisUnit=False),
    fullSnapshotPreservation='FAILED_THREE_PNPM_TASK_STATE_DEVIATIONS_RETAINED',protectedPriorManifestRows=1368,retainedAttempt2Rows=50,harmlessChildPidsTerminalAbsent=29,
    shortSoftwareProbes=0,fullNative189RunsThisUnit=0,operationalGrantsCreatedThisUnit=0,originalNative189Attempts='R04_AND_R10_FAILED_SPENT_HOLD_PRESERVED',
    currentCapacityAdmission=False,requiredReserveBytes=22066626560,rssBytes=8589934592)
files=sorted(p for p in paths(A) if p.is_file() and p not in [A/'source-audit.json',D/'combined-hash-manifest.json'])
assert not any('__pycache__' in str(p) for p in files)
audit['files']=[row(p) for p in files];save(A/'source-audit.json',audit)
old=json.loads((A/'revision-11/combined-hash-manifest.json').read_text());all_paths={R/r['path'] for r in old['files']}|set(files)|{A/'source-audit.json'}
save(D/'combined-hash-manifest.json',dict(status=audit['status'],base=BASE,baseTree='48da9aed7d28ed5901676496d7cc2ee0db6d7809',runtimeAuthorization=False,nativeFixtureAuthorization=True,softwareBindings=ready['softwareBindings'],files=[row(p) for p in sorted(all_paths)]))
print(json.dumps(dict(astFiles=len(syntax),auditFiles=len(files),manifestFiles=len(all_paths),readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'),planSha256=sha(A/'native189-plan.json'),reportSha256=sha(D/'REPORT.md'),manifestSha256=sha(D/'combined-hash-manifest.json'),auditSha256=sha(A/'source-audit.json'))))
