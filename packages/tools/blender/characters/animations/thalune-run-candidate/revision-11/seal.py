"""Seal this bounded correction; never alter prior report packets or toolchain pins."""
from pathlib import Path
import ast,hashlib,json,os,subprocess,sys
sys.dont_write_bytecode=True
D=Path(__file__).parent;A=D.parent;ready=json.loads((A/'readiness.json').read_text());R=Path(ready['root']);sys.path.insert(0,str(A))
from inventory_boundary import paths
BASE='3503cd7d5187b78140bc22fbb5e418ee9f2c6798'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def row(p):return dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
commands=[]
for mode in ['--write','--check']:
 argv=[ready['node'],str(R/'node_modules/prettier/bin/prettier.cjs'),mode,'--ignore-path','/dev/null',*[str(D/n) for n in ['REPORT.md','LAUNCH.md','grant.schema.json','grant.example.json','command.json','next-launch.json']]]
 r=subprocess.run(argv,cwd=R,env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=30);commands.append(dict(argv=argv,cwd=str(R),exitCode=r.returncode,stdout=r.stdout,stderr=r.stderr));assert r.returncode==0,r.stdout+r.stderr
save(D/'format-commands.json',commands)
syntax=[]
for p in [*A.glob('*.py'),*D.glob('*.py')]:ast.parse(p.read_text(),filename=str(p));syntax.append(str(p))
save(D/'syntax.json',dict(status='PASS',count=len(syntax),files=syntax,nativeProcesses=0))
audit=json.loads((A/'source-audit.json').read_text());audit.update(status='R11_ACK_ACCOUNTING_SOURCE_CPU_CORRECTED_REVIEW_AND_CAPACITY_HOLD',revision='11',base=BASE,nativeFixtureAuthorization=True,runtimeAuthorization=False,totalCPUControls=94,activationCLIGates=3,priorSuppliedCPUControls=525,priorSuiteRerun=False,nativeQualification=False,shortSoftwareProbes=0,fullNative189RunsThisUnit=0,operationalGrantsCreatedThisUnit=0,originalNative189='FAILED_SPENT_HOLD_PRESERVED',probePhase='NO_PROBES_THIS_UNIT_PRIOR_PROBES_UNCHANGED',activationSnapshotPreservation='PASS_C2_SNAPSHOT_OUTSIDE_FOUR_AUTHORIZED_FILES',activationProtectedSnapshotEntries=31264,protectedPriorManifestRows=1256,currentCapacityAdmission=False,reportedFreeBytes=19745017856,requiredReserveBytes=22066626560)
files=sorted(p for p in paths(A) if p.is_file() and p not in [A/'source-audit.json',D/'combined-hash-manifest.json']);assert not any('__pycache__' in str(p) for p in files)
audit['files']=[row(p) for p in files];save(A/'source-audit.json',audit)
old=json.loads((A/'revision-10/combined-hash-manifest.json').read_text());all_paths={R/r['path'] for r in old['files']}|set(files)|{A/'source-audit.json'}
save(D/'combined-hash-manifest.json',dict(status='R11_ACK_ACCOUNTING_SOURCE_CPU_CORRECTED_REVIEW_AND_CAPACITY_HOLD',base=BASE,baseTree='be67aeb7817b1af3b89a7a2a2c2093e6244c8b73',runtimeAuthorization=False,nativeFixtureAuthorization=True,softwareBindings=ready['softwareBindings'],files=[row(p) for p in sorted(all_paths)]))
print(json.dumps(dict(astFiles=len(syntax),auditFiles=len(files),manifestFiles=len(all_paths),readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'),planSha256=sha(A/'native189-plan.json'),reportSha256=sha(D/'REPORT.md'),manifestSha256=sha(D/'combined-hash-manifest.json'),auditSha256=sha(A/'source-audit.json'))))
