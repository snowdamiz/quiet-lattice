"""Freeze current source paths and content identities without importing native helpers."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import hashlib,json,os,shutil
from pathlib import Path
import contract as c

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,value):Path(path).write_text(json.dumps(value,indent=2)+'\n')
def main():
    here,root=c.HERE,c.ROOT
    assets=root/'packages/client/public/models/characters/animations'
    manifest=json.loads((assets/'manifest.json').read_text())
    binding=json.loads((assets/'source-bind.json').read_text())
    assert len(manifest['clips'])==42 and next(x for x in manifest['clips'] if x['name']=='run_forward')['duration']==.8
    assert sha(assets/'source-bind.json')==manifest['sourceBindManifestSha256']
    provenance=json.loads((here/'recovery-provenance.json').read_text())
    for row in provenance['files']:
        if row['mode'].startswith('exact'):assert sha(root/row['destination']) in [row['sha256'],row.get('lfsOid')]
    source_paths=sorted([*here.glob('*.py'),*here.glob('*.mjs'),*here.glob('*.cjs'),
                         *(here/'retained-station').glob('*.py'),*(here/'retained-station').glob('*.mjs'),here/'native189-plan.json'])
    asset_paths=[root/'assets/blend/characters/animations/shared_motion.blend',*sorted(assets.iterdir())]
    for species in ['thalune','ixari','ulgani']:
        asset_paths.append(root/f'packages/client/public/models/characters/{species}.glb')
    def payload_identity(path):
        data=path.read_bytes()
        if data.startswith(b'version https://git-lfs.github.com/spec/v1\n'):
            fields=dict(line.split(' ',1) for line in data.decode().splitlines())
            return dict(kind='lfs-pointer-not-hydrated',sha256=fields['oid'].split(':')[1],bytes=int(fields['size']))
        return dict(kind='file',sha256=sha(path),bytes=path.stat().st_size)
    identities={str(p.relative_to(root)):payload_identity(p) for p in asset_paths}
    assert identities[str((assets/'shared_motion.glb').relative_to(root))]['sha256']==manifest['librarySha256']
    assert identities['assets/blend/characters/animations/shared_motion.blend']['sha256']==manifest['authoredSourceSha256']
    people={p:identities[f'packages/client/public/models/characters/{p}.glb']['sha256'] for p in ['thalune','ixari','ulgani']}
    assert people['thalune']==binding['exportSha256']
    ready=dict(purpose='THALUNE_RUN_2X189_8_STILLS_SOURCE_CANDIDATE',runtimeAuthorization=False,nativeFixtureAuthorization=False,
        attemptId='thalune-run-source-01',baseHead=provenance['base'],root=str(root),preparationRoot=str(here),
        packetRoot=str(here/'future-attempt/packet'),proofRoot=str(here/'future-attempt/proof'),
        helperDirectory=str(here/'retained-station'),stages=c.stages(),jobs=c.jobs(),primaryArtifactSchema=c.SCHEMA,
        viewport=[1920,1080],captureSeconds=600,cleanupSeconds=60,manifest=manifest,binding=binding,peopleHashes=people,
        clipDurations={'run_forward':.8},limits=dict(maxImageBytes=c.IMAGE_BYTES,maxObservationBytes=c.OBSERVATION_BYTES,
            maxAncillaryStageBytes=64*1024**2,maxArchiveStageBytes=1024**3),
        rgbPrimary=dict(python=str(Path(sys.executable).resolve()),worker=str(here/'rgb-primary.py'),
            ffmpeg=str(Path(shutil.which('ffmpeg')).resolve()),ffprobe=str(Path(shutil.which('ffprobe')).resolve()),
            maxFrames=c.FRAMES,maxVideoBytes=c.VIDEO_BYTES,maxMetadataBytes=189*c.OBSERVATION_BYTES+64*1024**2),
        node=str(Path(shutil.which('node')).resolve()),pathEnvironment=os.environ['PATH'],
        packetBudget=dict(metadataBytes=c.METADATA_BYTES,fileCount=c.FILE_COUNT,perReelBytes=c.VIDEO_BYTES,
            stillBytes=c.IMAGE_BYTES,reservedFailureBytes=c.RECORD_BYTES,reservedTerminalBytes=c.RECORD_BYTES,atomicTemporaryBytesCounted=True),
        storage=dict(unitPacketBytes=540606464,retainedUpfrontFixtureBytes=570425344,packetBytesPerCopy=1111031808,
            retainedCopies=4,archiveJobsIncludingPriorFixture=9,newJobs=5,archiveBytes=9663676416,
            gitReserveBytes=16777216,stagingBytes=1073741824,safetyBytes=4294967296,totalIncrementalCeiling=19493289984,
            historicalAccountingSha256='2c5665c31c3189d1822560534c0220f2ab7a33010854068ce08964ad5b85519b',
            currentFreeSpaceAdmission=False,archiveCapIsAcceptanceOnly=True),
        assetIdentities=identities,
        runtimeRoutes='Not admitted: parent must freeze current browser/tsx/executable routes and resource facts before scheduling',
        bindings=[dict(path=str(p),bytes=p.stat().st_size,sha256=sha(p)) for p in [*source_paths,*asset_paths]])
    binary_paths=[Path(ready['node']),Path(ready['rgbPrimary']['python']),Path(ready['rgbPrimary']['ffmpeg']),Path(ready['rgbPrimary']['ffprobe'])]
    ready['softwareBindings']=[dict(path=str(p),bytes=p.stat().st_size,sha256=sha(p)) for p in binary_paths]
    installed_path=here/'runtime-bindings.json'
    if installed_path.exists():
        installed=json.loads(installed_path.read_text())
        assert installed['runtimeAuthorization'] is False and installed['nativeFixtureAuthorization'] is False
        assert installed['root']==str(root) and installed['pathEnvironment']==os.environ['PATH']
        assert installed['executables']['node']==ready['node'] and installed['executables']['pythonLauncher']==ready['rgbPrimary']['python']
        assert installed['executables']['ffmpeg']==ready['rgbPrimary']['ffmpeg'] and installed['executables']['ffprobe']==ready['rgbPrimary']['ffprobe']
        assert installed['browser']==installed['resolver'] and installed['browser']['spawnCalls']==[] and installed['routes']['forbiddenCalls']==[]
        for name in ['tsxImport','browser','resolver','process_binary_sha256']:ready[name]=installed[name]
        for name in ['bindings','softwareBindings']:
            combined={row['path']:row for row in [*ready[name],*installed[name]]}
            ready[name]=list(combined.values())
            for row in ready[name]:assert Path(row['path']).stat().st_size==row['bytes'] and sha(row['path'])==row['sha256'],'Installed binding drift: '+row['path']
        ready['bindings'].append(dict(path=str(installed_path),bytes=installed_path.stat().st_size,sha256=sha(installed_path)))
        ready['runtimeRoutes']='Installed local identities frozen; runtime/native qualification and current resource admission remain disabled'
    c.verify_structure(ready)
    save(here/'readiness.json',ready)
    files=[*source_paths,here/'readiness.json',here/'recovery-provenance.json',here/'red-controls.json']
    if installed_path.exists():files.append(installed_path)
    save(here/'candidate-index.json',dict(phase='SOURCE_ONLY_DISABLED_REVIEW_CANDIDATE',runtimeAuthorization=False,
        files=[dict(path=str(p.relative_to(here)),bytes=p.stat().st_size,sha256=sha(p)) for p in files]))
    print(json.dumps(dict(status='FROZEN_SOURCE_ONLY',sources=len(source_paths),bindings=len(ready['bindings']),
                         readinessSha256=sha(here/'readiness.json'),indexSha256=sha(here/'candidate-index.json'))))
if __name__=='__main__':main()
