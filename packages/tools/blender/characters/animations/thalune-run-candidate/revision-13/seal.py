"""Seal the bounded source correction without operational admission or capacity reads."""
import ast,hashlib,json,os,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
D=Path(__file__).resolve().parent;A=D.parent;ready=json.loads((A/'readiness.json').read_text());R=Path(ready['root']);sys.path.insert(0,str(A))
from inventory_boundary import paths
BASE='ff497e5525f8e93c71df67827446d7e426bbc20d'
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def row(p):return dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
commands=[]
for mode in ['--write','--check']:
    argv=[ready['node'],str(R/'node_modules/prettier/bin/prettier.cjs'),mode,'--ignore-path','/dev/null',*[str(D/n) for n in ['REPORT.md','LAUNCH.md','grant.schema.json','grant.example.json','command.json','next-launch.json']]]
    result=subprocess.run(argv,cwd=R,env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=30)
    commands.append(dict(argv=argv,cwd=str(R),exitCode=result.returncode,stdout=result.stdout,stderr=result.stderr));assert result.returncode==0,result.stdout+result.stderr
save(D/'format-commands.json',commands)
syntax=[]
for p in [*A.glob('*.py'),*D.glob('*.py')]:ast.parse(p.read_text(),filename=str(p));syntax.append(str(p))
save(D/'syntax.json',dict(status='PASS',count=len(syntax),files=syntax,productTsJsChanges=False))
for record in ready['bindings']:
    p=Path(record['path']);assert p.stat().st_size==record['bytes'] and sha(p)==record['sha256'],p
for record in ready['softwareBindings']:assert sha(Path(record['path']))==record['sha256']
index=json.loads((A/'candidate-index.json').read_text())
for record in index['files']:
    p=A/record['path'];assert p.stat().st_size==record['bytes'] and sha(p)==record['sha256'],p
absent=json.loads((D/'prospective-paths.json').read_text())['paths'];assert len(absent)==11 and all(not os.path.lexists(p) for p in absent)
save(D/'binding-checks.json',dict(status='PASS',bindings=len(ready['bindings']),software=len(ready['softwareBindings']),indexRows=len(index['files']),absentPaths=absent,nativeFixtureAuthorization=True,runtimeAuthorization=False,currentCapacityAdmission=False))
all_commands=[]
for name in ['red-commands.json','green-review-commands.json','focused-commands.json','retained-commands.json']:
    all_commands.extend(json.loads((D/name).read_text()))
all_commands.extend(json.loads((D/'cli-verified.json').read_text())['commands'])
save(D/'commands.json',dict(commands=all_commands,suppliedControls=142,sinkMatrix=41,exactReviewerGreen=3,currentSourcePassingExecutions=186,oldBaseMilestoneAssertions=5,actualCLIRefusals=3,oldFailedHarnessRecordsRetained=True,nativeJobs=0,liveCapacityObservations=0))
audit=dict(status='R13_SOURCE_CPU_CORRECTED_AWAITING_FRESH_INDEPENDENT_REVIEW',revision='13',base=BASE,
    sourceAndDataBindings=len(ready['bindings']),softwareBindings=len(ready['softwareBindings']),originalRecoveryRows=21,additionalEarlierRecoveries=2,newRecoveryRows=0,
    suppliedCPUControls=142,sinkMatrixControls=41,exactReviewerGreen=3,currentSourcePassingExecutions=186,oldBaseMilestoneAssertions=5,actualCLIRefusals=3,
    priorSuppliedCPUControls=525,priorBroadSuiteRerun=False,runtimeJobs=0,blenderProcesses=0,hydration=False,runtimeAuthorization=False,nativeFixtureAuthorization=True,nativeQualification=False,
    fullSnapshotPreservation='FAILED_MISMATCH_THREE_PNPM_TASK_STATE_DEVIATIONS_RETAINED',priorManifestRowsUnchangedOutsideFourMutableFiles=1429,priorProtectedSetRows=1368,priorProtectedRowsUnchanged=1367,authorizedSourceException='release_accounting.py',retainedAttempt2Rows=50,immutableReviewSealRows=579,harmlessChildPidsTerminalAbsent=9,
    originalNative189Attempts='R04_AND_R10_FAILED_SPENT_HOLD_PRESERVED',currentCapacityAdmission=False,liveCapacityObservations=0,requiredReserveBytes=22066626560,rssBytes=8589934592)
files=sorted(p for p in paths(A) if p.is_file() and p not in [A/'source-audit.json',D/'combined-hash-manifest.json']);assert not any('__pycache__' in str(p) for p in files)
audit['files']=[row(p) for p in files];save(A/'source-audit.json',audit)
old=json.loads((A/'revision-12/combined-hash-manifest.json').read_text());all_paths={R/r['path'] for r in old['files']}|set(files)|{A/'source-audit.json'}
save(D/'combined-hash-manifest.json',dict(status=audit['status'],base=BASE,baseTree='5eccd017f148fbedc6b1fc751fb16ea7fcc1c660',runtimeAuthorization=False,nativeFixtureAuthorization=True,softwareBindings=ready['softwareBindings'],files=[row(p) for p in sorted(all_paths)]))
S=Path(json.loads((D/'baseline.json').read_text())['scratch']);total=sum(p.stat().st_size for root in [D,S] for p in paths(root) if p.is_file());assert total<=256*1024**2
print(json.dumps(dict(astFiles=len(syntax),auditFiles=len(files),manifestFiles=len(all_paths),scratchAndProofBytes=total,limitBytes=256*1024**2,readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'),planSha256=sha(A/'native189-plan.json'),reportSha256=sha(D/'REPORT.md'),manifestSha256=sha(D/'combined-hash-manifest.json'),auditSha256=sha(A/'source-audit.json'))))
