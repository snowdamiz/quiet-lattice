from pathlib import Path
import sys,json,hashlib,subprocess,os
sys.dont_write_bytecode=True
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';D=Path(__file__).parent;sys.path.insert(0,str(A))
from inventory_boundary import paths as inventory_paths
B='b6ad8528c7fe504817078fcfe0f253caac45020d'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def row(p):return dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
ready=json.loads((A/'readiness.json').read_text());commands=[]
for mode in ['--write','--check']:
 argv=[ready['node'],str(R/'node_modules/prettier/bin/prettier.cjs'),mode,'--ignore-path','/dev/null',*[str(D/n) for n in ['REPORT.md','LAUNCH.md','grant.schema.json','grant.example.json','command.json','next-launch.json']]]
 p=subprocess.run(argv,cwd=R,env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=30);commands.append(dict(argv=argv,cwd=str(R),exitCode=p.returncode,stdout=p.stdout,stderr=p.stderr));assert p.returncode==0,p.stdout+p.stderr
save(D/'format-commands.json',commands)
unit=json.loads((D/'unit-provenance.json').read_text());unit['admissionControlSha256']=sha(D/'admission-controls.py');save(D/'unit-provenance.json',unit)
audit=json.loads((A/'source-audit.json').read_text());audit.update(status='NATIVE189_ONLY_CONFIGURED_NO_GRANT_NO_EXECUTION',revision='09',base=B,nativeFixtureAuthorization=True,runtimeAuthorization=False,totalCPUControls=22,activationCLIGates=5,priorSuppliedCPUControls=525,priorSuiteRerun=False,nativeQualification=False,activationSnapshotPreservation='PASS_CURRENT_R5_SNAPSHOT_OUTSIDE_THREE_AUTHORIZED_METADATA_FILES',activationProtectedSnapshotEntries=29651,protectedPriorManifestRows=1151)
files=sorted(p for p in inventory_paths(A) if p.is_file() and p not in [A/'source-audit.json',D/'combined-hash-manifest.json']);assert not any('__pycache__' in str(p) for p in files)
audit['files']=list(map(row,files));save(A/'source-audit.json',audit)
previous=json.loads((A/'revision-08/combined-hash-manifest.json').read_text());all_paths={R/r['path'] for r in previous['files']}|set(files)|{A/'source-audit.json'}
save(D/'combined-hash-manifest.json',dict(status='NATIVE189_ONLY_CONFIGURED_NO_GRANT_NO_EXECUTION',base=B,baseTree='3a8f15923b5314dd894012f98d5728bb99a9a69d',runtimeAuthorization=False,nativeFixtureAuthorization=True,softwareBindings=ready['softwareBindings'],files=list(map(row,sorted(all_paths)))))
print(json.dumps(dict(auditFiles=len(files),manifestFiles=len(all_paths),reportSha256=sha(D/'REPORT.md'),manifestSha256=sha(D/'combined-hash-manifest.json'),auditSha256=sha(A/'source-audit.json'),readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'))))
