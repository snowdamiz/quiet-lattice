"""Pure contract, inspector and attempted-job controls. All native subprocesses refused."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import copy,hashlib,importlib.util,io,json,os,subprocess,tempfile
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
import contract as c
import packet_budget as budget
import caller
import inspector

HERE=Path(__file__).resolve().parent
native_calls=[]
def refuse(*args,**kwargs):
    native_calls.append(str(args));raise AssertionError('Native launch refused by source controls')
subprocess.Popen=refuse
s=importlib.util.spec_from_file_location('worker',HERE/'rgb-primary.py');worker=importlib.util.module_from_spec(s);s.loader.exec_module(worker)
ready=json.loads((HERE/'readiness.json').read_text())
controls=[]
def pass_control(name):controls.append(dict(control=name,pass_=True))
def rejects(name,fn):
    try:fn()
    except (AssertionError,ValueError,KeyError,RuntimeError,TypeError,FileNotFoundError):pass_control(name);return
    raise AssertionError('Unexpected acceptance: '+name)
def load(path):return json.loads(Path(path).read_text())
def save(path,value):Path(path).write_text(json.dumps(value,indent=2)+'\n')

assert len(c.verify_structure(ready))==386 and sum(len(s['work']) for s in ready['stages'][:2])==378
for stage in ready['stages'][:2]:
    assert len(stage['work'])==189
    assert [w['time'] for w in stage['work'][15:159]]==[i/60 for i in range(48)]*3
    assert all(w['time']==0 for w in stage['work'][:15]) and all(w['time']==.8 for w in stage['work'][159:])
assert {w['time'] for w in ready['stages'][2]['work']}=={.4}
pass_control('exact 378 motion / 8 still work, three cycles and endpoint holds')
for mode in ['count','order','time','type','job-order','duplicate']:
    bad=copy.deepcopy(ready)
    if mode=='count':bad['stages'][0]['work'].pop()
    if mode=='order':bad['stages'][0]['work'].reverse()
    if mode=='time':bad['stages'][2]['work'][0]['time']=.3
    if mode=='type':bad['stages'][0]['work'][0]['ordinal']=False
    if mode=='job-order':bad['jobs'][2],bad['jobs'][3]=bad['jobs'][3],bad['jobs'][2]
    if mode=='duplicate':bad['stages'][1]=bad['stages'][0]
    rejects('malformed plan '+mode,lambda: c.verify_structure(bad))
paths=[c.paths('/packet','/proof',j) for j in ready['jobs']]
assert len({p['raw'] for p in paths})==len({p['receipt'] for p in paths})==5
assert len({p['inspection'] for p in paths[3:]})==2 and paths[3]['capture']!=paths[4]['capture']
pass_control('separate reel, inspection, receipt and native log paths')
for count in [0,132,188,190,189.0,True]:
    rejects('encoder frame count '+repr(count),lambda: worker.check_encode_config(dict(schema=c.SCHEMA,frameCount=count,maxVideoBytes=c.VIDEO_BYTES)))
worker.check_encode_config(dict(schema=c.SCHEMA,frameCount=189,maxVideoBytes=39354368));pass_control('189 encoder limit accepted')
from PIL import Image
image=Image.new('RGBA',(1920,1080),(2,4,8,254));encoded=io.BytesIO();image.save(encoded,format='PNG')
rejects('nonopaque alpha refused before encoder forwarding',lambda:worker.pixels(encoded.getvalue()))
image.putalpha(255);encoded=io.BytesIO();image.save(encoded,format='PNG');rgb,metadata=worker.pixels(encoded.getvalue())
assert len(rgb)==1920*1080*3 and metadata['alphaPolicy']=='verified-opaque255'
pass_control('opaque source RGB and RGBA identities')

rejects('wrong reel byte config',lambda:worker.check_encode_config(dict(schema=c.SCHEMA,frameCount=189,maxVideoBytes=536870912)))

packet=Path(load(HERE/'pure-node-controls.json')['fixtureRoot'])
assert load(HERE/'pure-node-controls.json')['syntheticNotCaptureEvidence'] is True
r={**ready,'packetRoot':str(packet)}

def probe_info():
    return dict(streams=[dict(codec_name='h264',pix_fmt='gbrp',color_space='gbr',color_range='pc',width=1920,height=1080,
                time_base='1/60000',r_frame_rate='60/1',avg_frame_rate='60/1',nb_frames='189')],
                packets=[dict(pts=i*1000,dts=i*1000,duration=1000) for i in range(189)])
def hash_text(rows,kind):
    return '#tb 0: 1/60\n'+'\n'.join(f"0, {i}, {i}, 1, {worker.PIXELS*(3 if kind=='rgb' else 4)}, {row[kind+'Sha256']}" for i,row in enumerate(rows))+'\n'
def release(name):
    return dict(name=name,primaryFailure=None,cleanupFailure=None,terminal=dict(registrationAbsent=True,scratchAndTmpAbsent=True,kernel=dict(live=0,coalition_absent=True)))
for stage,job in zip(r['stages'],r['jobs'][3:]):
    cap=packet/'captures'/stage['id'];out=packet/'inspections'/job['id'];out.mkdir(exist_ok=True)
    rows=load(cap/'frame-map.json')['frames']
    for name in ['probe','rgb','rgba']:
        save(out/(name+'-command.json'),dict(synthetic=True))
        (out/(name+'.stderr')).write_text('')
        if name=='probe':save(out/(name+'.stdout'),probe_info())
        else:(out/(name+'.stdout')).write_text(hash_text(rows,name))
    save(out/'validation.json',dict(schema=c.SCHEMA,accepted=True,frames=189,everyRgbAndRgbaHash=True,ordered60Hz=True,
             rawRgbSpoolBytes=0,videoSha256=inspector.sha(cap/'primary.mp4'),frameMapSha256=inspector.sha(cap/'frame-map.json')))
    receipt=release(job['id'])
    assert inspector.inspect_capture(stage,cap,r,out,receipt)['accepted']
    cfg=dict(schema=c.SCHEMA,frameCount=189,maxVideoBytes=c.VIDEO_BYTES,video=str(cap/'primary.mp4'),frameMap=str(cap/'frame-map.json'))
    assert len(worker.check_validation_config(cfg))==189
    for count in [132,188,190,189.0,True]:
        rejects(stage['id']+' validator count '+repr(count),lambda:worker.check_validation_config({**cfg,'frameCount':count}))
    pass_control('actual inspector path accepts complete synthetic '+stage['id'])
    for mode in ['missing','reorder','pts','hash','timebase']:
        text=hash_text(rows,'rgb');lines=text.splitlines()
        if mode=='missing':lines.pop()
        if mode=='reorder':lines[1],lines[2]=lines[2],lines[1]
        if mode=='pts':lines[1]=lines[1].replace('0, 0, 0,','0, 0, 7,')
        if mode=='hash':lines[1]=lines[1][:-64]+'0'*64
        if mode=='timebase':lines[0]='#tb 0: 1/60000'
        rejects(stage['id']+' decoded '+mode,lambda:worker.parse_framehash('\n'.join(lines),rows,'rgb'))
    for mode in ['count','pts','dts','duration','rgb','extra-stream']:
        bad=probe_info()
        if mode=='count':bad['packets'].pop()
        if mode in ['pts','dts','duration']:bad['packets'][0][mode]=12
        if mode=='rgb':bad['streams'][0]['pix_fmt']='yuv420p'
        if mode=='extra-stream':bad['streams'].append(bad['streams'][0])
        rejects(stage['id']+' container '+mode,lambda:worker.check_probe(bad,189))
    bad=release(job['id']);bad['terminal']['kernel']['live']=1
    rejects('validator not released '+stage['id'],lambda:inspector.inspect_capture(stage,cap,r,out,bad))
    other=packet/'inspections'/('validate-thalune-run-lod2' if stage['lod']==0 else 'validate-thalune-run-lod0')
    rejects('wrong reel validator '+stage['id'],lambda:inspector.inspect_capture(stage,cap,r,other,receipt))
    for mode in ['map-pts','map-identity','map-count','observation','unknown-removal','seal']:
        index_path=cap/'artifact-index.json';index_bytes=index_path.read_bytes()
        file=cap/('observations/0000.json' if mode in ['observation','unknown-removal'] else 'frame-map.json')
        original=file.read_bytes();value=load(file)
        if mode=='map-pts':value['frames'][0]['mediaPts']=77
        if mode=='map-identity':value['frames'][0]['workId']='other'
        if mode=='map-count':value['frames'].pop()
        if mode=='observation':value['renderCount']=2
        if mode=='unknown-removal':del value['futureUnknown']
        if mode=='seal':value['unexpected']='tamper'
        save(file,value)
        if mode not in ['unknown-removal','seal']:
            index=load(index_path);index['files']=inspector.tree_index(cap,{'artifact-index.json'});save(index_path,index)
        rejects(stage['id']+' inspector '+mode,lambda:inspector.inspect_capture(stage,cap,r,out,receipt))
        file.write_bytes(original);index_path.write_bytes(index_bytes)
assert inspector.inspect_capture(r['stages'][2],packet/'captures'/c.CAPTURE_IDS[2],r)['images']==8
caller.StationAdapter.inspect_packet(r);pass_control('aggregate exact two reels and eight stills')
extra=packet/'extra.json';extra.write_text('{}')
rejects('extra aggregate file',lambda:caller.StationAdapter.inspect_packet(r));extra.unlink()

with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp).resolve()
    for name in c.VIDEOS:
        f=root/name;f.parent.mkdir(parents=True,exist_ok=True)
        with f.open('wb') as stream:stream.truncate(c.VIDEO_BYTES)
    budget.inspect(root)
    f=root/sorted(c.VIDEOS)[0]
    with f.open('r+b') as stream:stream.truncate(c.VIDEO_BYTES+1)
    rejects('Python per-reel ceiling plus one',lambda:budget.inspect(root))
    with f.open('r+b') as stream:stream.truncate(c.VIDEO_BYTES)
    budget.before_write(root,root/'metadata',c.METADATA_BYTES-2*c.RECORD_BYTES,atomic=True)
    rejects('Python metadata peak ceiling plus one',lambda:budget.before_write(root,root/'metadata',c.METADATA_BYTES-2*c.RECORD_BYTES+1,atomic=True))
    budget.before_write(root,root/sorted(c.STILLS)[0],c.IMAGE_BYTES)
    rejects('Python still ceiling plus one',lambda:budget.before_write(root,root/sorted(c.STILLS)[0],c.IMAGE_BYTES+1))
    for i in range(500):(root/f'f{i}').touch()
    rejects('Python prospective file count',lambda:budget.before_write(root,root/'next',0))
    rejects('negative byte count',lambda:budget.before_write(root,root/'next',-1))

class Adapter:
    def __init__(self,fail=None,bad_release=False,bad_audit=False):
        self.events=[];self.attempted=[];self.audited=[];self.fail=fail;self.bad_release=bad_release;self.bad_audit=bad_audit
    def run(self,definition,handle):
        self.attempted.append(definition['id']);self.events.append(('start',definition['id']))
        assert len(load(Path(handle['path']).parents[2]/'attempts.json'))==len(self.attempted)
        p=Path(handle['path']);p.parent.mkdir(parents=True)
        if self.fail==len(self.attempted):
            save(p,dict(cleanupFailure={'message':'partial constructor'}));raise RuntimeError('allocation/start fixture')
        value=release(definition['id']);value['futureUnknown']={'notDropped':[None,7]}
        if self.bad_release:value['terminal']['kernel']['live']=1
        save(p,value);self.events.append(('released',definition['id']));return value
    def inspect(self,stage,*args):
        self.events.append(('inspect',stage['id']));return dict(accepted=True)
    def inspect_packet(self,r):pass
    def audit(self,handle):
        self.audited.append(handle['path'])
        if self.bad_audit:raise RuntimeError('terminal audit fixture')
        return dict(attemptPath=handle['path'],releaseProved=True,kernel=dict(live=0,coalition_absent=True))

def run_adapter(adapter,writer=caller.write):
    tmp=Path(tempfile.mkdtemp(prefix='t02-ledger-pure-')).resolve();(tmp/'packet').mkdir();(tmp/'proof').mkdir()
    result=caller.run_sequence(ready,adapter,tmp/'packet',tmp/'proof',writer=writer)
    return result,tmp
adapter=Adapter();result,tmp=run_adapter(adapter)
assert result['status']=='CAPTURED_PENDING_VISUAL_REVIEW' and result['nativeJobs']==5 and result['terminalReleaseProved']
assert len(adapter.audited)==5
first_validator=adapter.events.index(('start',c.VALIDATOR_IDS[0]))
assert all(adapter.events.index(('released',name))<first_validator for name in c.CAPTURE_IDS)
assert all(v['futureUnknown']=={'notDropped':[None,7]} for v in load(tmp/'proof/returned-receipts.json').values())
pass_control('three captures released before two validators; five attempted jobs audited and unknown receipts retained')
for number in range(1,6):
    adapter=Adapter(fail=number);result,tmp=run_adapter(adapter)
    assert result['status']=='HOLD' and len(adapter.attempted)==len(adapter.audited)==result['nativeJobs']==number
    assert result['primaryFailure']['message']=='allocation/start fixture'
    pass_control('attempt '+str(number)+' failure prevents later dispatch and stays in terminal accounting')
for mode in ['release','audit']:
    adapter=Adapter(bad_release=mode=='release',bad_audit=mode=='audit');result,tmp=run_adapter(adapter)
    assert result['status']=='HOLD' and len(adapter.audited)==len(adapter.attempted)
    if mode=='release':assert len(adapter.attempted)==1
    else:assert len(result['terminalAuditFailures'])>=5
    pass_control(mode+' failure holds unit without erasing attempts')
for mode in ['attempts','returned','sequence']:
    def writer(p,value):
        if p.name=={'attempts':'attempts.json','returned':'returned-receipts.json','sequence':'sequence-state.json'}[mode]:raise OSError(mode+' persistence fixture')
        caller.write(p,value)
    adapter=Adapter();result,tmp=run_adapter(adapter,writer)
    assert result['status']=='HOLD' and result['nativeJobs']==len(adapter.audited)==1
    assert len(adapter.attempted)==(0 if mode=='attempts' else 1)
    pass_control(mode+' persistence failure stops later jobs and audits registered attempt')
# Exercise the real StationAdapter allocation/constructor/start/drain bodies with inert OS facts.
from types import SimpleNamespace
for fault in [None,'allocation','constructor-before-boundary','constructor-after-boundary','start','wait','drain','archive','cache','registration']:
    tmp=Path(tempfile.mkdtemp(prefix='t02-owned-pure-')).resolve();events=[]
    local={**ready,'packetRoot':str(tmp/'packet'),'proofRoot':str(tmp/'proof'),
           'tsxImport':'/source-control/tsx','process_binary_sha256':{}}
    (tmp/'packet').mkdir();(tmp/'proof').mkdir()
    @contextmanager
    def deadline(seconds):yield
    def allocate(path):
        events.append('allocation')
        private=path.parent/'private';private.mkdir()
        if fault=='allocation':
            error=RuntimeError('allocation');error.private_tmp_allocation={'path':str(private)};raise error
        return private,{'synthetic':True}
    class Job:
        def __init__(self,out,argv,root,**kwargs):
            events.append('constructor');self.out=out;self.out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir()
            self.target='synthetic-job';self.known={};self.state={'exits':{'capture':0,'caffeinate':0}}
            if fault=='constructor-before-boundary':raise RuntimeError('constructor-before-boundary')
            self.coalition_id=123
            if fault=='constructor-after-boundary':raise RuntimeError('constructor-after-boundary')
        def save(self):pass
        def start(self):
            events.append('start')
            if fault=='start':raise RuntimeError('start')
        def wait(self,seconds,observe):
            events.append('wait');observe()
            if fault=='wait':raise RuntimeError('wait')
            return 'completed'
        def members(self):return []
        def drain(self,seconds):
            events.append('drain')
            if fault=='drain':raise RuntimeError('drain')
            return {'drained':True,'clean':True}
        def archive(self,**kwargs):
            events.append('archive')
            if fault=='archive':raise RuntimeError('archive')
            self.scratch.rmdir();save(self.out/'profile_release.json',{'all_absent':True})
    def preserve(private,admission,out,**kwargs):
        events.append('cache')
        if fault=='cache':raise RuntimeError('cache')
        private.rmdir();return {'all_bytes_preserved':True,'namespace_removed':True}
    adapter=caller.StationAdapter.__new__(caller.StationAdapter);adapter.ready=local;adapter.grant={'authorizationId':'synthetic'}
    adapter.core=SimpleNamespace(deadline=deadline,StationJob=Job,coalition_members=lambda _:[],kernel_tasks=lambda _:dict(live=0,coalition_absent=True),identity=lambda _:None)
    adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=preserve,executable_path=refuse)
    adapter.support=SimpleNamespace(StageReceipts=lambda *args:SimpleNamespace(observe=lambda:None,require_browser=lambda:None))
    handle=dict(job=None,private=None,path=c.paths(local['packetRoot'],local['proofRoot'],ready['jobs'][0])['receipt'])
    with patch.object(subprocess,'run',lambda *a,**k:SimpleNamespace(returncode=0 if fault=='registration' else 1,stdout='',stderr='')):
        receipt=adapter.run(ready['jobs'][0],handle)
        if fault is None:
            caller.require_release(receipt);assert adapter.audit(handle)['releaseProved']
        else:
            rejects('real adapter release refusal '+fault,lambda:caller.require_release(receipt))
            assert receipt['primaryFailure'] is not None or receipt['cleanupFailure'] is not None
    assert Path(handle['path']).is_file() and load(handle['path'])==receipt
    if fault=='allocation':assert receipt['primaryFailure']['details']['private_tmp_allocation']['path'].endswith('/private')
    if fault in ['constructor-after-boundary','start','wait']:assert 'drain' in events
    pass_control('real adapter attempt preserved '+str(fault))

rejects('disabled native adapter before helper imports',lambda:caller.StationAdapter(ready,{}))
with patch.object(sys,'argv',['caller.py','--execute']):rejects('disabled caller entry zero jobs',caller.main)
assert not native_calls and not any(x in sys.modules for x in ['round4_job_boundary','round4_capture_children','run_round4_browser_proof','run_round4_remaining8'])
pass_control('all pure controls complete with zero native child calls and zero native helper imports')
save(HERE/'pure-python-controls.json',dict(status='PASS_SYNTHETIC_SOURCE_CONTROLS_NO_NATIVE_JOBS',nativeCalls=0,syntheticNotCaptureEvidence=True,controls=controls))
print(json.dumps(dict(status='PASS',controls=len(controls),nativeCalls=0)))
