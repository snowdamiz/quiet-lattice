from pathlib import Path
import json,hashlib,subprocess,os
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';D=A/'revision-06';O=Path(__file__).parent
B='258926df00eaf6a306920b9905ff925358a73c1d'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def row(p):return dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
ready=json.loads((A/'readiness.json').read_text());env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'}
argv=['pnpm','exec','prettier','--check','--ignore-path','/dev/null',str(D/'REPORT.md')];r=subprocess.run(argv,cwd=R,env=env,capture_output=True,text=True,timeout=60)
save(D/'report-format.json',dict(argv=argv,cwd=str(R),exitCode=r.returncode,stdout=r.stdout,stderr=r.stderr));assert r.returncode==0,r.stdout+r.stderr
prior=json.loads((A/'source-audit.json').read_text());prior.update(revision='06',base=B,sourceFiles=35,sourceAndDataBindings=2351,revisionBoundaryControls=74,adaptedCurrentAdverseControls=17,totalCPUControls=440,nativeR2BoundaryControls=47,priorSuppliedCPUControls=393)
paths=sorted(p for p in A.rglob('*') if p.is_file() and p not in [A/'source-audit.json',D/'combined-hash-manifest.json'])
assert not any('__pycache__' in str(p) for p in paths)
prior['files']=list(map(row,paths));save(A/'source-audit.json',prior)
prior_manifest=json.loads((A/'revision-05/combined-hash-manifest.json').read_text());all_paths={R/x['path'] for x in prior_manifest['files']}|set(paths)|{A/'source-audit.json'}
manifest=dict(status='PASS_SOURCE_CPU_NATIVE_DISABLED',base=B,baseTree='2c18fbb1a1de1697aeede0675a65ce5ddbd0263e',runtimeAuthorization=False,nativeFixtureAuthorization=False,softwareBindings=ready['softwareBindings'],files=list(map(row,sorted(all_paths))))
save(D/'combined-hash-manifest.json',manifest)
print(json.dumps(dict(auditFiles=len(paths),manifestFiles=len(all_paths),manifestSha256=sha(D/'combined-hash-manifest.json'),reportSha256=sha(D/'REPORT.md'),auditSha256=sha(A/'source-audit.json'),indexSha256=sha(A/'candidate-index.json'),readinessSha256=sha(A/'readiness.json'))))
