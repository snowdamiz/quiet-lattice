from pathlib import Path
import json,hashlib,subprocess,os
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';D=A/'revision-05';O=Path(__file__).parent
B='c44d7a8597644e942b38345f37e269c13af063e6'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def row(p):return dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
ready=json.loads((A/'readiness.json').read_text());env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'}
argv=['pnpm','exec','prettier','--check','--ignore-path','/dev/null',str(D/'REPORT.md')];r=subprocess.run(argv,cwd=R,env=env,capture_output=True,text=True,timeout=60)
save(D/'report-format.json',dict(argv=argv,cwd=str(R),exitCode=r.returncode,stdout=r.stdout,stderr=r.stderr));assert r.returncode==0,r.stdout+r.stderr
prior=json.loads((A/'source-audit.json').read_text());prior.update(revision='05',base=B,sourceFiles=34,sourceAndDataBindings=2350,revisionBoundaryControls=74,adaptedCurrentAdverseControls=17,totalCPUControls=393,priorSuppliedCPUControls=302)
paths=sorted(p for p in A.rglob('*') if p.is_file() and p not in [A/'source-audit.json',D/'combined-hash-manifest.json'])
assert not any('__pycache__' in str(p) for p in paths)
prior['files']=list(map(row,paths));save(A/'source-audit.json',prior)
prior_manifest=json.loads((A/'revision-04/combined-hash-manifest.json').read_text());all_paths={R/x['path'] for x in prior_manifest['files']}|set(paths)|{A/'source-audit.json'}
manifest=dict(status='PASS_SOURCE_CPU_NATIVE_DISABLED',base=B,baseTree='f8d102c85e00e3f2b00ae33bdf4dc2b927aad00a',runtimeAuthorization=False,nativeFixtureAuthorization=False,softwareBindings=ready['softwareBindings'],files=list(map(row,sorted(all_paths))))
save(D/'combined-hash-manifest.json',manifest)
print(json.dumps(dict(auditFiles=len(paths),manifestFiles=len(all_paths),manifestSha256=sha(D/'combined-hash-manifest.json'),reportSha256=sha(D/'REPORT.md'),auditSha256=sha(A/'source-audit.json'),indexSha256=sha(A/'candidate-index.json'),readinessSha256=sha(A/'readiness.json'))))
