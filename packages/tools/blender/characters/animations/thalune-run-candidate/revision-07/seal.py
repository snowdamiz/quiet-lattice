from pathlib import Path
import json,hashlib,subprocess,os,sys
sys.dont_write_bytecode=True
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';D=Path(__file__).parent
sys.path.insert(0,str(A))
from inventory_boundary import paths as inventory_paths
B='609f454dfe65c8e3a7fbc7e69b4c36a584f6af98'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def row(p):return dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
ready=json.loads((A/'readiness.json').read_text());env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'}
commands=[]
for mode in ['--write','--check']:
 argv=['pnpm','exec','prettier',mode,'--ignore-path','/dev/null',str(D/'REPORT.md')];r=subprocess.run(argv,cwd=R,env=env,capture_output=True,text=True,timeout=60)
 commands.append(dict(argv=argv,cwd=str(R),exitCode=r.returncode,stdout=r.stdout,stderr=r.stderr));assert r.returncode==0,r.stdout+r.stderr
save(D/'report-format.json',commands)
prior=json.loads((A/'source-audit.json').read_text());prior.update(revision='07',base=B,sourceFiles=37,sourceAndDataBindings=2353,totalCPUControls=490,nativeR3BoundaryControls=39,nativeR3IndependentControls=11,priorSuppliedCPUControls=440)
paths=sorted(p for p in inventory_paths(A) if p.is_file() and p not in [A/'source-audit.json',D/'combined-hash-manifest.json'])
assert not any('__pycache__' in str(p) for p in paths)
prior['files']=list(map(row,paths));save(A/'source-audit.json',prior)
previous=json.loads((A/'revision-06/combined-hash-manifest.json').read_text());all_paths={R/x['path'] for x in previous['files']}|set(paths)|{A/'source-audit.json'}
manifest=dict(status='PASS_SOURCE_CPU_NATIVE_DISABLED',base=B,baseTree='127f83f32453c32f67bf1c2ada1cdd69e86484d4',runtimeAuthorization=False,nativeFixtureAuthorization=False,softwareBindings=ready['softwareBindings'],files=list(map(row,sorted(all_paths))))
save(D/'combined-hash-manifest.json',manifest)
print(json.dumps(dict(auditFiles=len(paths),manifestFiles=len(all_paths),manifestSha256=sha(D/'combined-hash-manifest.json'),reportSha256=sha(D/'REPORT.md'),auditSha256=sha(A/'source-audit.json'),indexSha256=sha(A/'candidate-index.json'),readinessSha256=sha(A/'readiness.json'))))
