"""Freeze a disabled CPU-only source candidate; never grants browser/capture execution."""
import hashlib,json,os,shutil,sys
from pathlib import Path
sys.dont_write_bytecode=True
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
    ready.update(purpose='CPU_LOSSLESS_PRIMARY_132_EXISTING_FRAMES',runtimeAuthorization=False,primaryArtifactSchema='t02-lossless-rgb-primary/v1',
        sourcePilot=str(PILOT),sourcePilotFinalIndexSha256=sha(PILOT/'final-index.json'),sourceFrames=sources,
        historicalBackend=json.loads((capture/'entry-result.json').read_text())['backend'],
        stages=[{'id':'cpu-existing-thalune-walk-132','kind':'motion','people':'thalune','lod':0,'work':[r['work'] for r in sources]}],
        captureOutput=str(HERE/'packet/capture'),cpuProofRoot='/private/tmp/t02-primary-integration-4cebc721',nativeRawDirectory='/private/tmp/t02-primary-integration-4cebc721/native-raw',
        rgbPrimary={'python':str(PYTHON),'worker':str(HERE/'rgb-primary.py'),'ffmpeg':'/opt/homebrew/Cellar/ffmpeg/9.0.2/bin/ffmpeg','ffprobe':'/opt/homebrew/Cellar/ffmpeg/9.0.2/bin/ffprobe','maxMetadataBytes':32*1024**2},
        helperDirectory=str(SUPPORT),limits={'maxImageBytes':12*1024**2,'maxObservationBytes':256*1024},captureSeconds=120,cleanupSeconds=20,
        fixtureDiskAdmission={'packetPerCopy':570425344,'retainedCopyCeiling':3,'copyNames':['task-worktree packet','shared Git/LFS object','reserved private/review copy allowance; not materialized'],'mainHydration':'Fourth-copy case excluded from fixture admission; future-unit/merge recheck required','archives':4294967296,'staging':1073741824,'git':16777216,'safety':4294967296,'totalRequiredBytes':11391729664},
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
    save(HERE/'disabled-grant.json',{'authorized':False,'browser':False,'rendering':False,'newCapture':False,'purpose':'Independent source review only; CPU fixture has separate parent authorization'})
    save(HERE/'candidate-index.json',{'phase':'FROZEN_CPU_SOURCE_REVIEW_CANDIDATE','runtimeAuthorization':False,'files':[{'path':p.name,'sha256':sha(p),'bytes':p.stat().st_size} for p in [*source_files(),HERE/'readiness.json',HERE/'disabled-grant.json',HERE/'baseline.json',HERE/'pure-node-controls.json',HERE/'pure-python-controls.json',HERE/'pure-control-history.json']]})
    print(json.dumps({'readySha256':sha(HERE/'readiness.json'),'indexSha256':sha(HERE/'candidate-index.json'),'browserGrant':False,'sourceFrames':len(sources)}))
if __name__=='__main__':main()
