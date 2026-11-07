from pathlib import Path
import hashlib,json,subprocess,os,time,datetime
O=Path(__file__).parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';B='c44d7a8597644e942b38345f37e269c13af063e6'
def sha(p):return hashlib.file_digest(Path(p).open('rb'),'sha256').hexdigest()
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
def git(*args):return subprocess.check_output(['git',*args],cwd=R,text=True).strip()
ready=json.loads((A/'readiness.json').read_text());old=json.loads(git('show',B+':'+str((A/'readiness.json').relative_to(R))));changed=set(ready)^set(old)
for k in ready:
 if ready[k]!=old.get(k):changed.add(k)
assert changed=={'bindings'},changed
mutable={str((A/n).relative_to(R)) for n in ['caller.py','native189.py','resource_admission.py','readiness.json','candidate-index.json','source-audit.json']}
prior=json.loads((A/'revision-04/combined-hash-manifest.json').read_text());protected=[]
for row in prior['files']:
 if row['path'] in mutable:continue
 p=R/row['path'];assert sha(p)==row['sha256'],str(p);assert p.stat().st_size==row['bytes'];protected.append(row)
for row in ready['bindings']+ready['softwareBindings']:assert sha(row['path'])==row['sha256'] and Path(row['path']).stat().st_size==row['bytes'],row['path']
index=json.loads((A/'candidate-index.json').read_text())
for row in index['files']:assert sha(A/row['path'])==row['sha256'] and (A/row['path']).stat().st_size==row['bytes']
prospective=[]
for row in json.loads((A/'revision-04/current-resources.json').read_text())['prospective']:
 p=Path(row['path']);assert not p.exists() and not p.is_symlink(),str(p);prospective.append(dict(path=str(p),exists=False,symlink=False))
assert not ready['runtimeAuthorization'] and not ready['nativeFixtureAuthorization']
assert git('rev-parse','codex/task/P1-E05-T02')=='49ae87cbdb8671f7988b1bed4358d49d4cdc6b58'
plan=json.loads((A/'native189-plan.json').read_text());assert plan['storage']['combinedReserveBytes']==22066626560 and plan['rssBytes']==8589934592 and plan['perReelBytes']==39354368
proof=dict(observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),base=B,baseTree=git('rev-parse',B+'^{tree}'),branch=git('branch','--show-current'),readinessKeysChanged=sorted(changed),protectedUnchanged=protected,bindings=len(ready['bindings']),softwareBindings=ready['softwareBindings'],indexFiles=len(index['files']),prospective=prospective,runtimeAuthorization=False,nativeFixtureAuthorization=False,softwareRetargeted=False,planSha256=sha(A/'native189-plan.json'),readinessSha256=sha(A/'readiness.json'),candidateSha256=sha(A/'candidate-index.json'),runtimeBindingSha256=sha(A/'runtime-bindings.json'),sourceHashes={n:sha(A/n) for n in ['caller.py','native189.py','resource_admission.py','revision05-controls.py']},retainedBranch=git('rev-parse','codex/task/P1-E05-T02'),currentFreeSpaceAdmission=False)
save(O/'preservation.json',proof)
env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'};cmds=[]
for name,args,expected,needle in [('native-preflight',[],0,'SOURCE_ONLY_NATIVE189_DISABLED'),('native-disabled',['--execute'],1,'NATIVE189_DISABLED')]:
 argv=[ready['rgbPrimary']['python'],'-B',str(A/'native189.py'),*args];p=subprocess.run(argv,cwd=R,env=env,capture_output=True,text=True,timeout=30)
 (O/(name+'.stdout')).write_text(p.stdout);(O/(name+'.stderr')).write_text(p.stderr);assert p.returncode==expected and needle in p.stdout+p.stderr
 cmds.append(dict(name=name,argv=argv,cwd=str(R),exitCode=p.returncode,expectedExit=expected))
save(O/'additional-commands.json',cmds)
assert all(not Path(row['path']).exists() and not Path(row['path']).is_symlink() for row in prospective)
print(json.dumps(dict(status='PASS',protected=len(protected),bindings=len(ready['bindings']),software=len(ready['softwareBindings']),indexFiles=len(index['files']),absentProspective=len(prospective),runtimeJobs=0)))
