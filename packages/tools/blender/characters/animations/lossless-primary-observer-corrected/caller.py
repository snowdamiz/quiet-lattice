"""Thin one-use T02 pilot caller. The accepted StationJob alone owns lifecycle."""
import argparse
import datetime
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time
import struct
import zlib

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
READY=HERE/'readiness.json'

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def write(path,value):
    path=Path(path);temporary=path.with_name(path.name+'.writing')
    temporary.write_text(json.dumps(value,indent=2)+'\n');os.replace(temporary,path)

def error_receipt(error):
    try:message=str(error)
    except BaseException:message='<original error could not be stringified>'
    try:details=json.loads(json.dumps(vars(error),default=str))
    except BaseException as secondary:details={'detailsEncodingFailure':type(secondary).__name__}
    return {'type':type(error).__name__,'message':message,'details':details}

def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def tree_index(directory,exclude,allow_profile_links=False):
    rows=[]
    for p in sorted(Path(directory).rglob('*')):
        relative=str(p.relative_to(directory))
        if p.is_symlink():
            assert allow_profile_links and 'owned-job' in p.parts,'Artifact symlink refused'
            text=os.readlink(p)
            rows.append({'path':relative,'kind':'preserved-profile-symlink','link':text,
                'bytes':len(os.fsencode(text)),'sha256':hashlib.sha256(os.fsencode(text)).hexdigest()})
            continue
        if p.is_file() and relative not in exclude:
            rows.append({'path':str(p.relative_to(directory)),'bytes':p.stat().st_size,'sha256':sha(p)})
        else:assert p.is_dir() or p.is_file(),'Unsupported artifact kind'
    return rows

def verify_structure(ready):
    if ready.get('purpose')=='CPU_LOSSLESS_PRIMARY_132_EXISTING_FRAMES':
        assert ready['runtimeAuthorization'] is False and ready['primaryArtifactSchema']=='t02-lossless-rgb-primary/v1'
        assert ready['viewport']==[1920,1080] and ready['captureSeconds']==120 and ready['cleanupSeconds']==20
        assert ready['limits']=={'maxImageBytes':12582912,'maxObservationBytes':262144}
        assert len(ready['stages'])==1 and len(ready['stages'][0]['work'])==132 and len(ready['sourceFrames'])==132
        works=ready['stages'][0]['work'];assert works==[x['work'] for x in ready['sourceFrames']]
        assert [w['ordinal'] for w in works]==list(range(15,147)) and len({w['id'] for w in works})==132
        assert all(w['people']=='thalune' and w['clip']==w['reel']=='walk_forward' and w['lod']==0 and w['wire'] is False for w in works)
        return works
    assert ready['viewport']==[1920,1080] and ready['outputFormat']=='PNG8_RGB_OR_RGBA'
    assert ready['captureSeconds']==600 and ready['cleanupSeconds']==60
    assert ready['limits']=={'maxImageBytes':12582912,'maxObservationBytes':262144,
        'maxAncillaryStageBytes':67108864,'maxArchiveStageBytes':1073741824}
    stages=ready['stages'];assert len(stages)==9 and len({s['id'] for s in stages})==9
    assert [(s['people'],s.get('lod')) for s in stages[:6]]==[(p,l) for p in ['thalune','ixari','ulgani'] for l in [0,2]]
    assert [s['people'] for s in stages[6:]]==['thalune','ixari','ulgani']
    assert all(s['kind']=='motion' and len(s['work'])==396 for s in stages[:6])
    assert all(s['kind']=='stills' and len(s['work'])==16 for s in stages[6:])
    work=[w for s in stages for w in s['work']]
    assert len(work)==2424 and len({w['id'] for w in work})==2424
    for s in stages:
        assert [w['ordinal'] for w in s['work']]==list(range(len(s['work'])))
        for w in s['work']:
            assert w['people']==s['people'] and w['clip'] in ['walk_forward','cast_resonance']
            assert w['light'] in ['noon-lush','night-exotic','open-space'] and w['lod'] in [0,2] and isinstance(w['wire'],bool)
            assert 0<=w['time']<=ready['clipDurations'][w['clip']]
    return work

def verify(ready,active=False):
    if ready.get('purpose')=='CPU_LOSSLESS_PRIMARY_132_EXISTING_FRAMES':
        verify_structure(ready)
        assert ready['runtimeAuthorization'] is False and not active
        assert str(Path(sys.executable).resolve())==ready['rgbPrimary']['python']
        assert os.environ.get('PATH')==ready['pathEnvironment'],'Exact pinned PATH required'
        for b in ready['bindings']:assert sha(b['path'])==b['sha256'],'CPU source/binary drift: '+b['path']
        candidate=json.loads((HERE/'candidate-index.json').read_text())
        assert candidate['phase']=='FROZEN_CPU_SOURCE_REVIEW_CANDIDATE' and candidate['runtimeAuthorization'] is False
        for row in candidate['files']:assert sha(HERE/row['path'])==row['sha256'],'CPU candidate drift: '+row['path']
        free=shutil.disk_usage(HERE).free;required=ready['fixtureDiskAdmission']['totalRequiredBytes']
        assert free>=required,'Insufficient CPU fixture-only disk admission'
        return {'status':'CPU_SOURCE_BINDINGS_VERIFIED_BROWSER_DISABLED','frames':132,'freeBytes':free,'requiredBytes':required,'runtimeAuthorization':False}
    assert ready['preparationRoot']==str(HERE)
    info=HERE.lstat();assert not HERE.is_symlink() and stat.S_IMODE(info.st_mode)==0o700 and info.st_uid==os.getuid()
    verify_structure(ready)
    root=Path(ready['root']);assert root.resolve()==root
    for b in ready['bindings']:assert sha(b['path'])==b['sha256'],'Binding drift: '+b['path']
    def git(*args):return subprocess.check_output([ready['git'],*args],cwd=root,text=True,timeout=5).strip()
    assert git('rev-parse','HEAD')==ready['head'] and git('branch','--show-current')==ready['branch']
    assert not git('status','--porcelain'),'Worktree changed'
    assert str(Path(sys.executable).resolve())==ready['python']
    assert os.environ.get('PATH')==ready['pathEnvironment'],'Launcher PATH changed'
    assert os.getuid()==ready['uid']
    route=subprocess.run(ready['routeVerifyArgv'],cwd=root,capture_output=True,text=True,timeout=10)
    assert route.returncode==0,'Concrete import route drift: '+route.stderr
    candidate=json.loads((HERE/'candidate-index.json').read_text())
    assert candidate['phase'] in ['PROVISIONAL_PREFLIGHT_ONLY','FROZEN_REVIEW_CANDIDATE_INDEX']
    for row in candidate['files']:
        assert sha(HERE/row['path'])==row['sha256'],'Reviewed candidate file drift: '+row['path']
    # Read-only encoder binding through the exact accepted helper, never service launch.
    sys.path.insert(0,ready['stationApiDirectory'])
    api=importlib.import_module('run_round4_remaining8')
    assert api.encoder_binding()==ready['encoderBinding'],'Installed encoder binding drift'
    out=Path(ready['outputRoot'])
    assert out.parent==Path('/private/tmp') and out.resolve()==out and not out.is_symlink()
    if not active:assert not out.exists(),'Output namespace already exists'
    completed=0
    if active:
        consumed=json.loads((HERE/'consumed-attempt.json').read_text())
        assert consumed['readinessSha256']==sha(READY)
        assert consumed['combinedCandidateSha256']==sha(HERE/'candidate-index.json')
        assert consumed['grantSha256']==sha(HERE/'grant.json'),'Consumed grant changed'
        state=json.loads((out/'attempt.json').read_text())
        assert state['status']=='ACTIVE_OR_INTERRUPTED_HOLD' and state['primaryFailure'] is None
        completed=len(state['completed'])
        assert state['completed']==[s['id'] for s in ready['stages'][:completed]]
    remaining=sum(len(s['work'])*(ready['limits']['maxImageBytes']+ready['limits']['maxObservationBytes'])+
        ready['limits']['maxAncillaryStageBytes']+ready['limits']['maxArchiveStageBytes'] for s in ready['stages'][completed:])
    required=remaining+4*1024**3
    assert shutil.disk_usage('/private/tmp').free>=required,'Insufficient conservative remaining free space'
    return {'status':'CPU_BINDINGS_VERIFIED_NO_LAUNCH','head':ready['head'],'remainingSpaceRequiredBytes':required,
        'exporterReview':'PASS','candidatePhase':candidate['phase'],'stages':9,'frames':2376,'stills':48}

def consume(ready,grant_path):
    assert ready.get('runtimeAuthorization') is True,'CPU-only source candidate; browser execution disabled'
    assert Path(grant_path).absolute()==HERE/'grant.json' and not Path(grant_path).is_symlink()
    grant=json.loads(Path(grant_path).read_text())
    assert grant['authorizationId']==os.environ.get('T02_PILOT_GPU_GRANT') and grant['authorizationId']
    assert grant['purpose']=='P1_E05_T02_NINE_STAGE_PILOT_ONLY' and grant['parentGpuGo'] is True
    assert grant['readinessSha256']==sha(READY) and grant['attemptId']==ready['attemptId']
    assert grant['head']==ready['head'] and grant['outputRoot']==ready['outputRoot']
    assert grant['stageIds']==[s['id'] for s in ready['stages']]
    assert grant['motionFrames']==2376 and grant['stills']==48 and grant['viewport']==ready['viewport']
    review=grant['combinedReview'];assert review['verdict']=='PASS' and sha(review['path'])==review['sha256']
    assert grant['combinedCandidateSha256']==sha(HERE/'candidate-index.json')
    assert json.loads((HERE/'candidate-index.json').read_text())['phase']=='FROZEN_REVIEW_CANDIDATE_INDEX'
    assert sha(ready['browserBoundaryProof']['path'])==ready['browserBoundaryProof']['sha256']
    proof=json.loads(Path(ready['browserBoundaryProof']['path']).read_text())
    qualification=ready['browserBoundaryQualification']
    assert sha(qualification['path'])==qualification['sha256']
    qualified=json.loads(Path(qualification['path']).read_text())
    assert proof['status']=='PASS_OBSERVED_CHROMIUM_EXECUTION_BOUNDARY' and proof['observed_chromium_boundary_qualified'] is True
    assert proof['teardown_status']=='DRAINED_AND_ARCHIVED'
    assert qualified['status']==proof['status'] and qualified['accepted_by_parent'] is True
    assert qualified['result']['sha256']==ready['browserBoundaryProof']['sha256']
    assert str(Path(ready['stationApiDirectory']).parents[3]/qualified['result']['path'])==ready['browserBoundaryProof']['path']
    assert qualified['actual_executable']==ready['browser']['selectedExecutable']['path']
    assert qualified['actual_executable_sha256']==ready['browser']['selectedExecutable']['sha256']
    assert not Path(ready['outputRoot']).exists() and not (HERE/'consumed-attempt.json').exists()
    record={'attemptId':ready['attemptId'],'authorizationId':grant['authorizationId'],'readinessSha256':sha(READY),
        'grantSha256':sha(grant_path),'utc':utc(),'outputRoot':ready['outputRoot'],'head':ready['head'],
        'combinedCandidateSha256':sha(HERE/'candidate-index.json'),'viewport':ready['viewport'],'motionFrames':2376,'stills':48}
    with (HERE/'consumed-attempt.json').open('x') as stream:json.dump(record,stream,indent=2)
    Path(ready['outputRoot']).mkdir(mode=0o700)
    write(Path(ready['outputRoot'])/'admission.json',record)
    (Path(ready['outputRoot'])/'frozen-readiness.json').write_bytes(READY.read_bytes())
    write(Path(ready['outputRoot'])/'attempt.json',{'status':'ACTIVE_OR_INTERRUPTED_HOLD','completed':[],'primaryFailure':None})
    return Path(ready['outputRoot']),record

def inspect_primary_capture(stage,directory,ready,validation_directory,release_receipt):
    import importlib.util,math
    directory=Path(directory);validation_directory=Path(validation_directory)
    spec=importlib.util.spec_from_file_location('rgb_primary_inspector',HERE/'rgb-primary.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
    assert release_receipt['primaryFailure'] is None and release_receipt['cleanupFailure'] is None
    assert release_receipt['terminal']['registrationAbsent'] and release_receipt['terminal']['scratchAndTmpAbsent']
    assert release_receipt['terminal']['kernel']['live']==0 and release_receipt['terminal']['kernel']['coalition_absent']
    result=json.loads((directory/'entry-result.json').read_text());index=json.loads((directory/'artifact-index.json').read_text())
    assert result['accepted'] is True and result['primaryFailure'] is None and not result['cleanupFailures'] and not result['persistenceFailures']
    assert result['stage']==index['stage']==stage['id'] and index['accepted'] is True
    assert result['completed']==[w['id'] for w in stage['work']]
    assert index['files']==tree_index(directory,{'artifact-index.json'}),'Final primary index stale'
    expected={'entry-state.json','entry-result.json','sequence-index.json','frame-map.json','primary.mp4','encoder-config.json','encoder-command.json','encoder-result.json'}|{f"observations/{w['ordinal']:04}.json" for w in stage['work']}
    assert {x['path'] for x in index['files']}==expected
    assert not list((directory/'images').glob('*')),'Primary motion retained unexpected PNG'
    sequence=json.loads((directory/'sequence-index.json').read_text());mapping=json.loads((directory/'frame-map.json').read_text());rows=mapping['frames']
    assert sequence['primaryArtifactSchema']==mapping['schema']==worker.SCHEMA
    assert sequence['completeWork'] and sequence['stage']==stage['id'] and sequence['viewport']==[1920,1080]
    assert sequence['manualSampleRateHz']==60 and sequence['realTimePerformanceQualified'] is False
    assert sequence['work']==[{**w,'primaryVideo':'primary.mp4','mediaFrameOrdinal':i,'observation':f"observations/{w['ordinal']:04}.json"} for i,w in enumerate(stage['work'])]
    assert len(rows)==len(stage['work']) and (directory/'primary.mp4').stat().st_size<=512*1024**2
    assert sum(x['bytes'] for x in index['files'] if x['path']!='primary.mp4')<=ready['rgbPrimary']['maxMetadataBytes']
    names=sorted(b['name'] for b in ready['binding']['profile']['bones'])
    for i,(w,row) in enumerate(zip(stage['work'],rows)):
        assert all(row[k]==v for k,v in w.items()) and row['workId']==w['id']
        assert row['schema']==worker.SCHEMA and row['primaryVideo']=='primary.mp4' and row['mediaFrameOrdinal']==i
        assert row['mediaPts']==1000*i and row['mediaTimeBase']=='1/60000' and row['sourcePngRetained'] is False
        assert row['alphaPolicy']=='verified-opaque255' and [row['width'],row['height']]==ready['viewport']
        assert 0<row['sourcePngBytes']<=ready['limits']['maxImageBytes']
        for k in ['sourcePngSha256','rgbSha256','rgbaSha256','observationSha256','poseSha256']:
            assert isinstance(row[k],str) and len(row[k])==64 and all(c in '0123456789abcdef' for c in row[k])
        obsfile=directory/row['observation'];assert row['observation']==f"observations/{w['ordinal']:04}.json"
        assert obsfile.stat().st_size<=ready['limits']['maxObservationBytes'] and sha(obsfile)==row['observationSha256']
        obs=json.loads(obsfile.read_text());assert 'dataUrl' not in obs
        assert type(obs['actualWire']) is bool
        actual={key:obs[key] for key in ['workId','reel','frame','sequenceTime','actualPeople','actualVariant','actualClip','actualLight','actualLod','actualWire','sourceProfileId','targetProfileId']}
        expected={'workId':w['id'],'reel':w['reel'],'frame':w['frame'],'sequenceTime':w['sequenceTime'],'actualPeople':w['people'],'actualVariant':w['people']+'_head1','actualClip':w['clip'],'actualLight':w['light'],'actualLod':w['lod'],'actualWire':w['wire'],'sourceProfileId':ready['manifest']['sourceProfileId'],'targetProfileId':'characters/'+w['people']+'@'+ready['peopleHashes'][w['people']]}
        assert actual==expected,'Returned primary work/frame/profile identity refused'
        assert abs(obs['actualTime']-w['time'])<=1e-6 and abs(obs['clipDuration']-ready['clipDurations'][w['clip']])<=1e-6
        assert obs['intendedPose']==obs['atRender']['pose']==obs['afterCapture'] and obs['renderCount']==1 and obs['pageErrors']==[]
        assert json.loads(row['poseCanonicalJson'])==obs['intendedPose'] and hashlib.sha256(row['poseCanonicalJson'].encode()).hexdigest()==row['poseSha256']
        for pose in [obs['intendedPose'],obs['atRender']['pose'],obs['afterCapture']]:
            assert sorted(b['name'] for b in pose)==names
            assert all(len(b['position'])==3 and len(b['quaternion'])==4 and len(b['scale'])==3 and all(type(v) in [int,float] and math.isfinite(v) for key in ['position','quaternion','scale'] for v in b[key]) for b in pose)
        assert all(len(obs['atRender'][k])==16 and all(math.isfinite(v) for v in obs['atRender'][k]) for k in ['cameraWorld','reviewWorld'])
    worker.check_probe(json.loads((validation_directory/'probe.stdout').read_text()),len(rows))
    for kind in ['rgb','rgba']:worker.parse_framehash((validation_directory/(kind+'.stdout')).read_text(),rows,kind)
    validation=json.loads((validation_directory/'validation.json').read_text())
    assert validation['accepted'] and validation['everyRgbAndRgbaHash'] and validation['ordered60Hz'] and validation['frames']==len(rows)
    assert validation['rawRgbSpoolBytes']==0 and validation['videoSha256']==sha(directory/'primary.mp4') and validation['frameMapSha256']==sha(directory/'frame-map.json')
    encoder=json.loads((directory/'encoder-result.json').read_text())
    assert encoder['accepted'] and encoder['frames']==len(rows) and encoder['videoSha256']==sha(directory/'primary.mp4')
    return {'accepted':True,'schema':worker.SCHEMA,'frames':len(rows),'images':0,'observations':len(rows),'videoBytes':(directory/'primary.mp4').stat().st_size,'indexSha256':sha(directory/'artifact-index.json'),'validationSha256':sha(validation_directory/'validation.json')}

def inspect_capture(stage,directory,ready,validation_directory=None,release_receipt=None):
    if stage['kind']=='motion' and ready.get('primaryArtifactSchema')=='t02-lossless-rgb-primary/v1':
        return inspect_primary_capture(stage,directory,ready,validation_directory,release_receipt)
    result=json.loads((directory/'entry-result.json').read_text())
    assert result['stage']==stage['id'] and result['accepted'] is True
    assert result['primaryFailure'] is None and not result['cleanupFailures'] and not result['persistenceFailures']
    assert result['completed']==[w['id'] for w in stage['work']]
    index=json.loads((directory/'artifact-index.json').read_text())
    assert index['stage']==stage['id'] and index['accepted'] is True
    assert index['files']==tree_index(directory,{'artifact-index.json'}),'Final capture index stale'
    images=list((directory/'images').glob('*.png'));observations=list((directory/'observations').glob('*.json'))
    assert len(images)==len(observations)==len(stage['work'])
    expected={'entry-state.json','entry-result.json','sequence-index.json'}|{f"images/{w['ordinal']:04}.png" for w in stage['work']}|{
        f"observations/{w['ordinal']:04}.json" for w in stage['work']}
    assert {x['path'] for x in index['files']}==expected,'Unexpected or missing capture artifact'
    sequence=json.loads((directory/'sequence-index.json').read_text())
    assert sequence['completeWork'] is True and sequence['finalStatusReference']=='entry-result.json'
    assert sequence['stage']==stage['id'] and sequence['viewport']==ready['viewport']
    assert sequence['manualSampleRateHz']==(60 if stage['kind']=='motion' else None) and sequence['realTimePerformanceQualified'] is False
    assert sequence['work']==[{**w,'image':f"images/{w['ordinal']:04}.png",'observation':f"observations/{w['ordinal']:04}.json"} for w in stage['work']]
    bound=len(stage['work'])*(ready['limits']['maxImageBytes']+ready['limits']['maxObservationBytes'])+ready['limits']['maxAncillaryStageBytes']
    assert sum(x['bytes'] for x in index['files'])<=bound,'Capture stage byte bound exceeded'
    for w in stage['work']:
        obs=json.loads((directory/'observations'/f"{w['ordinal']:04}.json").read_text())
        assert isinstance(obs['actualWire'],bool),'Returned wire identity type refused'
        assert {key:obs[key] for key in ['workId','reel','frame','sequenceTime','actualPeople','actualVariant',
            'actualClip','actualLight','actualLod','actualWire','sourceProfileId','targetProfileId']}=={
            'workId':w['id'],'reel':w['reel'],'frame':w['frame'],'sequenceTime':w['sequenceTime'],
            'actualPeople':w['people'],'actualVariant':w['people']+'_head1','actualClip':w['clip'],
            'actualLight':w['light'],'actualLod':w['lod'],'actualWire':w['wire'],
            'sourceProfileId':ready['manifest']['sourceProfileId'],
            'targetProfileId':'characters/'+w['people']+'@'+ready['peopleHashes'][w['people']]},'Returned work/frame/profile identity refused'
        assert abs(obs['actualTime']-w['time'])<=1e-6 and abs(obs['clipDuration']-ready['clipDurations'][w['clip']])<=1e-6
        assert obs['intendedPose']==obs['atRender']['pose']==obs['afterCapture'] and obs['renderCount']==1 and obs['pageErrors']==[]
        assert obs['dataUrl']['file']==f"images/{w['ordinal']:04}.png"
        image=directory/obs['dataUrl']['file'];data=image.read_bytes()
        assert len(data)<=ready['limits']['maxImageBytes'] and sha(image)==obs['dataUrl']['sha256']
        assert data[:8]==bytes.fromhex('89504e470d0a1a0a')
        offset=8;ihdr=idat=0;ended=False;compressed=[];channels=0
        while offset<len(data):
            assert offset+12<=len(data);n=struct.unpack_from('>I',data,offset)[0];stop=offset+n+12;assert stop<=len(data)
            kind=data[offset+4:offset+8];body=data[offset+8:offset+8+n]
            assert zlib.crc32(data[offset+4:offset+8+n])==struct.unpack_from('>I',data,offset+8+n)[0]
            if kind==b'IHDR':
                ihdr+=1;assert offset==8 and n==13 and list(struct.unpack_from('>II',body))==ready['viewport']
                assert body[8]==8 and body[9] in [2,6] and body[10:]==bytes(3);channels=4 if body[9]==6 else 3
            if kind==b'IDAT':idat+=n;compressed.append(body)
            if kind==b'IEND':assert n==0 and stop==len(data);ended=True
            offset=stop
        assert ihdr==1 and idat>0 and ended
        row=1+ready['viewport'][0]*channels;expected=row*ready['viewport'][1]
        decoder=zlib.decompressobj();decoded=decoder.decompress(b''.join(compressed),expected+1)
        assert decoder.eof and not decoder.unused_data and len(decoded)==expected
        assert all(decoded[y*row]<=4 for y in range(ready['viewport'][1]))
    return {'accepted':True,'images':len(images),'observations':len(observations),'bytes':sum(x['bytes'] for x in index['files']),
        'entryResultSha256':sha(directory/'entry-result.json'),'indexSha256':sha(directory/'artifact-index.json')}

class StationAdapter:
    def __init__(self,ready,out,record):
        self.ready,self.out,self.record=ready,Path(out),record
        sys.path.insert(0,ready['stationApiDirectory'])
        self.core=importlib.import_module('round4_job_boundary')
        self.temp=importlib.import_module('run_round4_browser_proof')
        self.support=importlib.import_module('run_round4_remaining8')

    def __call__(self,definition):
        ready=self.ready;out=self.out/'stages'/definition['id'];out.mkdir(parents=True,exist_ok=False)
        receipt={'stage':definition['id'],'accepted':False,'primaryFailure':None,'cleanupFailures':[],
            'persistenceFailures':[],'terminalProcessRelease':False,'profileRelease':False,'cacheRelease':False}
        def save():
            try:write(out/'stage-receipt.json',receipt)
            except BaseException as error:
                record=error_receipt(error);receipt['persistenceFailures'].append(record)
                if receipt['primaryFailure'] is None:receipt['primaryFailure']=record
                try:print(json.dumps(receipt),file=sys.stderr,flush=True)
                except BaseException:pass
        def primary(error):
            if receipt['primaryFailure'] is None:receipt['primaryFailure']=error_receipt(error)
            save()
        job=observer=private_tmp=admission=None
        try:
            claim=out/'launch-claim';claim.mkdir(exist_ok=False)
            write(claim/'admission.json',{'stage':definition['id'],'attemptId':ready['attemptId'],
                'authorizationId':self.record['authorizationId'],'readinessSha256':sha(READY)})
            started=time.monotonic()
            with self.core.deadline(600):
                private_tmp,admission=self.temp.create_private_tmp(out/'private-tmp-admission.json')
                argv=[ready['node'],'--import',ready['tsxImport'],str(HERE/'entry.mjs'),str(READY),definition['id'],str(out/'capture')]
                job=self.core.StationJob.__new__(self.core.StationJob)
                self.core.StationJob.__init__(job,out/'owned-job',argv,ready['root'],capture_seconds=600,
                    env={'PATH':ready['pathEnvironment'],'TMPDIR':str(private_tmp)+os.sep,'SMOKE_GL':'metal','DEBUG':'pw:browser',
                        'T02_PILOT_READY_SHA':sha(READY),'T02_PILOT_ATTEMPT':ready['attemptId'],
                        'T02_PILOT_STAGE':definition['id'],'T02_PILOT_GRANT':self.record['authorizationId']})
                job.state.update(scope='SEPARATELY_GRANTED_T02_NINE_STAGE_PILOT_ONLY',stage=definition['id'],
                    readiness_sha256=sha(READY),attempt_id=ready['attemptId']);job.save()
                job.start()
                observer=self.support.StageReceipts(job,ready,private_tmp)
                def observe():
                    try:observer.observe()
                    except BaseException as error:primary(error);raise
                outcome=job.wait(max(.001,600-(time.monotonic()-started)),observe)
                receipt['returnedOutcome']=outcome;receipt['returnedExits']=dict(job.state['exits']);save()
                assert outcome=='completed' and job.state['exits'].get('capture')==0,'Capture outcome refused'
                observer.require_browser()
        except BaseException as error:primary(error)
        finally:
            try:
                with self.core.deadline(60):
                    assert job is not None and job.coalition_id,'No durable owned boundary; retain allocation and scratch for recovery'
                    drained=job.drain(60);receipt['returnedLifecycle']=json.loads(json.dumps(drained));save()
                    assert drained['drained'] and self.core.kernel_tasks(job.coalition_id)['live']==0
                    assert not job.members()
                    for pid,old in job.known.items():
                        current=self.core.identity(int(pid));assert current is None or current['birth']!=old['birth']
                    receipt['terminalProcessRelease']=True
                    job.archive(profile_namespace=private_tmp,profile_prefixes=('playwright_chromiumdev_profile-',))
                    profiles=json.loads((job.out/'profile_release.json').read_text());receipt['returnedProfiles']=profiles;save()
                    assert profiles['all_absent'];receipt['profileRelease']=True
                    release=self.temp.preserve_private_tmp(private_tmp,admission,job.out/'preserved-private-tmp',job=job)
                    receipt['returnedCacheRelease']=release;save()
                    assert release['all_bytes_preserved'] and release['namespace_removed'];receipt['cacheRelease']=True
                    assert drained['clean'] and drained['exits'].get('capture')==drained['exits'].get('caffeinate')==0
                    assert not job.scratch.exists() and not Path(private_tmp).exists()
                    assert sum(x['bytes'] for x in tree_index(job.out,set(),True))<=ready['limits']['maxArchiveStageBytes'],'Owned archive byte bound exceeded'
            except BaseException as error:receipt['cleanupFailures'].append(error_receipt(error));save()
        if receipt['primaryFailure'] is None and not receipt['cleanupFailures'] and not receipt['persistenceFailures']:
            try:
                with self.core.deadline(45):
                    inspected=inspect_capture(definition,out/'capture',ready)
                receipt['returnedInspection']=inspected;save()
                assert inspected['accepted']
                verify(ready,active=True)
                receipt['accepted']=True
            except BaseException as error:primary(error)
        save()
        if receipt['persistenceFailures']:receipt['accepted']=False
        if not receipt['persistenceFailures']:
            try:write(out/'stage-final-index.json',{'stage':definition['id'],'accepted':receipt['accepted'],
                'files':tree_index(out,{'stage-final-index.json'},True)})
            except BaseException as error:primary(error);receipt['accepted']=False;save()
        return receipt

def run_sequence(ready,adapter,out,check,writer=write):
    result={'status':'HOLD','primaryFailure':None,'stages':[],'persistenceFailures':[]}
    def save(path,value):
        try:writer(path,value);return True
        except BaseException as error:
            record=error_receipt(error);result['persistenceFailures'].append(record)
            if result['primaryFailure'] is None:result['primaryFailure']=record
            try:print(json.dumps(result),file=sys.stderr,flush=True)
            except BaseException:pass
            return False
    for definition in ready['stages']:
        try:
            check(ready)
            receipt=adapter(definition)
        except BaseException as error:receipt={'stage':definition['id'],'accepted':False,'primaryFailure':error_receipt(error)}
        result['stages'].append(receipt) # Retain the returned observation before acceptance checks.
        if isinstance(receipt,dict) and receipt.get('primaryFailure') is not None:
            result['primaryFailure']=receipt['primaryFailure'] # Preserve the returned original before any fallible write.
        if not save(out/'sequence-state.json',result):break
        if not isinstance(receipt,dict) or receipt.get('accepted') is not True:
            result['primaryFailure']=result['primaryFailure'] or {'type':'StageRefused','message':definition['id']}
        elif not all(receipt.get(k) is True for k in ['terminalProcessRelease','profileRelease','cacheRelease']) or receipt.get('cleanupFailures') or receipt.get('persistenceFailures'):
            result['primaryFailure']=result['primaryFailure'] or {'type':'StageReleaseFailure','message':definition['id']}
        if result['primaryFailure'] or result['persistenceFailures']:
            break
        state=json.loads((out/'attempt.json').read_text());state['completed'].append(definition['id'])
        if not save(out/'attempt.json',state):break
    else:result['status']='CAPTURED_PENDING_VISUAL_REVIEW'
    state=json.loads((out/'attempt.json').read_text());state['status']=result['status'];state['primaryFailure']=result['primaryFailure']
    if result['persistenceFailures']:result['status']='HOLD';state['status']='HOLD'
    save(out/'sequence-state.json',result);save(out/'attempt.json',state);save(out/'result.json',result)
    if result['persistenceFailures']:
        result['status']='HOLD';state['status']='HOLD';state['primaryFailure']=result['primaryFailure']
        save(out/'sequence-state.json',result);save(out/'attempt.json',state);save(out/'result.json',result)
        return result
    if not result['persistenceFailures']:
        if not save(out/'final-index.json',{'status':result['status'],'files':tree_index(out,{'final-index.json'},True)}):
            result['status']='HOLD';state['status']='HOLD';state['primaryFailure']=result['primaryFailure']
            save(out/'attempt.json',state);save(out/'result.json',result)
    return result

def main():
    p=argparse.ArgumentParser();p.add_argument('--preflight',action='store_true');p.add_argument('--execute',action='store_true');p.add_argument('--grant')
    args=p.parse_args();ready=json.loads(READY.read_text());checked=verify(ready)
    if not args.execute:print(json.dumps(checked,indent=2));return 0
    assert not args.preflight and args.grant,'Separate exact pilot grant required'
    out=None
    try:
        out,record=consume(ready,args.grant)
        result=run_sequence(ready,StationAdapter(ready,out,record),out,lambda r:verify(r,active=True))
    except BaseException as error:
        original=error_receipt(error)
        failed={'status':'HOLD','primaryFailure':original,'persistenceFailures':[]}
        possible=Path(ready['outputRoot'])
        if possible.exists():
            try:write(possible/'caller-primary-failure.json',failed)
            except BaseException as secondary:failed['persistenceFailures'].append(error_receipt(secondary))
        try:print(json.dumps(failed),file=sys.stderr,flush=True)
        except BaseException:pass
        return 1
    return 0 if result['status']=='CAPTURED_PENDING_VISUAL_REVIEW' else 1

if __name__=='__main__':raise SystemExit(main())
