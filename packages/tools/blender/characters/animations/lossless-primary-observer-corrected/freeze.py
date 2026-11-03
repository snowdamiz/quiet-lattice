"""Freeze a disabled CPU-only source candidate; never grants browser/capture execution."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import datetime,hashlib,json,os,shutil,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[6]
OLD=Path('/private/tmp/t02-pilot-import-corrected-26i4s64t')
PILOT=Path('/private/tmp/t02-pilot-run-2a7d0f8d9da8467bb108e3b3cd7e416f')
SUPPORT=Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/blend/stations/_authoring')
PYTHON=Path('/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3').resolve()
HELPERS={'round4_job_boundary.py':'3f5ca99841be6a2ab4218bd45c5e44c5bb368e331d4b323b906b25354baa444c','round4_capture_children.py':'e6bca98d53ce502a4115a6220a2aa78b27b3ab9ee1383c30165c274aaabb1f07','run_round4_browser_proof.py':'f550d2e70238c9ff5527a4316833b83a38cdcf519273ed4b366491a936961fab'}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def source_files():return sorted([p for p in HERE.iterdir() if p.is_file() and p.suffix in ['.py','.mjs','.cjs']])
def main():
    import PIL,importlib.util
    old=json.loads((OLD/'readiness.json').read_text());capture=PILOT/'stages/motion-thalune-lod0/capture'
    proof=json.loads(Path('/private/tmp/t02-lossless-rgb-sample-132-717fs7_b/pixel-proof.json').read_text())
    assert sha(PILOT/'final-index.json')=='e8862a34f35e36ce80f2eaafdecfece325bc810b156ef9442d1722020797096f'
    assert sha(OLD/'entry.mjs')=='889af0c563ae6476fe65357c0bad45158eea2f4356cd6b971471f457cec495ed'
    assert sha(OLD/'caller.py')=='fe16610264290341ac32460a5349c2c963c00e388e335db32e6c363fbf786653'
    sources=[]
    for row in proof['sourceFrames']:
        w={k:v for k,v in row['work'].items() if k not in ['image','observation']}
        obs=capture/'observations'/f"{w['ordinal']:04}.json";image=Path(row['path'])
        assert image.stat().st_size==row['pngBytes']
        sources.append({'work':w,'pngPath':str(image),'pngBytes':row['pngBytes'],'pngSha256':row['pngSha256'],'observationPath':str(obs),'observationSha256':sha(obs),'rgbSha256':row['rgbSha256'],'rgbaSha256':row['rgbaSha256']})
    assert len(sources)==132 and [x['work']['ordinal'] for x in sources]==list(range(15,147))
    ready={k:old[k] for k in ['root','node','pathEnvironment','viewport','manifest','binding','peopleHashes','clipDurations']}
    ready.update(purpose='CPU_LOSSLESS_PRIMARY_132_EXISTING_FRAMES',runtimeAuthorization=False,nativeFixtureAuthorization=False,prospectiveAttemptId='cpu-release-accounting-72a9b614',primaryArtifactSchema='t02-lossless-rgb-primary/v1',
        sourcePilot=str(PILOT),sourcePilotFinalIndexSha256=sha(PILOT/'final-index.json'),sourceFrames=sources,
        historicalBackend=json.loads((capture/'entry-result.json').read_text())['backend'],
        stages=[{'id':'cpu-existing-thalune-walk-132','kind':'motion','people':'thalune','lod':0,'work':[r['work'] for r in sources]}],
        packetBudget={'metadataBytes':33554432,'fileCount':256,'reservedFailureBytes':131072,'reservedTerminalBytes':131072,'packetByteOvershoot':0,'atomicTemporaryBytesCounted':True},packetRoot=str(HERE/'packet'),captureOutput=str(HERE/'packet/capture'),cpuProofRoot='/private/tmp/t02-primary-integration-release-accounting-72a9b614',nativeRawDirectory='/private/tmp/t02-primary-integration-release-accounting-72a9b614/native-raw',
        rgbPrimary={'python':str(PYTHON),'worker':str(HERE/'rgb-primary.py'),'ffmpeg':'/opt/homebrew/Cellar/ffmpeg/9.0.2/bin/ffmpeg','ffprobe':'/opt/homebrew/Cellar/ffmpeg/9.0.2/bin/ffprobe','maxMetadataBytes':32*1024**2},
        helperDirectory=str(SUPPORT),limits={'maxImageBytes':12*1024**2,'maxObservationBytes':256*1024},captureSeconds=120,cleanupSeconds=20,
        fixtureDiskAdmission={'packetPerCopy':570425344,'retainedCopyCeiling':3,'copyNames':['task-worktree packet','shared Git/LFS object','reserved private/review copy allowance; not materialized'],'mainHydration':'Fourth-copy case excluded from fixture admission; future-unit/merge recheck required','archives':3221225472,'newAttemptMaxNativeJobs':2,'remainingOriginalArchiveSlotReserve':1,'priorFailedOwnedJobs':1,'staging':1073741824,'git':16777216,'safety':4294967296,'totalRequiredBytes':10317987840},
        accounting={'path':str(HERE.parent/'lossless-feasibility/storage-accounting.json'),'sha256':'2c5665c31c3189d1822560534c0220f2ab7a33010854068ce08964ad5b85519b'})
    bindings=source_files()+[Path(ready['node']),PYTHON,Path(PIL.__file__),Path(ready['rgbPrimary']['ffmpeg']),Path(ready['rgbPrimary']['ffprobe']),Path(ready['accounting']['path'])]
    for name,digest in HELPERS.items():assert sha(SUPPORT/name)==digest;bindings.append(SUPPORT/name)
    # Native Pillow decode code and extension are also pinned, not only package version.
    import PIL.Image,PIL._imaging
    bindings.extend([Path(PIL.Image.__file__),Path(PIL._imaging.__file__)])
    ready['bindings']=[{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in bindings]
    for b in old['bindings']:
        if b['path'].startswith(ready['root']+'/assets/blend/characters/') or b['path'].startswith(ready['root']+'/packages/client/public/models/characters/'):
            assert sha(b['path'])==b['sha256'],'Historical authored asset drift'
            ready['bindings'].append(b)
    ready['pillowVersion']=PIL.__version__
    save(HERE/'readiness.json',ready)
    save(HERE/'disabled-grant.json',{'authorized':False,'browser':False,'rendering':False,'newCapture':False,'nativeCpuFixture':False,'purpose':'Independent source review only; a new native fixture is not authorized'})
    evidence=sorted(p for p in (HERE/'release-accounting-correction').iterdir() if p.is_file())
    files=[*source_files(),HERE/'readiness.json',HERE/'disabled-grant.json',HERE/'baseline.json',HERE/'pure-node-controls.json',HERE/'pure-python-controls.json',HERE/'pure-control-history.json',HERE/'observer-controls.json',HERE/'prospective-accounting.json',HERE/'README.md',HERE/'packet-budget-controls.json',HERE/'packet-budget-node-controls.json',HERE/'PACKET_STORAGE_CONTRACT.md',HERE/'optimization-controls.json',*evidence]
    entries=[{'path':str(p.relative_to(HERE)),'sha256':sha(p),'bytes':p.stat().st_size} for p in files]
    save(HERE/'candidate-index.json',{'phase':'FROZEN_CPU_SOURCE_REVIEW_CANDIDATE','runtimeAuthorization':False,'files':entries})
    prior=load_freeze_history()
    save(HERE/'REVIEW_FREEZE.json',{'schema':'t02-lossless-primary-corrected-source-review/v4','status':'SOURCE_REVIEW_ONLY_ALLOCATION_ATTEMPTS_AUDITED_RUNTIME_CLOSED',
        'recordedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'candidate':str(HERE),'sourceParentCommit':'e2df4ecfaaff6f5530f79273c5614f8955e4190a',
        'readinessSha256':sha(HERE/'readiness.json'),'candidateIndexSha256':sha(HERE/'candidate-index.json'),'disabledGrantSha256':sha(HERE/'disabled-grant.json'),
        'sourcePaths':[{'path':str(p),'sha256':sha(p)} for p in source_files()],
        'reviewScope':['Whole existing integration and packet/observer scope remains subject to fresh independent review','Caller-local accounting before allocation, partial constructor/start failure, positive audit per attempt and separate cleanup failures','Exact framehash timebase declaration; no newly demonstrated decoded-media timing failure','Assertion guard before task imports, including new pure controls; no native grant'],
        'preservedHistory':prior,'correctionEvidence':[entry for entry in entries if entry['path'].startswith('release-accounting-correction/')],
        'packetContract':{'path':str(HERE/'PACKET_STORAGE_CONTRACT.md'),'sha256':sha(HERE/'PACKET_STORAGE_CONTRACT.md')},
        'prospectiveAccounting':{'path':str(HERE/'prospective-accounting.json'),'sha256':sha(HERE/'prospective-accounting.json'),'admissionClaim':False},
        'resourceState':{'newNativeJobs':0,'newValidatorOrRetry':False,'bothFutureNamespacesAbsent':not Path(ready['packetRoot']).exists() and not Path(ready['cpuProofRoot']).exists(),'nativeAuthorization':False,'browserAuthorization':False},
        'currentFreeBytes':shutil.disk_usage(HERE).free,'files':entries})
    print(json.dumps({'readySha256':sha(HERE/'readiness.json'),'indexSha256':sha(HERE/'candidate-index.json'),'browserGrant':False,'sourceFrames':len(sources)}))
def load_freeze_history():
    return {'failedAttemptCommit':'f7d644dbb307f650d181faad629d6189f24029b7','observerCommit':'5eb06673a7345d1f88d65652e306b67b1229b1e1','aggregateCommit':'f6fbef82de592829da7d5b217e08caf9f8feb026','assertionGuardCommit':'e2df4ecfaaff6f5530f79273c5614f8955e4190a',
        'previousFreezeSha256':'2da63271b33c2ff03481a041acc0d3a0248ca22465ea7f0ef9ca1a501f52fbbf','failedManifestSha256':'98f3870e586a0770f228561a87f89fc851fd06f9a4fbc2b0f95d735671b0d7d6','separateRecoverySha256':'4dff39681a745392b1c25f70fd1c77873374f8cd81c01b77ba8f6ad2924b0089','meaning':'Prior failed runtime and prior frozen source/reports remain immutable in Git; this freeze grants no execution'}
if __name__=='__main__':main()
