import ast,datetime,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
ROOT=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=ROOT/'packages/tools/blender/characters/animations/thalune-run-candidate';D=A/'revision-04';BASE='c61699dcde61ff9dee699be7e0b7d42ae06ff326'
sys.path.insert(0,str(A));sys.dont_write_bytecode=True
import native189,contract,caller

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v):
 with Path(p).open('x') as f:json.dump(v,f,indent=2);f.write('\n')
V=Path('/private/tmp/t02-r04-bound-final-vcnh5p4b');F=Path('/private/tmp/t02-r04-final-6b5l2b_2');I=Path('/private/tmp/t02-r04-verification-s3eqc9xy')
(D/'final-controls').mkdir()
for name in ['control-commands.json','scratch-source-identities.json','pure-node-controls.json','pure-python-controls.json','evidence20.json','terminal30.json','publication3.json','timed12.json','driver.log','prior29.stdout','prior29.stderr','native-controls.log','run-controls.py','prior29.py']:
 shutil.copy2(V/name,D/'final-controls'/name)
for p in V.glob('*.stdout'):
 if not (D/'final-controls'/p.name).exists():shutil.copy2(p,D/'final-controls'/p.name)
for p in V.glob('*.stderr'):
 if not (D/'final-controls'/p.name).exists():shutil.copy2(p,D/'final-controls'/p.name)
for name in ['lint.log','format.log']:shutil.copy2(F/name,D/name)
shutil.copy2(I/'typecheck.log',D/'typecheck.log');shutil.copy2(I/'admission-redgreen.py',D/'admission-redgreen.py');shutil.copy2(I/'observe.py',D/'observe.py')
ready=json.loads((A/'readiness.json').read_text());plan=json.loads((A/'native189-plan.json').read_text())
assert not ready['runtimeAuthorization'] and not ready['nativeFixtureAuthorization']
changed=subprocess.check_output(['git','diff','--name-only',BASE],cwd=ROOT,text=True).splitlines()
assert all(p.startswith(str(A.relative_to(ROOT))+'/') for p in changed)
protected=[]
previous=json.loads((A/'revision-03/combined-hash-manifest.json').read_text())
for row in previous['files']:
 p=ROOT/row['path']
 if row['path'] not in changed:
  assert p.is_file() and sha(p)==row['sha256'],p
  protected.append(row)
original=json.loads((A/'recovery-provenance.json').read_text())
assert len(original['files'])==21
for row in original['files']:
 if row['mode'].startswith('exact'):assert sha(ROOT/row['destination']) in [row['sha256'],row.get('lfsOid')]
for name in ['entry.mjs','page-api.mjs','playback.mjs','contract.py']:
 p=A/name;assert p.read_bytes()==subprocess.check_output(['git','show',BASE+':'+str(p.relative_to(ROOT))],cwd=ROOT)
for p in (A/'retained-station').iterdir():
 if p.is_file():assert p.read_bytes()==subprocess.check_output(['git','show',BASE+':'+str(p.relative_to(ROOT))],cwd=ROOT)
retained=subprocess.check_output(['git','rev-parse','codex/task/P1-E05-T02'],cwd=ROOT,text=True).strip();assert retained=='49ae87cbdb8671f7988b1bed4358d49d4cdc6b58'
syntax=[]
for p in sorted(A.glob('*.py')):ast.parse(p.read_text(),str(p));syntax.append(str(p.relative_to(ROOT)))
result=caller.verify(ready)
source_rows=[dict(path=str(p.relative_to(ROOT)),bytes=p.stat().st_size,sha256=sha(p)) for p in sorted([*A.glob('*.py'),*A.glob('*.mjs'),*A.glob('*.cjs'),*(A/'retained-station').glob('*.py'),*(A/'retained-station').glob('*.mjs'),A/'native189-plan.json'])]
save(D/'unit-provenance.json',dict(base=BASE,baseTree='1b67a7289191a8dde2f28e68808e704dc51ee0b4',branch='codex/task/P1-E05-T02-thalune-reel-candidate',originalBase='e1ed4752805ee92be561db81910ee1bc1a87b1d9',combinedLibraryHead='afb3921ae59616ab5b555b771cd9dc1a914d78f2',combinedLibraryTree='ac859db599e124c7d91d462e329deae5b9d91e37',donors=['07768bf14fce30c1e78db6750f44d8fbd561f4b5','83b145e9d6dc845aa6c7706ada69019fc813b202'],recoveriesAdded=[],originalRecoveries=21,additionalEarlierRecoveries=2,retainedAnimationBranch=retained,changedExisting=changed,protectedUnchanged=protected,sourceFiles=source_rows,pythonSyntax=syntax,sourcePreflight=result,runtimeAuthorization=False,nativeFixtureAuthorization=False,prospective=[dict(path=plan[k],exists=Path(plan[k]).exists()) for k in ['runRoot','grantPath','consumedPath','cancelPath','cacheLeasePath']]))
commands=json.loads((V/'control-commands.json').read_text())
commands += [dict(name='native69',argv=[ready['rgbPrimary']['python'],'-B',str(A/'native189-controls.py'),'--report',str(D/'controls-final-bound.json')],exitCode=0,count=69),dict(name='metadata7',argv=[ready['rgbPrimary']['python'],'-B',str(A/'metadata-controls.py'),'--report',str(D/'metadata-final.json')],exitCode=0,count=7),dict(name='actual-admission-redgreen2',argv=[ready['rgbPrimary']['python'],'-B',str(I/'admission-redgreen.py')],exitCode=0,count=2),dict(name='typecheck',argv=['pnpm','typecheck'],exitCode=0),dict(name='lint',argv=['pnpm','exec','eslint','--no-ignore',str(A/'resolve-bindings.mjs'),str(A/'revision-03/publication-controls.mjs'),'packages/client/src/characters/animationLibrary.test.js','packages/tools/blender/characters/animations/capture_bind.mjs'],exitCode=0),dict(name='format',argv=['pnpm','exec','prettier','--check','--ignore-path','/dev/null',str(A/'native189-plan.json'),str(A/'resolve-bindings.mjs'),'packages/tools/blender/characters/animations/CURRENT_USAGE.md','packages/client/src/characters/animationLibrary.test.js','packages/client/src/characters/fixtures/animation-clips.json','packages/tools/blender/characters/animations/capture_bind.mjs'],exitCode=0)]
save(D/'commands.json',dict(cwd=str(ROOT),commands=commands,counts=dict(existing=180,timedPublication=15,priorIndependent=29,new=69,metadata=7,legacyAdmissionRedGreen=2,total=302),realNativeJobs=0))
packet=Path(plan['runRoot'])/'packet';proof=Path(plan['runRoot'])/'proof'
proposal=dict(status='SOURCE_IMPLEMENTED_DISABLED_PENDING_REVIEW_AND_PARENT_GO',runtimeAuthorization=False,nativeFixtureAuthorization=False,planPath=str(A/'native189-plan.json'),planSha256=sha(A/'native189-plan.json'),readinessSha256=sha(A/'readiness.json'),indexSha256=sha(A/'candidate-index.json'),launchArgv=[ready['rgbPrimary']['python'],'-B',str(A/'native189.py'),'--execute','--grant',plan['grantPath']],root=str(ROOT),environmentPATH=ready['pathEnvironment'],nativeExecutables=json.loads((A/'runtime-bindings.json').read_text())['executables'],softwareBindings=ready['softwareBindings'],processBinarySha256=ready['process_binary_sha256'],packetFiles=[str(packet/p) for p in [*plan['packetFilesBeforeTerminal'],'integration-result.json']],proofJobs=[dict(id=n,paths=native189.paths(plan,n),config=str(proof/'jobs'/n/'worker-config.json'),entryClaim=str(proof/'jobs'/n/'worker-entry.json'),profileAndTmpRelease=str(proof/'jobs'/n/'owned-job'),workerFailure=str(proof/'jobs'/n/'native/producer-failure.json')) for n in native189.JOBS],surplusLogs=[str(proof/'jobs/native-189-validate/native'/s) for s in ['surplus-command.json','surplus.stdout','surplus.stderr']],limits=dict(captureSeconds=600,cleanupSeconds=60,probeSeconds=30,eachDecodeSeconds=120,surplusDecodeSeconds=120,maxCohortRSS=8589934592,rssSampleIntervalSeconds=.2,rssReadDeadlineSeconds=3,mediaBytes=39354368,fixtureMetadataBytes=67108864,admissionJSONBytes=2097152,archivePerJobBytes=1073741824,cacheSnapshotBytes=402653184,cacheSnapshotEntries=4096,encoderThreads=1,decoderThreads=1,sourceFrames=189,surplusDecodedFrames=190,inFlight=1,retainedPNGFiles=0,RGBSpoolBytes=0),storage={**plan['storage'],'actualRetainedInventory':native189.retained_inventory(plan),'newNativeArchiveJobs':2,'historicalArchiveAllowanceSlots':4,'futureCaptureArchiveSlots':5,'copiesActuallyCreatedByRunner':1,'otherCopySlotsReservedNotAllocated':3},captureUnchanged=dict(jobs=ready['jobs'],motionFrames=378,stills=8,perReelBytes=39354368,oldFullInventory='revision-03/next-native-proposal.json'),pending=['fresh independent source review','parent one-unit native grant and reviewed activation of nativeFixtureAuthorization only','fresh source/resource/clean-HEAD admission at execution','real native inheritance, encode/decode/RSS/release qualification','parent-observed runner OS exit and authenticated result/consumption before future capture acceptance','later capture/cache observations and whole-animation visual grading; E05.T04 remains separate'])
save(D/'next-launch.json',proposal)
print(json.dumps(dict(protected=len(protected),sources=len(source_rows),syntax=len(syntax),packetFiles=len(proposal['packetFiles']),commands=len(commands))))
