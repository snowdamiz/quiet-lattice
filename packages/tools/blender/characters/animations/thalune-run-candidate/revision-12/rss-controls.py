"""Private harmless children, retained startup facts, and the actual adapter boundary."""
import sys
sys.dont_write_bytecode=True
import ast, contextlib, copy, ctypes, importlib.util, json, os, selectors, signal, subprocess, time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

D=Path(__file__).resolve().parent;A=D.parent;sys.path.insert(0,str(A))
import caller, native189 as native, resource_admission as resources
import release_accounting as accounting
from inspector import error_receipt

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

children=module('owned_children',A/'retained-station/round4_capture_children.py')
tree=ast.parse((A/'retained-station/round4_job_boundary.py').read_text())
tree.body=[n for n in tree.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children']
CORE=dict(__name__='inert_helper',__file__=str(A/'retained-station/round4_job_boundary.py'),identity=children.identity,LIBPROC=None,UnsafeCaptureGroup=RuntimeError)
exec(compile(tree,CORE['__file__'],'exec'),CORE)
path_tree=ast.parse((A/'retained-station/run_round4_browser_proof.py').read_text())
path_tree.body=[n for n in path_tree.body if isinstance(n,ast.FunctionDef) and n.name=='executable_path']
PATH_PORT=dict(ctypes=ctypes,LIBPROC=children.LIBPROC,os=os,Path=Path)
exec(compile(path_tree,'exact_retained_executable_path','exec'),PATH_PORT)
READY=json.loads(caller.READY.read_text());PLAN=json.loads(native.PLAN.read_text())
RESULTS=[]

def real_membership(mode,admit_executables=False):
    facts=[];owned=[];started=1;exited=0;changed=False
    def birth():
        nonlocal started
        p=subprocess.Popen([sys.executable,'-B','-c','import sys;print("ready",flush=True);sys.stdin.buffer.read(1)'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        owned.append(p);started+=1
        with selectors.DefaultSelector() as selector:
            selector.register(p.stdout,selectors.EVENT_READ);assert selector.select(3),'Child handshake timed out'
        assert p.stdout.readline()==b'ready\n'
        assert children.identity(p.pid)['pgid']==p.pid
    def depart():
        nonlocal exited
        p=owned[-1];p.stdin.write(b'x');p.stdin.flush();assert p.wait(timeout=3)==0;exited+=1
    def members():return [children.identity(os.getpid())]+[children.identity(p.pid) for p in owned if p.poll() is None]
    def kernel(_):return dict(started=started,exited=exited,live=started-exited,coalition_absent=False,fixtureOnlyPrivateLedger=True)
    def read(pids):
        nonlocal changed
        value=resources.rss_read(pids)
        if not changed:
            changed=True
            if mode=='birth':birth()
            else:depart()
        return value
    error=None
    executable_receipt=dict(actualExecutables={},observerEvents=[])
    try:
        if mode=='departure':birth()
        core=SimpleNamespace(identity=children.identity,kernel_tasks=kernel,deadline=CORE['deadline'])
        adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=READY;adapter.core=core
        adapter.temp=SimpleNamespace(executable_path=PATH_PORT['executable_path'])
        admit=(lambda rows:adapter.admit_resource_members(executable_receipt,rows)) if admit_executables else lambda rows:None
        resources.CohortRSS(core,facts,read=read,admit=admit).observe(SimpleNamespace(coalition_id='private-fixture-not-OS-coalition',members=members))
    except BaseException as e:error=error_receipt(e)
    finally:
        terminal=[]
        for p in owned:
            if p.poll() is None:
                p.stdin.write(b'x');p.stdin.flush();p.wait(timeout=3)
            terminal.append(dict(pid=p.pid,exit=p.returncode,identity=children.identity(p.pid),stderr=p.stderr.read().decode()))
            for stream in [p.stdin,p.stdout,p.stderr]:stream.close()
        assert all(r['exit']==0 and r['identity'] is None for r in terminal)
    return dict(accepted=error is None,error=error,observations=facts,children=terminal,executableReceipt=executable_receipt,scope='Real identities and ps; fixture-owned membership ledger, no OS coalition creation')

IDENTITY=dict(pid=100,birth=[11,22],uid=os.getuid(),status=1,unknownIdentity={'keep':None})

def sampling(mode):
    facts=[];state=0;reads=0;identity_calls=0;admissions=[];error=None;original=None
    if mode=='partial-identity':state=1
    def rows():
        result=[copy.deepcopy(IDENTITY)]
        if state%2:result.append({**IDENTITY,'pid':101})
        if mode=='duplicate' and state:return result+[copy.deepcopy(result[-1])]
        return result
    def identity(pid):
        nonlocal identity_calls
        identity_calls+=1
        if mode=='partial-identity' and identity_calls==2:raise OSError('SECOND_IDENTITY_UNREADABLE')
        if mode=='reuse' and reads:return {**IDENTITY,'pid':pid,'birth':[99,1]}
        if mode=='uid' and reads:return {**IDENTITY,'pid':pid,'uid':os.getuid()+1}
        if mode=='missing-identity' and reads:return None
        if mode=='churn' and pid==101 and not state%2:return None
        return {**IDENTITY,'pid':pid}
    def kernel(_):
        k=dict(started=1+state,exited=state//2,live=len(rows()),coalition_absent=False,unknownKernel=[False,None,7])
        k['started']=k['exited']+k['live']
        if mode=='kernel-mismatch' and reads:k['live']+=1
        if mode=='kernel-invalid' and reads:k['exited']=k['started']+1
        if mode=='counter-disappears' and reads:del k['started'];del k['exited']
        if mode=='counter-regress':k.update(started=10-(reads>0),exited=9-(reads>0))
        if mode in ['transient','always-transient']:k.update(started=1+state,exited=state,live=1)
        return k
    def members():return [copy.deepcopy(IDENTITY)] if mode in ['transient','always-transient'] else rows()
    def read(pids):
        nonlocal state,reads,original
        reads+=1
        if mode in ['birth','excess-during-birth','duplicate'] and reads==1:state=1
        if mode in ['churn','always-transient']:state+=1
        if mode=='transient' and reads==1:state=1
        if mode=='cancel-after-read':state=1
        if mode=='read-timeout':
            original=subprocess.TimeoutExpired(['fixture-ps'],2,output=b'bytes\xff',stderr=b'err\xfe');original.unknown={'keep':17};raise original
        if mode=='empty-error':original=KeyboardInterrupt();original.unknown={'allocation':'keep'};raise original
        if mode=='deadline':time.sleep(4)
        if mode=='outer-deadline':time.sleep(.2)
        values={p:resources.RSS_LIMIT//len(pids) for p in pids}
        if mode in ['excess','excess-during-birth']:values[pids[0]]+=1
        if mode=='missing-rss':values.pop(pids[0])
        if mode=='unknown-rss':values[pids[0]]=None
        return dict(bytesByPid=values,stdout='raw rows',stderr='raw diagnostic',unknownRSS={'keep':[None,7]})
    def admit(rows):
        nonlocal original
        admissions.append(copy.deepcopy(rows))
        if mode=='admit-error':original=OSError('PATH_UNAVAILABLE');original.unknown={'raw':b'\xff'};raise original
    core=SimpleNamespace(identity=identity,kernel_tasks=kernel,deadline=CORE['deadline'])
    try:
        with CORE['deadline'](.03 if mode=='outer-deadline' else 5):
            resources.CohortRSS(core,facts,read=read,admit=admit,cancel=lambda:mode=='cancel' or (mode=='cancel-after-read' and reads>0)).observe(SimpleNamespace(coalition_id=123,members=members))
    except BaseException as e:
        error=e
        if original is not None:assert error is original
    accepted=mode in ['limit','birth','transient']
    assert (error is None)==accepted
    assert reads<=3
    if error:assert facts[0]['failure']==error_receipt(error) and not facts[0]['accepted']
    if mode in ['birth','transient']:assert len(facts[0]['samples'])==2 and not facts[0]['samples'][0]['accepted']
    if mode in ['churn','always-transient']:assert reads==3 and all(not r['accepted'] for r in facts[0]['samples'])
    if mode=='excess-during-birth':assert reads==1 and 'exceeds' in str(error)
    if mode=='partial-identity':assert facts[0]['before']==[IDENTITY] and reads==0
    return dict(accepted=True,expectedSamplingAcceptance=accepted,observations=facts,admissions=admissions,error=None if error is None else error_receipt(error))

def replay():
    receipt=json.loads(Path('/private/tmp/t02-native189-r10-20261107-t3-11167406/proof/jobs/native-189-encode/receipt.json').read_text())
    old=receipt['rssObservations'][-1];facts=[];calls=0
    def members():
        nonlocal calls
        calls+=1;return copy.deepcopy(old['members'] if calls==1 else old['membersAfter'])
    def identity(pid):return copy.deepcopy(next(r for r in old['membersAfter'] if r['pid']==pid))
    def kernel(_):return copy.deepcopy(old['kernelBefore'] if calls==0 else old['kernelAfter'])
    def read(pids):return dict(bytesByPid={p:old['rss']['bytesByPid'].get(str(p),1048576) for p in pids},syntheticNewMemberRss=True,unknown={'keep':7})
    core=SimpleNamespace(identity=identity,kernel_tasks=kernel,deadline=CORE['deadline'])
    error=None
    try:resources.CohortRSS(core,facts,read=read).observe(SimpleNamespace(coalition_id=43179,members=members))
    except BaseException as e:error=error_receipt(e)
    return dict(accepted=error is None,error=error,observations=facts,historicalExecutable51704='UNOBSERVED_NOT_RETROACTIVELY_ADMITTED')

def cleanup(mode,root):
    root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir()
    ready={**READY,'captureSeconds':2,'cleanupSeconds':2,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof')}
    plan={**PLAN,'runRoot':str(root),'cancelPath':str(root/'cancel'),'consumedPath':str(root/'consumed')}
    (root/'consumed').write_text('{"authorizationId":"inert"}')
    events=[];handles=[];calls=0
    original=subprocess.TimeoutExpired(['fixture-ps'],2,output=b'partial\xff',stderr=b'error\xfe');original.unknown={'retained':17}
    class Job:
        def __init__(self,out,*args,**kwargs):
            self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.target='inert';self.coalition_id=123;self.known={};self.state=dict(exits={},errors=[])
        def save(self):pass
        def start(self):events.append('start')
        def members(self):return []
        def status(self):return {'exits':{}}
        def wait(self,seconds,observer):return CORE['StationJob'].wait(self,seconds,observer)
        def drain(self,seconds):
            events.append('drain')
            if mode=='new-drain-error':self.state['errors'].append('NEW_DRAIN_ERROR')
            if mode=='replaced-errors':self.state['errors']=['REPLACED_ERROR']
            self.state.update(drained=True,clean=False,remaining=[],kernel_terminal=dict(coalition_absent=True,live=0),unknownDrain={'kept':True})
            if mode=='not-drained':self.state['drained']=False
            if mode=='drain-live':self.state['kernel_terminal']['live']=1
            if mode=='drain-present':self.state['kernel_terminal']['coalition_absent']=False
            if mode=='drain-remaining':self.state['remaining']=[IDENTITY]
            if mode=='live-birth':self.known={'100':IDENTITY}
            if mode=='partial-birth':self.known={'100':IDENTITY,'101':{**IDENTITY,'pid':101}}
            return self.state
        def archive(self,**kwargs):
            if mode=='archive-failure':raise OSError('ARCHIVE_FAILURE')
            events.append('archive');self.scratch.rmdir();caller.write(self.out/'profile_release.json',dict(all_absent=True))
    def allocate(path):p=path.parent/'private';p.mkdir();return p,dict(path=str(p))
    def preserve(p,*args,**kwargs):
        if mode=='private-failure':raise OSError('PRIVATE_FAILURE')
        events.append('private-release');p.rmdir();return dict(all_bytes_preserved=True,namespace_removed=True)
    adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=ready;adapter.plan=plan;adapter.grant={'authorizationId':'inert'}
    adapter.core=SimpleNamespace(StationJob=Job,deadline=CORE['deadline'],identity=lambda _:IDENTITY if mode=='live-birth' else None,kernel_tasks=lambda _:dict(coalition_absent=mode!='fresh-present',live=int(mode=='fresh-live'),unknown=9),coalition_members=lambda _:[IDENTITY] if mode=='fresh-members' else [])
    if mode=='partial-birth':
        def identity(pid):
            if pid==101:raise OSError('SECOND_BIRTH_UNREADABLE')
            return None
        adapter.core.identity=identity
    adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=preserve,executable_path=lambda _:'/inert')
    def observer(job,receipt):
        def observe():
            nonlocal calls
            calls+=1
            if calls>1:raise original
        return observe
    adapter.resource_observer=observer;adapter.inspect_native=lambda:None
    actual=adapter.run
    def run(definition,handle):handles.append(handle);return actual(definition,handle)
    adapter.run=run
    actual_write=caller.write
    def write(path,value):
        if mode in ['packet-fallback','all-files'] and (Path(path).name=='returned-receipts.json' or Path(path).name=='receipt.json' and 'ownedAllocation' in value):raise OSError('FINAL_RECEIPT_FAILURE')
        return actual_write(path,value)
    with contextlib.ExitStack() as stack:
        for port in [patch.object(caller,'observe_executables',lambda *a,**kw:None),patch.object(caller.subprocess,'run',lambda *a,**kw:SimpleNamespace(returncode=0 if mode=='registration-remains' else 113,stdout='',stderr='raw')),patch.object(caller,'write',write)]:stack.enter_context(port)
        if mode in ['packet-fallback','all-files']:stack.enter_context(patch.object(accounting,'save',lambda *a:(_ for _ in ()).throw(OSError('SUMMARY_FAILURE'))))
        if mode=='all-files':stack.enter_context(patch.object(accounting.budget,'write_json',lambda *a,**kw:(_ for _ in ()).throw(OSError('PACKET_FAILURE'))))
        result=native.run_sequence(ready,plan,{},adapter,lambda:None,writer=write)
    assert result['status']=='HOLD' and result['nativeJobs']==1
    assert result['primaryFailure']==error_receipt(original)
    if mode=='all-files':assert result['terminalDelivery']['completeObservationsPersisted'] is False and result['receiptFallbacks']
    if mode=='packet-fallback':assert result['terminalDelivery']['packet']['status']=='written'
    if mode in ['all-files','packet-fallback']:assert result['terminalAudit'][0]['releaseProved'] is True and not result['terminalReleaseProved']
    if mode=='partial-birth':
        births=handles[0]['receipt']['drainBirths'];assert len(births)==2 and births[0]['current'] is None and 'current' not in births[1]
    if mode not in ['old-observer-error','packet-fallback','all-files','private-failure','registration-remains']:assert 'archive' not in events
    return dict(accepted=result['terminalReleaseProved'],result=result,receipt=handles[0]['receipt'],events=events)

def resource_dispatch(mode,root):
    root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir()
    binary=root/'unexecuted-identity-fixture';binary.write_bytes(b'CPU identity fixture, never executed')
    ready={**READY,'captureSeconds':2,'cleanupSeconds':2,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof'),'process_binary_sha256':{str(binary):caller.sha(binary)}}
    plan={**PLAN,'runRoot':str(root),'cancelPath':str(root/'cancel'),'consumedPath':str(root/'consumed')}
    (root/'consumed').write_text('{"authorizationId":"inert"}')
    current=None;starts=[];handles=[];raw=OSError('ACTUAL_RESOURCE_EXECUTABLE_PATH_FAILURE');raw.partial=b'\xff\x00';raw.unknown={'keep':17}
    class Job:
        def __init__(self,out,*args,**kwargs):
            nonlocal current
            current=self;self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.target='inert';self.coalition_id=123
            self.state=dict(exits={'capture':0},errors=[]);self.known={};self.active=True;self.phase=0;self.reads=0
        def save(self):pass
        def start(self):starts.append(self.out.parent.name)
        def members(self):
            if not self.active:return []
            rows=[copy.deepcopy(IDENTITY)]
            if self.phase%2:rows.append({**IDENTITY,'pid':101})
            self.known.update({str(r['pid']):r for r in rows});return rows
        def wait(self,seconds,observer):return 'completed'
        def drain(self,*args):self.active=False;return dict(drained=True,clean=True)
        def archive(self,**kwargs):self.scratch.rmdir();caller.write(self.out/'profile_release.json',dict(all_absent=True))
    def identity(pid):
        if current is None or not current.active:return None
        return next((r for r in current.members() if r['pid']==pid),None)
    def kernel(_):
        if current is None or not current.active:return dict(coalition_absent=True,live=0)
        live=len(current.members());exited=current.phase//2
        return dict(coalition_absent=False,live=live,started=live+exited,exited=exited)
    def read(pids):
        current.reads+=1
        if current.reads==1 or mode=='churn':current.phase+=1
        return dict(bytesByPid={p:1024 for p in pids},unknown={'raw':[None,9]})
    def path(pid):
        if mode=='unknown-executable' and pid==101:raise raw
        return str(binary)
    def allocate(p):private=p.parent/'private';private.mkdir();return private,dict(path=str(private))
    def preserve(p,*args,**kwargs):p.rmdir();return dict(all_bytes_preserved=True,namespace_removed=True)
    adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=ready;adapter.plan=plan;adapter.grant={'authorizationId':'inert'}
    adapter.core=SimpleNamespace(StationJob=Job,deadline=CORE['deadline'],identity=identity,kernel_tasks=kernel,coalition_members=lambda _:current.members())
    adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=preserve,executable_path=path)
    adapter.inspect_native=lambda:None;actual=adapter.run
    def run(definition,handle):handles.append(handle);return actual(definition,handle)
    adapter.run=run
    with patch.object(native,'CohortRSS',lambda *a,**kw:resources.CohortRSS(*a,**kw,read=read)),patch.object(caller.subprocess,'run',lambda *a,**kw:SimpleNamespace(returncode=113,stdout='',stderr='absent')):
        result=native.run_sequence(ready,plan,{},adapter,lambda:None)
    expected=mode=='birth'
    assert len(starts)==(2 if expected else 1)
    assert result['status']==('NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT' if expected else 'HOLD')
    if mode=='unknown-executable':
        assert result['primaryFailure']==error_receipt(raw)
        assert handles[0]['receipt']['secondaryFailures']
    for handle in handles:
        obs=handle['receipt']['rssObservations'][0]
        if expected:assert len(obs['samples'])==2 and obs['accepted']
        else:assert not obs['accepted']
    return dict(accepted=True,result=result,receipts=[h['receipt'] for h in handles],starts=starts,scope='Actual NativeAdapter.resource_observer/run/dispatcher, inert native and lifecycle ports')

def rss_command(mode):
    text={'malformed':'100 unreadable\n','missing':'100 4\n','duplicate':'100 4\n100 5\n','unavailable':None}[mode]
    result=subprocess.CompletedProcess(['/bin/ps'],0,stdout=text,stderr='partial diagnostic\udcff');result.unknown={'allocation':[None,17]}
    with patch.object(resources.subprocess,'run',lambda *a,**kw:result):
        try:resources.rss_read([100,101])
        except BaseException as error:
            assert error.rssCommandResult==vars(result)
            return dict(accepted=True,error=error_receipt(error))
    raise AssertionError('Unknown/incomplete RSS accepted')

def main():
    root=Path(sys.argv[1]);root.mkdir(exist_ok=False)
    cases=[('real-birth',lambda:real_membership('birth'),True),('real-departure',lambda:real_membership('departure'),True),('retained-replay',replay,True),('cleanup-primary',lambda:cleanup('old-observer-error',root/'cleanup'),True),('cleanup-new-error',lambda:cleanup('new-drain-error',root/'new-error'),False)]
    if '--extended' in sys.argv:
        for mode in ['birth','departure']:cases.append(('real-executable-'+mode,lambda mode=mode:real_membership(mode,True),True))
        for mode in ['limit','birth','transient','churn','always-transient','excess','excess-during-birth','duplicate','reuse','uid','missing-identity','kernel-mismatch','kernel-invalid','counter-disappears','counter-regress','read-timeout','empty-error','deadline','outer-deadline','missing-rss','unknown-rss','admit-error','cancel','cancel-after-read','partial-identity']:
            cases.append(('sample-'+mode,lambda mode=mode:sampling(mode),True))
        for mode in ['replaced-errors','not-drained','drain-live','drain-present','drain-remaining','live-birth','fresh-present','fresh-live','fresh-members','archive-failure','private-failure','registration-remains','packet-fallback','all-files','partial-birth']:
            cases.append(('cleanup-'+mode,lambda mode=mode:cleanup(mode,root/mode),False))
        for mode in ['birth','churn','unknown-executable']:
            cases.append(('resource-dispatch-'+mode,lambda mode=mode:resource_dispatch(mode,root/('dispatch-'+mode)),True))
        for mode in ['malformed','missing','duplicate','unavailable']:
            cases.append(('rss-command-'+mode,lambda mode=mode:rss_command(mode),True))
    for name,fn,expected in cases:
        try:
            details=fn();status='PASS' if details['accepted']==expected else 'FAIL'
            RESULTS.append(dict(name=name,status=status,details=details))
        except BaseException as error:RESULTS.append(dict(name=name,status='FAIL',error=error_receipt(error)))
        assert signal.getitimer(signal.ITIMER_REAL)[0]==0
    (root/'results.json').write_text(json.dumps(RESULTS,indent=2)+'\n')
    print(json.dumps(dict(passed=sum(r['status']=='PASS' for r in RESULTS),failed=sum(r['status']=='FAIL' for r in RESULTS),results=str(root/'results.json'))))
    return int(any(r['status']=='FAIL' for r in RESULTS))

if __name__=='__main__':sys.exit(main())
