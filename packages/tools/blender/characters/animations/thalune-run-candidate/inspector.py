"""Thin one-use T02 pilot caller. The accepted StationJob alone owns lifecycle."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import math
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
from inventory_boundary import paths as inventory_paths

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
    try:
        attributes=dict(vars(error))
        for key in ['args','errno','filename','filename2','winerror']:
            if hasattr(error,key):attributes.setdefault(key,getattr(error,key))
        details=json.loads(json.dumps(attributes,default=str))
    except BaseException as secondary:details={'detailsEncodingFailure':type(secondary).__name__}
    return {'type':type(error).__name__,'message':message,'details':details}

def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def tree_index(directory,exclude,allow_profile_links=False):
    rows=[]
    for p in sorted(inventory_paths(Path(directory))):
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

def inspect_primary_capture(stage,directory,ready,validation_directory,release_receipt):
    import importlib.util,math
    directory=Path(directory);validation_directory=Path(validation_directory)
    sys.path.insert(0,str(HERE));import packet_budget
    packet_root=Path(ready['packetRoot']);assert directory==packet_root/'captures'/stage['id']
    validator=next(j for j in ready['jobs'] if j['kind']=='validator' and j['capture']==stage['id'])
    assert validation_directory==packet_root/'inspections'/validator['id']
    assert release_receipt['name']==validator['id']
    whole_packet=packet_budget.inspect(packet_root)
    assert not (packet_root/'failure.json').exists(),'Reserved first failure holds primary packet'
    expected_validation={name+suffix for name in ['probe','rgb','rgba'] for suffix in ['.stdout','.stderr','-command.json']}|{'validation.json'}
    assert {str(p.relative_to(validation_directory)) for p in inventory_paths(validation_directory) if p.is_file()}==expected_validation
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
    assert len(rows)==len(stage['work'])==189 and (directory/'primary.mp4').stat().st_size<=39354368
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
        assert type(obs['actualTime']) in [int,float] and math.isfinite(obs['actualTime']) and abs(obs['actualTime']-w['time'])<=1e-6 and abs(obs['clipDuration']-ready['clipDurations'][w['clip']])<=1e-6
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
        obsfile=directory/'observations'/f"{w['ordinal']:04}.json"
        assert obsfile.stat().st_size<=ready['limits']['maxObservationBytes']
        obs=json.loads(obsfile.read_text())
        assert isinstance(obs['actualWire'],bool),'Returned wire identity type refused'
        assert {key:obs[key] for key in ['workId','reel','frame','sequenceTime','actualPeople','actualVariant',
            'actualClip','actualLight','actualLod','actualWire','sourceProfileId','targetProfileId']}=={
            'workId':w['id'],'reel':w['reel'],'frame':w['frame'],'sequenceTime':w['sequenceTime'],
            'actualPeople':w['people'],'actualVariant':w['people']+'_head1','actualClip':w['clip'],
            'actualLight':w['light'],'actualLod':w['lod'],'actualWire':w['wire'],
            'sourceProfileId':ready['manifest']['sourceProfileId'],
            'targetProfileId':'characters/'+w['people']+'@'+ready['peopleHashes'][w['people']]},'Returned work/frame/profile identity refused'
        assert type(obs['actualTime']) in [int,float] and math.isfinite(obs['actualTime']) and abs(obs['actualTime']-w['time'])<=1e-6 and abs(obs['clipDuration']-ready['clipDurations'][w['clip']])<=1e-6
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
