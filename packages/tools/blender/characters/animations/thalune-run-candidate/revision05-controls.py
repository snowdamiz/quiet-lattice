"""Actual resource/caller crossings and bounded filesystem boundaries, CPU only."""
import sys
sys.dont_write_bytecode=True
import argparse,ast,copy,contextlib,hashlib,io,json,os,signal,stat,subprocess,tempfile,time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);parser.add_argument('--source',type=Path);parser.add_argument('--ordering-only',action='store_true');parser.add_argument('--expect-red',action='store_true');args=parser.parse_args()
A=(args.source or Path(__file__).parent).resolve();sys.path.insert(0,str(A))
import native189 as native,caller,resource_admission as resources,release_accounting as accounting
ROOT=Path(tempfile.mkdtemp(prefix='t02-r5-controls-',dir='/tmp')).resolve()
READY=json.loads((A/'readiness.json').read_text());PLAN=json.loads((A/'native189-plan.json').read_text());RESULTS=[]
path=A/'retained-station/round4_job_boundary.py';nodes=ast.parse(path.read_text());nodes.body=[n for n in nodes.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='inert_exact',__file__=str(path),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(nodes,str(path),'exec'),core)
IDENTITY=dict(pid=100,birth=[11,22],uid=os.getuid(),status=1,ppid=99,pgid=100,unknownIdentity={'raw':[False,None,9]})

def refuse(fn):
    try:fn()
    except BaseException as error:return error
    raise AssertionError('Expected boundary refusal')

def case(name,fn):
    result=fn();RESULTS.append(dict(name=name,status='PASS_EXPECTED_RED' if args.expect_red else 'PASS',details=result))
    print(name,flush=True)


def ordering(kind,crossing,delivery):
    root=ROOT/(kind+'-'+crossing+'-'+delivery);root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir();events=[];handles=[];reads=0;originals=[]
    local={**READY,'captureSeconds':4,'cleanupSeconds':1,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof')};plan={**PLAN,'runRoot':str(root)}
    class State(dict):
        def __getitem__(self,key):
            if crossing=='exits-read' and key=='exits' and reads>=2:
                error=OSError('POST_WAIT_EXITS_READ_FAILURE');error.unknownRead={'keep':23};raise error
            return super().__getitem__(key)
    class Job:
        def __init__(self,out,*a,**k):
            self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.coalition_id=123;self.target='inert';self.known={};self.state=State(exits={},errors=[])
        def save(self):pass
        def start(self):events.append('start')
        def status(self):return {}
        def members(self):return [copy.deepcopy(IDENTITY)]
        wait=core['StationJob'].wait
        def drain(self,*a):events.append('drain');return dict(drained=True,clean=True,unknownDrain={'raw':41})
        def archive(self,**k):events.append('archive');self.scratch.rmdir();caller.write(self.out/'profile_release.json',dict(all_absent=True,unknownProfiles=[None,42]))
    def allocate(path):p=path.parent/'private';p.mkdir();return p,{'unknownAllocation':['keep',None]}
    def release(p,*a,**k):events.append('private-release');p.rmdir();return dict(all_bytes_preserved=True,namespace_removed=True,unknownRelease=[True,False])
    adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=local;adapter.plan=plan;adapter.grant={'authorizationId':'CPU-INERT'}
    adapter.core=SimpleNamespace(StationJob=Job,deadline=core['deadline'],kernel_tasks=lambda _:dict(live=0,coalition_absent=True,unknownKernel='keep'),coalition_members=lambda _:[],identity=lambda _:None)
    adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=release,executable_path=lambda _:'/inert')
    def prepare(definition,out,paths,receipt):
        if crossing in ['worker-read','worker-failure']:
            raw=Path(paths['raw']);raw.mkdir()
            (raw/'producer-failure.json').write_text('{' if crossing=='worker-read' else json.dumps(dict(primaryFailure=dict(type='SECOND_WORKER',message='second',unknown={'keep':21}))))
        return ['/INERT']
    adapter.prepare=prepare;adapter.inspect_native=lambda:None
    def observer(job,receipt):
        def read(pids):
            nonlocal reads
            reads+=1
            if reads==1:return dict(bytesByPid={100:1},unknownFirst={'raw':11})
            if kind=='timeout':
                error=subprocess.TimeoutExpired(['inert-rss'],2,output=b'PARTIAL\x00\xff',stderr=b'ERR\x80');error.unknown={'keep':17};originals.append(error);raise error
            if kind=='deadline':time.sleep(10)
            if kind=='missing':return dict(bytesByPid={},unknownMissing=['keep',None])
            return dict(bytesByPid={100:resources.RSS_LIMIT+1},unknownExcess={'raw':19})
        guard=resources.CohortRSS(SimpleNamespace(deadline=core['deadline'],identity=lambda _:copy.deepcopy(IDENTITY),kernel_tasks=lambda _:dict(live=1,unknownKernelRSS=18)),receipt.setdefault('rssObservations',[]),read=read)
        return lambda:guard.observe(job,force=True)
    adapter.resource_observer=observer;actual_run=adapter.run
    def run(definition,handle):handles.append(handle);return actual_run(definition,handle)
    adapter.run=run;actual_write=caller.write
    def writer(path,value):
        path=Path(path)
        if crossing=='post-write' and path.name=='receipt.json' and 'outcome' in value and 'ownedAllocation' not in value:raise OSError('POST_WAIT_RECEIPT_FAILURE')
        if delivery!='normal' and ((path.name=='receipt.json' and 'ownedAllocation' in value) or path.name=='returned-receipts.json'):raise OSError('ADDITIONAL_PROOF_WRITE_FAILURE')
        return actual_write(path,value)
    class BrokenStream:
        def write(self,text):raise OSError('TERMINAL_STREAM_FAILURE')
    with contextlib.ExitStack() as stack:
        for port in [patch.object(caller,'write',writer),patch.object(caller,'observe_executables',lambda *a,**k:None),patch.object(caller.subprocess,'run',lambda *a,**k:SimpleNamespace(returncode=1,stdout='raw registration',stderr='raw registration error'))]:stack.enter_context(port)
        if delivery!='normal':stack.enter_context(patch.object(accounting,'save',lambda *a:(_ for _ in ()).throw(OSError('TERMINAL_PROOF_FAILURE'))))
        if delivery in ['all-files','all-sinks']:stack.enter_context(patch.object(accounting.budget,'write_json',lambda *a,**k:(_ for _ in ()).throw(OSError('TERMINAL_PACKET_FAILURE'))))
        if delivery=='all-sinks':
            actual_load=native.load
            for port in [patch.object(native,'load',lambda p:local if p==native.READY else plan if p==native.PLAN else actual_load(p)),patch.object(native,'consume',lambda *a:{}),patch.object(native,'NativeAdapter',lambda *a:adapter),patch.object(native,'check_current',lambda *a:None),patch.object(sys,'argv',['native189.py','--execute']),patch.object(sys,'stdout',BrokenStream()),patch.object(sys,'stderr',BrokenStream())]:stack.enter_context(port)
            error=refuse(native.main);assert isinstance(error,caller.TerminalDeliveryError);result=error.result
        else:result=native.run_sequence(local,plan,{},adapter,lambda:None,writer=writer)
    receipt=handles[0]['receipt'];original=receipt['resourceFailures'][0]
    assert events.count('start')==1 and result['status']=='HOLD' and result['nativeJobs']==1
    assert signal.getitimer(signal.ITIMER_REAL)[0]==0 and events.count('drain')==1 and events.count('archive')==1
    if args.expect_red and crossing!='none':assert result['primaryFailure'] is not original
    else:
        assert result['primaryFailure'] is receipt['primaryFailure'] is original
        if crossing=='post-write':assert any(x['message']=='POST_WAIT_RECEIPT_FAILURE' for x in receipt['secondaryFailures'])
        if crossing=='exits-read':assert receipt['secondaryFailures'][0]['details']['unknownRead']=={'keep':23}
        if crossing=='worker-read':assert receipt['secondaryFailures'][0]['type']=='JSONDecodeError'
        if crossing=='worker-failure':assert receipt['secondaryFailures'][0]['unknown']=={'keep':21}
    if kind=='timeout':assert original['details']['output']==str(originals[0].output) and original['details']['stderr']==str(originals[0].stderr) and original['details']['unknown']=={'keep':17}
    assert receipt['rssObservations'][0]['rss']['unknownFirst']=={'raw':11}
    if delivery=='packet-fallback':assert result['terminalDelivery']['packet']['status']=='written'
    if delivery in ['all-files','all-sinks']:assert result['terminalDelivery']['completeObservationsPersisted'] is False and result['receiptFallbacks']
    return dict(original=original,primaryIsOriginal=result['primaryFailure'] is original,result=result,receipt=receipt,events=events)


class IOTrace:
    def __init__(self):self.reads=[];self.opens={};self.closed=[];self.directoryEntries=0
    def install(self,stack,before_open=lambda p,f:None,after_read=lambda fd,b:None,before_read=lambda fd:None,after_close=lambda fd:None,before_entry=lambda:None):
        real_open,real_read,real_close,real_scandir=resources.os.open,resources.os.read,resources.os.close,resources.os.scandir
        def opened(path,flags,*a,**k):
            before_open(path,flags)
            fd=real_open(path,flags,*a,**k);self.opens[fd]=str(path);return fd
        def read(fd,n):
            before_read(fd);data=real_read(fd,n);self.reads.append(dict(path=self.opens.get(fd),requested=n,returned=len(data)));after_read(fd,data);return data
        def close(fd):real_close(fd);self.closed.append(fd);after_close(fd)
        class Entries:
            def __init__(inner,fd):inner.iterator=real_scandir(fd)
            def __enter__(inner):return inner
            def __exit__(inner,*a):inner.iterator.close()
            def __iter__(inner):return inner
            def __next__(inner):
                before_entry();entry=next(inner.iterator);self.directoryEntries+=1;return entry
        for port in [patch.object(resources.os,'open',opened),patch.object(resources.os,'read',read),patch.object(resources.os,'close',close),patch.object(resources.os,'scandir',Entries)]:stack.enter_context(port)
    def summary(self):
        for fd in self.opens:
            try:os.fstat(fd)
            except OSError:pass
            else:raise AssertionError('Descriptor leaked')
        return dict(readBytes=sum(r['returned'] for r in self.reads),reads=self.reads,openedDescriptors=len(self.opens),closeCalls=len(self.closed),directoryEntries=self.directoryEntries)


def cache_boundary(mode):
    root=ROOT/('cache-'+mode);root.mkdir();cache=root/'cache';cache.mkdir();file=cache/'data';file.write_bytes(b'abcdefgh')
    observations=[];trace=IOTrace();fired=False;error=None
    lease=resources.CacheLease([cache],root,root/'lock',root/'archive',observations,lambda *a:dict(owners=[],unknownOwner={'kept':23}))
    if mode in ['limit','over-limit']:
        with file.open('wb') as f:f.truncate(resources.CACHE_BYTES+(mode=='over-limit'))
    if mode in ['entries4096','entries4097']:
        file.unlink()
        for i in range(4095+(mode=='entries4097')*101):(cache/str(i)).touch()
    if mode=='symlink':(cache/'link').symlink_to(file)
    if mode=='fifo':file.unlink();os.mkfifo(file)
    def before_open(path,flags):
        nonlocal fired
        if Path(path)!=file or flags & os.O_DIRECTORY or fired or mode not in ['replace-fifo','replace-link','replace-regular']:return
        fired=True
        if mode=='replace-fifo':file.rename(cache/'original');os.mkfifo(file)
        if mode=='replace-link':file.rename(cache/'original');file.symlink_to(cache/'original')
        if mode=='replace-regular':file.rename(cache/'original');file.write_bytes(b'abcdefgh')
    def after_read(fd,data):
        nonlocal fired
        if not data or fired or trace.opens.get(fd)!=str(file):return
        fired=True
        if mode=='growth':
            with file.open('ab') as f:f.write(b'EXTRA')
        if mode=='truncate':
            with file.open('wb') as f:f.write(b'a')
        if mode=='replace-after-read':file.rename(cache/'original');file.write_bytes(b'ABCDEFGH')
    def before_read(fd):
        if trace.opens.get(fd)!=str(file):return
        if mode=='deadline':time.sleep(.2)
        if mode=='cancel':raise KeyboardInterrupt()
        if mode in ['read-error','read-and-close-error']:
            error=subprocess.TimeoutExpired(['inert-cache-read'],1,output=b'PARTIAL\xff',stderr=b'ERR\x80');error.unknown={'keep':[None,False,77]};raise error
    def after_close(fd):
        if trace.opens.get(fd)==str(file) and mode in ['close-error','read-and-close-error']:raise OSError('DESCRIPTOR_CLOSE_FAILURE')
    with contextlib.ExitStack() as stack:
        trace.install(stack,before_open,after_read,before_read,after_close)
        if mode=='deadline':stack.enter_context(core['deadline'](.03))
        elif mode in ['fifo','replace-fifo']:stack.enter_context(core['deadline'](.25))
        if mode=='limit':rows=resources.tree(cache);assert len(rows)==2
        elif mode=='entries4096':
            facts={};rows=resources.inventory([cache],facts);assert len(rows[0])==4096
        else:error=refuse(lease.check)
    summary=trace.summary()
    if mode in ['over-limit','entries4097','symlink','fifo','replace-fifo','replace-link','replace-regular']:assert summary['readBytes']==0
    if mode in ['fifo','replace-fifo']:assert not isinstance(error,core['DeadlineExpired'])
    if mode=='limit':assert summary['readBytes']==resources.CACHE_BYTES
    if mode=='growth':assert summary['readBytes']==9
    if mode=='entries4097':assert summary['directoryEntries']==4096 and error.cacheInventory['entriesSeen']==4097
    if mode in ['read-error','read-and-close-error']:assert isinstance(error,subprocess.TimeoutExpired) and error.unknown=={'keep':[None,False,77]}
    if mode=='read-and-close-error':assert error.descriptorCloseFailures[0]['message']=='DESCRIPTOR_CLOSE_FAILURE'
    assert signal.getitimer(signal.ITIMER_REAL)[0]==0 and cache.exists()
    # Full failure observations live in a dedicated fixture report; summaries do not truncate them.
    proof=root/'observations.json';proof.write_text(json.dumps(observations,indent=2))
    return dict(mode=mode,trace=summary,error=None if error is None else dict(type=type(error).__name__,message=str(error)),proof=str(proof),proofSha256=hashlib.sha256(proof.read_bytes()).hexdigest(),cacheRetained=True)


def copy_boundary(mode):
    root=ROOT/('copy-'+mode);root.mkdir();cache=root/'cache';cache.mkdir();file=cache/'data';file.write_bytes(b'abcdefgh')
    observations=[];lease=resources.CacheLease([cache],root,root/'lock',root/'archive',observations,lambda *a:dict(owners=[],unknownOwner=[None,99]))
    lease.acquire();before=file.read_bytes();trace=IOTrace();fired=False
    def before_open(path,flags):
        nonlocal fired
        if Path(path)==file and not flags & os.O_DIRECTORY and not fired and mode in ['fifo','replace']:
            fired=True
            if mode=='fifo':file.rename(cache/'original');os.mkfifo(file)
            if mode=='replace':file.rename(cache/'original');file.write_bytes(b'ABCDEFGH')
    def before_read(fd):
        if trace.opens.get(fd)!=str(file):return
        if mode=='cancel':raise KeyboardInterrupt()
        if mode=='deadline':time.sleep(.2)
        if mode=='read-error':
            e=OSError('COPY_READ_FAILURE');e.unknown={'allocation':['keep',None]};raise e
    def after_read(fd,data):
        nonlocal fired
        if mode=='growth' and data and not fired:
            fired=True
            with file.open('ab') as f:f.write(b'EXTRA')
    if mode=='precopy-growth':
        with file.open('ab') as f:f.write(b'EXTRA')
    with contextlib.ExitStack() as stack:
        trace.install(stack,before_open,after_read,before_read)
        if mode=='deadline':stack.enter_context(core['deadline'](.03))
        elif mode in ['fifo','replace-fifo']:stack.enter_context(core['deadline'](.25))
        if mode=='happy':lease.copy('tested',lease.initial);error=None
        else:error=refuse(lambda:lease.copy('tested',lease.initial))
    summary=trace.summary();assert (root/'lock').exists() and (root/'archive/before/0/data').read_bytes()==before
    if mode in ['precopy-growth','fifo','replace']:assert summary['readBytes']==0
    if mode=='precopy-growth':assert not (root/'archive/tested').exists()
    else:assert (root/'archive/tested').exists()
    if mode=='happy':assert (root/'archive/tested/0/data').read_bytes()==before
    if mode=='growth':assert summary['readBytes']==9
    if mode=='read-error':assert error.unknown=={'allocation':['keep',None]}
    assert signal.getitimer(signal.ITIMER_REAL)[0]==0
    return dict(trace=summary,error=None if error is None else caller.error_receipt(error),observations=observations,spentLeaseRetained=True,partialCopyRetained=True)

def aggregate_or_scan(mode):
    root=ROOT/('aggregate-'+mode);root.mkdir();first=root/'first';first.mkdir();second=root/'second';second.mkdir()
    if mode=='bytes':
        with (first/'large').open('wb') as f:f.truncate(resources.CACHE_BYTES)
        (second/'extra').write_bytes(b'x')
    elif mode=='entries':
        for i in range(4095):(first/str(i)).touch()
    else:(first/'data').write_bytes(b'known')
    trace=IOTrace();observations=[];owners=[]
    def owner(*a):owners.append(True);return dict(owners=[])
    lease=resources.CacheLease([first,second],root,root/'lock',root/'archive',observations,owner)
    def entry():
        if mode=='scan-cancel':raise KeyboardInterrupt()
        if mode=='scan-deadline':time.sleep(.2)
        if mode=='scan-error':
            e=OSError('ENUMERATION_FAILURE');e.unknown={'raw':[None,55]};raise e
    with contextlib.ExitStack() as stack:
        trace.install(stack,before_entry=entry)
        if mode=='scan-deadline':stack.enter_context(core['deadline'](.03))
        error=refuse(lease.check)
    summary=trace.summary();assert summary['readBytes']==0 and not owners
    if mode=='entries':assert error.cacheInventory['entriesSeen']==4097
    if mode=='scan-error':assert error.unknown=={'raw':[None,55]}
    assert signal.getitimer(signal.ITIMER_REAL)[0]==0
    proof=root/'observations.json';proof.write_text(json.dumps(observations,indent=2))
    return dict(trace=summary,failureType=type(error).__name__,proof=str(proof),proofSha256=hashlib.sha256(proof.read_bytes()).hexdigest())


try:
    for kind in ['timeout','missing','excess','deadline']:
        for crossing in (['none','post-write','exits-read','worker-read'] if args.expect_red else ['none','post-write','exits-read','worker-read','worker-failure']):
            case('ordering '+kind+' '+crossing,lambda kind=kind,crossing=crossing:ordering(kind,crossing,'normal'))
        for crossing in ['post-write','worker-read']:
            for delivery in ['packet-fallback','all-files','all-sinks']:
                case('ordering '+kind+' '+crossing+' '+delivery,lambda kind=kind,crossing=crossing,delivery=delivery:ordering(kind,crossing,delivery))
    if not args.ordering_only:
        for mode in ['limit','over-limit','entries4096','entries4097','symlink','fifo','replace-fifo','replace-link','replace-regular','growth','truncate','replace-after-read','read-error','cancel','deadline','close-error','read-and-close-error']:
            case('cache '+mode,lambda mode=mode:cache_boundary(mode))
        for mode in ['bytes','entries','scan-cancel','scan-deadline','scan-error']:case('aggregate '+mode,lambda mode=mode:aggregate_or_scan(mode))
        for mode in ['happy','precopy-growth','fifo','replace','growth','read-error','cancel','deadline']:
            case('copy '+mode,lambda mode=mode:copy_boundary(mode))
finally:
    with args.report.open('x') as f:json.dump(dict(count=len(RESULTS),source=str(A),scratch=str(ROOT),expectRed=args.expect_red,controls=RESULTS),f,indent=2)
print(json.dumps(dict(status='PASS',controls=len(RESULTS),nativeJobs=0)))
