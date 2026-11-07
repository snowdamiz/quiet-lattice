"""Source-only boundary controls: small PNGs, temporary Git, inert StationJobs, real alarms."""
import sys
sys.dont_write_bytecode=True
import argparse, ast, contextlib, copy, importlib.util, io, json, os, signal, struct, subprocess, tempfile, time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import caller, contract, native189 as native, native189_producer as producer, resource_admission as resources
import release_accounting

RESULTS=[]
ROOT=Path(tempfile.mkdtemp(prefix='t02-native189-controls-',dir='/tmp')).resolve()
READY=json.loads(caller.READY.read_text())
PLAN=json.loads(native.PLAN.read_text())

def case(name, fn):
    try:details=fn();RESULTS.append(dict(name=name,status='PASS',details=details))
    except BaseException as error:
        RESULTS.append(dict(name=name,status='FAIL',error=caller.error_receipt(error)));raise

def refused(fn):
    try:fn()
    except BaseException as error:return caller.error_receipt(error)
    raise AssertionError('Expected refusal')

def retained():
    path=contract.HERE/'retained-station/round4_job_boundary.py'
    tree=ast.parse(path.read_text(),filename=str(path))
    tree.body=[n for n in tree.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children']
    values=dict(__name__='inert_exact_helper',__file__=str(path),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError)
    exec(compile(tree,str(path),'exec'),values);return values

CORE=retained()

def png_case():
    from PIL import Image
    hashes=[]
    for i in [0,1,188]:
        png,h=producer.diagnostic(i,67,35)
        im=Image.open(io.BytesIO(png));im.load();assert im.mode=='RGBA'
        for x,y in [(0,0),(32,32),(66,34)]:assert im.getpixel((x,y))==((x+3*i)%256,(y+5*i)%256,((x//32)^(y//32)^i)&255,255)
        hashes.append(h)
    return hashes

def stream_case(mode):
    calls=[]
    def small(i):calls.append(i);return producer.diagnostic(i,2,2)
    stream=producer.DiagnosticStream(PLAN['diagnostic'],small)
    for i in range(189):
        h,p=struct.unpack('>II',stream.read(8));header=json.loads(stream.read(h));png=stream.read(p)
        assert len(png)==p and header['mediaFrameOrdinal']==i
        if mode=='backpressure' and i==0:
            failure=refused(lambda:stream.read(8));assert calls==[0];return failure
        ack=dict(schema=contract.SCHEMA,**stream.pending,width=1920,height=1080,alphaPolicy='verified-opaque255',sourcePngRetained=False)
        if mode=='bad-ack' and i==0:ack['rgbSha256']='0'*64;return refused(lambda:stream.write(json.dumps(ack)+'\n'))
        stream.write(json.dumps(ack));stream.write('\n')
    assert not stream.read(1) and len(calls)==len(stream.rows)==189
    return dict(frames=len(calls),inFlight=1,last=stream.rows[-1])

IDENTITY=dict(pid=100,birth=[11,22],uid=os.getuid(),status=1,unknown={'kept':True})

def rss_case(mode):
    facts=[];count=0
    members=[copy.deepcopy(IDENTITY),{**IDENTITY,'pid':101}]
    def identity(pid):
        nonlocal count
        count+=1
        if mode=='birth' and count==1:return {**members[0],'birth':[99,0]}
        if mode=='reuse' and count>2:return {**members[0],'birth':[99,0]}
        return next(r for r in members if r['pid']==pid)
    def read(pids):
        if mode=='timeout':time.sleep(4)
        if mode=='empty-error':raise RuntimeError()
        if mode=='unreadable':
            e=subprocess.TimeoutExpired(['inert-ps'],2,output=b'partial\xff');e.unknown={'kept':7};raise e
        return dict(bytesByPid={p:(resources.RSS_LIMIT//2+(1 if mode=='excess' else 0)) for p in pids},unknownRSS=[None,False,9])
    core=SimpleNamespace(identity=identity,deadline=CORE['deadline'],kernel_tasks=lambda _:dict(live=3 if mode=='kernel' else 2,unknownKernel=7))
    job=SimpleNamespace(coalition_id=123,members=lambda:members if mode!='cohort-drift' or count<4 else members[:1])
    guard=resources.CohortRSS(core,facts,read=read,cancel=lambda:mode=='cancel')
    if mode=='happy':guard.observe(job);assert facts[0]['aggregateBytes']==resources.RSS_LIMIT
    else:
        failure=refused(lambda:guard.observe(job));assert 'failure' in facts[0]
        assert failure==facts[0]['failure']
    assert signal.getitimer(signal.ITIMER_REAL)[0]==0
    return facts

def cache_case(mode):
    root=ROOT/('cache-'+mode);root.mkdir();cache=root/'cache';cache.mkdir();(cache/'preexisting').write_bytes(b'KEEP\x00\xff')
    before=resources.tree(cache);facts=[];calls=0
    def owners(paths,checkout):
        nonlocal calls
        calls+=1
        if mode=='race' and calls==1:(cache/'race').write_text('unknown')
        if mode=='timeout':time.sleep(2)
        if mode=='unknown':return dict(owners=[dict(before=IDENTITY,after=IDENTITY,path=str(cache/'preexisting'),unknown=9)])
        if mode=='owner-reuse':return dict(owners=[dict(before=IDENTITY,after={**IDENTITY,'birth':[2,3]},path=str(cache))])
        return dict(owners=[],rawUnknown={'retained':True})
    lease=resources.CacheLease([cache],root,root/'lock',root/'archive',facts,owners)
    if mode=='symlink':(cache/'link').symlink_to(cache/'preexisting')
    if mode=='existing-lock':(root/'lock').mkdir()
    if mode in ['happy','three-stages']:
        lease.acquire();(cache/'generated').write_bytes(b'NEW');result=lease.finish()
        assert result['cachesRetainedInPlace'] and (cache/'preexisting').read_bytes()==b'KEEP\x00\xff'
        assert (root/'archive/before/0/preexisting').read_bytes()==b'KEEP\x00\xff'
        assert (root/'archive/after/0/generated').read_bytes()==b'NEW' and (root/'lock').exists()
        if mode=='three-stages':
            for ordinal in [2,3]:
                lease.archive=root/('archive-'+str(ordinal));lease.acquire();lease.finish()
            assert not lease.active and (root/'lock').exists()
            other=resources.CacheLease([cache],root,root/'lock',root/'foreign-archive',[],owners)
            refused(other.acquire);assert not (root/'foreign-archive').exists()
    elif mode=='lock-reuse':
        lease.acquire();(root/'lock').rename(root/'original-lock');(root/'lock').mkdir()
        refused(lease.finish);assert (root/'lock').exists() and (root/'original-lock').exists()
    elif mode=='timeout':
        with CORE['deadline'](.1):failure=refused(lease.acquire)
        assert failure['type']=='DeadlineExpired' and not (root/'archive').exists()
    else:refused(lease.acquire)
    assert (cache/'preexisting').read_bytes()==b'KEEP\x00\xff'
    return dict(initial=before,observations=facts,remaining=refused(lambda:resources.tree(cache)) if mode=='symlink' else resources.tree(cache))


def git_sequence(mode):
    root=ROOT/('git-'+mode);root.mkdir();repo=root/'checkout';repo.mkdir()
    def git(*args):return subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True,check=True,timeout=5).stdout
    git('init','-q');git('config','user.email','cpu@test.invalid');git('config','user.name','CPU fixture')
    (repo/'source').write_text('source');git('add','source');git('commit','-qm','source')
    consumed=native.git_head(repo)
    output=repo/'generated' if mode=='red-in-repo' else root/'external-output';output.mkdir();(output/'frame-map.json').write_text('{}')
    if mode=='unknown':(repo/'unknown').write_text('do not hide')
    if mode=='committed-output':git('commit','--allow-empty','-qm','changed head')
    if mode in ['red-in-repo','unknown']:
        failure=refused(lambda:native.git_head(repo));assert 'clean' in failure['message'];return dict(consumedHead=consumed,refusal=failure,outputRetained=output.exists())
    current=native.git_head(repo)
    if mode=='committed-output':assert current!=consumed
    else:assert current==consumed
    return dict(consumedHead=consumed,consumerHead=current,outputRetained=output.exists())


def sequence(mode):
    root=ROOT/('sequence-'+mode);root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir()
    local={**READY,'captureSeconds':.15,'cleanupSeconds':.15,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof')}
    plan={**PLAN,'runRoot':str(root),'consumedPath':str(root/'consumed.json'),'cancelPath':str(root/'cancel.json')}
    (root/'consumed.json').write_text(json.dumps({'authorizationId':'inert'}))
    starts=[];events=[];handles=[]
    error=RuntimeError() if mode=='empty-error' else RuntimeError('ORIGINAL_START_FAILURE')
    error.unknown={'keep':77}
    class Job:
        def __init__(self,out,*args,**kwargs):
            self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.target='inert';self.coalition_id=123;self.known={};self.state=dict(exits={'capture':0},errors=[])
        def save(self):pass
        def start(self):
            starts.append(self.out.parent.name)
            if mode in ['primary','empty-error','all-sinks','all-files','cli-all-sinks','after-bytes']:raise error
        def members(self):return [IDENTITY]
        def status(self):return {'exits':{}}
        def wait(self,seconds,observer):
            if mode=='rss-normalized':return CORE['StationJob'].wait(self,seconds,observer)
            if mode=='rss-timed':
                with CORE['deadline'](.05):observer()
            elif mode in ['rss-excess','cancel']:observer()
            return 'completed'
        def drain(self,seconds):
            events.append('drain')
            if mode=='cleanup-timeout':time.sleep(1)
            return dict(drained=True,clean=True,rawUnknown={'drain':87})
        def archive(self,**kwargs):
            events.append('archive');self.scratch.rmdir();caller.write(self.out/'profile_release.json',dict(all_absent=True,unknown=91))
    def allocate(path):
        p=path.parent/'private';p.mkdir();return p,dict(path=str(p),rawUnknown=8)
    def preserve(p,*args,**kwargs):p.rmdir();events.append('tmp-release');return dict(all_bytes_preserved=True,namespace_removed=True,unknown=71)
    adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=local;adapter.plan=plan;adapter.grant={'authorizationId':'inert'}
    kernel_calls=0
    def kernel(_):return dict(live=0,coalition_absent=True,unknownKernel={'retained':42})
    adapter.core=SimpleNamespace(StationJob=Job,deadline=CORE['deadline'],kernel_tasks=kernel,coalition_members=lambda _:[],identity=lambda _:None)
    adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=preserve,executable_path=lambda _:'/inert')
    adapter.inspect_native=lambda:None
    actual_run=adapter.run
    def run(definition,handle):handles.append(handle);return actual_run(definition,handle)
    adapter.run=run
    if mode not in ['rss-timed','rss-excess','rss-normalized','cancel']:adapter.resource_observer=lambda *args:None
    else:
        def observer(job,receipt):
            core=SimpleNamespace(deadline=CORE['deadline'],kernel_tasks=lambda _:dict(live=1),identity=lambda _:IDENTITY)
            reads=0
            def read(pids):
                nonlocal reads
                reads+=1
                if mode=='rss-timed':time.sleep(1)
                if mode=='rss-normalized' and reads>1:
                    failure=subprocess.TimeoutExpired(['inert-ps'],2,output=b'partial\xff');failure.unknown={'keep':91};raise failure
                return dict(bytesByPid={100:1 if mode=='rss-normalized' else resources.RSS_LIMIT+1},rawUnknown=86)
            guard=resources.CohortRSS(core,receipt.setdefault('rssObservations',[]),read=read,cancel=lambda:mode=='cancel')
            return lambda:guard.observe(job,force=True)
        adapter.resource_observer=observer
    original_write=caller.write
    def write(path,value):
        if Path(path).name=='receipt.json' and 'ownedAllocation' in value and mode in ['all-sinks','all-files','cli-all-sinks','after-bytes']:
            if mode=='after-bytes':original_write(path,value)
            raise OSError('FINAL_RECEIPT_FAILURE')
        original_write(path,value)
    with contextlib.ExitStack() as stack:
        for port in [patch.object(caller,'write',write),patch.object(caller,'observe_executables',lambda *args,**kwargs:None),
                     patch.object(caller.subprocess,'run',lambda *args,**kwargs:SimpleNamespace(returncode=1,stdout='raw-registration',stderr=''))]:stack.enter_context(port)
        if mode in ['all-sinks','all-files','cli-all-sinks']:
            stack.enter_context(patch.object(release_accounting,'save',lambda *a:(_ for _ in ()).throw(OSError('PROOF_FAILURE'))))
        if mode in ['all-files','cli-all-sinks']:
            stack.enter_context(patch.object(release_accounting.budget,'write_json',lambda *a,**k:(_ for _ in ()).throw(OSError('PACKET_FAILURE'))))
        if mode=='cli-all-sinks':
            class BrokenStream:
                def write(self,text):raise OSError('STREAM_FAILURE')
            for port in [patch.object(native,'load',lambda path:local if path==native.READY else plan if path==native.PLAN else json.loads(Path(path).read_text())),
                         patch.object(native,'consume',lambda *a:{}),patch.object(native,'NativeAdapter',lambda *a:adapter),
                         patch.object(native,'check_current',lambda *a:None),patch.object(sys,'argv',['native189.py','--execute']),
                         patch.object(sys,'stdout',BrokenStream()),patch.object(sys,'stderr',BrokenStream())]:stack.enter_context(port)
            try:native.main()
            except caller.TerminalDeliveryError as error:result=error.result
            else:raise AssertionError('Both streams failed without retained structured result')
        else:result=native.run_sequence(local,plan,{},adapter,lambda:None,writer=write)
    if mode=='happy':assert len(starts)==2 and result['status']=='NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT'
    else:assert len(starts)==1 and result['status']=='HOLD'
    assert result['nativeJobs']==len(starts) and len(result['terminalAudit'])==len(starts)
    if mode in ['primary','empty-error','all-sinks','all-files','cli-all-sinks','after-bytes']:assert result['primaryFailure']['details']['unknown']=={'keep':77}
    if mode=='rss-normalized':assert result['primaryFailure']['type']=='TimeoutExpired' and result['primaryFailure']['details']['unknown']=={'keep':91}
    if mode=='cleanup-timeout':assert 'archive' not in events and 'tmp-release' not in events
    if mode in ['all-files','cli-all-sinks']:assert result['terminalDelivery']['completeObservationsPersisted'] is False and result['receiptFallbacks']
    if mode=='all-sinks':assert result['terminalDelivery']['packet']['status']=='written' and result['receiptFallbacks']
    assert signal.getitimer(signal.ITIMER_REAL)[0]==0
    return dict(result=result,starts=starts,events=events,receipts=[h['receipt'] for h in handles])


def grant_case(mode):
    root=ROOT/('grant-'+mode);root.mkdir();repo=root/'checkout';repo.mkdir()
    def git(*args):return subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True,check=True,timeout=5).stdout
    git('init','-q');git('config','user.email','cpu@test.invalid');git('config','user.name','CPU fixture')
    (repo/'source').write_text('fixture source')
    run=ROOT.parent/(ROOT.name+'-grant-'+mode+'-output')
    plan={**PLAN,'runRoot':str(run),'grantPath':str(run)+'-grant.json','consumedPath':str(run)+'-consumed.json','cancelPath':str(run)+'-cancel.json',
          'storage':{**PLAN['storage'],'retainedInputs':['source']}}
    ready={**READY,'root':str(repo),'helperDirectory':str(repo/'retained-station'),'nativeFixtureAuthorization':True,'runtimeAuthorization':False,
           'bindings':[dict(path=str(repo/'source'),sha256=caller.sha(repo/'source'))],'softwareBindings':[]}
    (repo/'readiness.json').write_text(json.dumps(ready));(repo/'native189-plan.json').write_text(json.dumps(plan));(repo/'candidate-index.json').write_text(json.dumps(dict(files=[])))
    git('add','.');git('commit','-qm','fixture')
    grant=dict(purpose=native.PURPOSE,nativeFixtureGo=True,captureGo=False,jobIds=native.JOBS,frames=189,authorizationId='CPU-INERT-ONLY',runRoot=str(run),expiresUnix=time.time()+300,
        head=native.git_head(repo),readinessSha256=caller.sha(repo/'readiness.json'),planSha256=caller.sha(repo/'native189-plan.json'),candidateSha256=caller.sha(repo/'candidate-index.json'))
    if mode=='wrong-purpose':grant['purpose']='CAPTURE'
    if mode=='capture-flag':grant['captureGo']=True
    if mode=='expired':grant['expiresUnix']=time.time()-1
    if mode=='order':grant['jobIds']=list(reversed(native.JOBS))
    if mode=='unknown':(repo/'unknown').write_text('keep')
    Path(plan['grantPath']).write_text(json.dumps(grant))
    with patch.object(native,'HERE',repo),patch.object(native,'READY',repo/'readiness.json'),patch.object(native,'PLAN',repo/'native189-plan.json'),patch.object(native.contract,'ROOT',repo):
        if mode in ['wrong-purpose','capture-flag','expired','order','unknown']:
            error=refused(lambda:native.consume(ready,plan,plan['grantPath']))
            assert not run.exists() and not Path(plan['consumedPath']).exists();return error
        record=native.consume(ready,plan,plan['grantPath']);assert run.is_dir()
        if mode=='reuse':return refused(lambda:native.consume(ready,plan,plan['grantPath']))
        if mode=='cancel':Path(plan['cancelPath']).write_text('{}');return refused(lambda:native.check_current(ready,plan,record))
        if mode=='head-drift':git('commit','--allow-empty','-qm','drift');return refused(lambda:native.check_current(ready,plan,record))
        if mode=='grant-drift':Path(plan['grantPath']).write_text('{}');return refused(lambda:native.check_current(ready,plan,record))
        # Actual producer writes bytes outside the repository; actual consumer checks the consumed head.
        (run/'packet/frame-map.json').write_text('{}')
        native.check_current(ready,plan,record)
        assert native.git_head(repo)==record['head']
        return dict(head=record['head'],output=str(run),launches=0)


def claim_case(mode):
    root=ROOT/('claim-'+mode);root.mkdir();(root/'owned-job').mkdir();scratch=root/'scratch';scratch.mkdir()
    parent={**IDENTITY,'pid':999};own={**IDENTITY,'pid':os.getpid(),'ppid':999}
    config=dict(consumedSha256='a'*64);file=root/'worker-config.json';file.write_text(json.dumps(config))
    caller.write(root/'owned-job/boundary.json',dict(root=parent,coalition_id=123,scratch=str(scratch)))
    caller.write(scratch/'request.json',dict(argv=[str(Path(sys.executable).resolve()),str(native.HERE/'native189_producer.py'),'encode',str(file)]))
    core=SimpleNamespace(identity=lambda pid:own if pid==os.getpid() else ({**parent,'birth':[5,9]} if mode=='root-reuse' else parent),coalition=lambda pid:[124 if mode=='foreign' else 123])
    if mode in ['root-reuse','foreign']:return refused(lambda:native.claim_worker(config,'encode',file,core))
    native.claim_worker(config,'encode',file,core)
    if mode=='reuse':return refused(lambda:native.claim_worker(config,'encode',file,core))
    return json.loads((root/'worker-entry.json').read_text())


def worker_error_case(old):
    root=ROOT/('worker-error-old' if old else 'worker-error-new');root.mkdir()
    if old:
        source=subprocess.run(['git','show','c61699dcde61ff9dee699be7e0b7d42ae06ff326:'+str((contract.HERE/'rgb-primary.py').relative_to(contract.ROOT))],capture_output=True,text=True,check=True).stdout
        module=type(sys)('old_rgb');exec(compile(source,'retained-c61699d-rgb-primary.py','exec'),module.__dict__)
    else:module=producer.worker()
    config=dict(schema=contract.SCHEMA,frameCount=189,maxVideoBytes=39354368,video=str(root/'primary.mp4'),rawLog=str(root/'raw.log'),command=str(root/'command.json'),result=str(root/'result.json'),ffmpeg='/INERT/ffmpeg')
    original=subprocess.TimeoutExpired(['inert-source'],3,output=b'partial\x00\xff',stderr=b'err\x80');original.unknown={'retain':17}
    class Source:
        def read(self,n):raise original
    actual_save=module.save
    def save(path,value):
        if str(path)==config['result']:raise OSError('RESULT_PERSISTENCE_FAILURE')
        actual_save(path,value)
    with patch.object(module,'save',save),patch.object(module.resource,'setrlimit',lambda *a:None),patch.object(module.subprocess,'Popen',lambda *a,**k:SimpleNamespace()),patch.object(sys,'stderr',io.StringIO()):
        try:module.encode(config,Source(),io.StringIO())
        except BaseException as error:
            if old:assert type(error) is OSError
            else:assert error is original and error.mediaFailure['persistenceFailures'][0]['type']=='OSError'
            return dict(legacyRed=old,escaped=caller.error_receipt(error),nativeLaunches=0)
    raise AssertionError('Worker did not fail')


def reserve_case(mode):
    plan=copy.deepcopy(PLAN);inventory={'bytes':1,'fileCount':1}
    if mode=='copies':plan['storage']['copySlots'].append('/unknown-copy')
    if mode=='archives':plan['storage']['archiveSlots'].pop()
    if mode=='retained-excess':inventory['bytes']=plan['storage']['retainedInputCeiling']+1
    free=resources.COMBINED_RESERVE-(1 if mode=='capacity' else 0)
    with patch.object(resources.shutil,'disk_usage',lambda _:SimpleNamespace(free=free)):
        if mode=='boundary':return resources.reserve(plan,inventory)
        return refused(lambda:resources.reserve(plan,inventory))


def owners_case(mode):
    identity_calls=0
    def identity(pid):
        nonlocal identity_calls
        identity_calls+=1
        return {**IDENTITY,'pid':pid,'birth':[55,66] if mode=='reuse' and identity_calls>1 else IDENTITY['birth']}
    raw=b'p100\0ccpu\0fcwd\0n/private/tmp/fixture-checkout\0\n'
    def run(argv,**kwargs):
        if argv[0]=='/bin/ps':return SimpleNamespace(stdout='100\n')
        return SimpleNamespace(returncode=0,stdout=raw,stderr=b'unknown lsof warning' if mode=='unreadable' else b'')
    with patch.object(resources.subprocess,'run',run):
        if mode=='happy':return resources.open_owners([Path('/private/tmp/cache')],Path('/private/tmp/fixture-checkout'),identity)
        error=refused(lambda:resources.open_owners([Path('/private/tmp/cache')],Path('/private/tmp/fixture-checkout'),identity))
        assert 'openFileFacts' in error['details'];return error


def surplus_case(count):
    root=ROOT/('surplus-'+str(count));root.mkdir();packet=root/'packet';packet.mkdir();out=packet/'inspection';out.mkdir();raw=root/'raw';raw.mkdir()
    video=packet/'primary.mp4';video.write_bytes(b'INERT MEDIA')
    rows=[dict(workId=str(i),mediaFrameOrdinal=i,mediaPts=i*1000,mediaTimeBase='1/60000',rgbSha256='f'*64,rgbaSha256='a'*64) for i in range(189)]
    mapping=packet/'frame-map.json';mapping.write_text(json.dumps(dict(schema=contract.SCHEMA,frames=rows)))
    config=dict(schema=contract.SCHEMA,frameCount=189,maxVideoBytes=39354368,video=str(video),frameMap=str(mapping),packetRoot=str(packet),output=str(out),nativeRawDirectory=str(raw),helperDirectory=str(contract.HERE/'retained-station'),ffmpeg='/INERT/ffmpeg')
    module=producer.worker();calls=[]
    def child(argv,stdout,stderr):
        calls.append(argv)
        assert argv[argv.index('-frames:v')+1]=='190' and argv[argv.index('-stream_loop')+1]=='1'
        text='#tb 0: 1/60\n'+''.join(f'0, {i}, {i}, 1, {1920*1080*3}, '+('f'*64)+'\n' for i in range(count))
        stdout.write(text.encode());stdout.flush();return SimpleNamespace(wait=lambda:0)
    with patch.object(producer,'worker',lambda:module),patch.object(module,'validate',lambda _:None),patch.dict(sys.modules,{'round4_job_boundary':SimpleNamespace(deadline=CORE['deadline'])}),patch.object(producer.subprocess,'Popen',child):
        if count==190:producer.validate(config);assert json.loads((out/'surplus-refusal.json').read_text())['expectedRefusal'] is True
        else:refused(lambda:producer.validate(config));assert not (out/'surplus-refusal.json').exists()
    assert len(calls)==1 and signal.getitimer(signal.ITIMER_REAL)[0]==0
    return dict(argv=calls,decodedFrames=count,realNativeCalls=0)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args()
    try:
        case('small diagnostic exact pixels/alpha',png_case)
        for mode in ['happy','backpressure','bad-ack']:case('producer '+mode,lambda mode=mode:stream_case(mode))
        for mode in ['happy','birth','reuse','cohort-drift','kernel','excess','unreadable','empty-error','cancel','timeout']:case('cohort RSS '+mode,lambda mode=mode:rss_case(mode))
        for mode in ['happy','three-stages','unknown','owner-reuse','race','symlink','existing-lock','lock-reuse','timeout']:case('cache '+mode,lambda mode=mode:cache_case(mode))
        for mode in ['red-in-repo','external','unknown','committed-output']:case('fresh TEMP GIT '+mode,lambda mode=mode:git_sequence(mode))
        for mode in ['happy','primary','empty-error','all-sinks','all-files','cli-all-sinks','after-bytes','rss-timed','rss-excess','rss-normalized','cancel','cleanup-timeout']:case('actual dispatcher adapter '+mode,lambda mode=mode:sequence(mode))
        for mode in ['happy','reuse','cancel','head-drift','grant-drift','wrong-purpose','capture-flag','expired','order','unknown']:case('actual grant consumer '+mode,lambda mode=mode:grant_case(mode))
        for mode in ['happy','reuse','root-reuse','foreign']:case('owned worker claim '+mode,lambda mode=mode:claim_case(mode))
        for old in [True,False]:case('worker primary persistence '+('RED c61699d' if old else 'GREEN current'),lambda old=old:worker_error_case(old))
        for mode in ['boundary','copies','archives','retained-excess','capacity']:case('reserve '+mode,lambda mode=mode:reserve_case(mode))
        for mode in ['happy','reuse','unreadable']:case('OS cache collector '+mode,lambda mode=mode:owners_case(mode))
        for count in [189,190]:case('actual surplus validator '+str(count),lambda count=count:surplus_case(count))
        for mode in ['runner','producer','runner-optimized','producer-optimized']:

            def disabled(mode=mode):
                argv=[sys.executable,'-B',*(['-O'] if 'optimized' in mode else []),str(contract.HERE/('native189.py' if mode.startswith('runner') else 'native189_producer.py'))]
                argv+=['--execute','--grant','/does-not-exist'] if mode.startswith('runner') else ['encode','/does-not-exist']
                result=subprocess.run(argv,capture_output=True,text=True,timeout=10)
                assert result.returncode==1 and ('T02_ASSERTIONS_REQUIRED' if 'optimized' in mode else 'NATIVE189_DISABLED') in result.stderr
                assert not Path(PLAN['runRoot']).exists() and not Path(PLAN['consumedPath']).exists()
                return dict(argv=argv,exitCode=result.returncode,stderr=result.stderr)
            case('disabled actual CLI '+mode,disabled)
    finally:
        with args.report.open('x') as f:json.dump(dict(status='PASS' if all(r['status']=='PASS' for r in RESULTS) else 'FAIL',count=len(RESULTS),scratch=str(ROOT),controls=RESULTS),f,indent=2)
    print(json.dumps(dict(status='PASS',controls=len(RESULTS),scratch=str(ROOT))))
if __name__=='__main__':main()
