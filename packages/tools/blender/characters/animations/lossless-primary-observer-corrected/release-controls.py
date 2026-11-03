"""Pure allocation/start fault controls over actual caller and accepted start bodies."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import ast,contextlib,copy,hashlib,importlib.util,json,os,subprocess,tempfile,time,types
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPORT=HERE/'release-accounting-correction'
HELPER=Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/blend/stations/_authoring/round4_job_boundary.py')
REVIEW=Path('/Users/andreyyurlov/.codex/reviews/p1-e05-t02-primary-integration-e2df4ecf-sol')
BASE='e2df4ecfaaff6f5530f79273c5614f8955e4190a'
ROOT=Path(tempfile.mkdtemp(prefix='t02-release-accounting-controls-'))
native_calls=[]
def refuse(*args,**kwargs):native_calls.append(str(args));raise AssertionError('Native process refused in pure controls')
# Read-only source retrieval is completed before installing the native-launch refusal.
relative=str((HERE/'integration.py').relative_to(Path(json.loads((HERE/'readiness.json').read_text())['root'])))
old_source=subprocess.check_output(['/usr/bin/git','show',BASE+':'+relative],text=True)
subprocess.Popen=refuse
subprocess.run=refuse
spec=importlib.util.spec_from_file_location('integration',HERE/'integration.py');unit=importlib.util.module_from_spec(spec);spec.loader.exec_module(unit)
def node(text,name,owner='main'):
    tree=ast.parse(text)
    parent=next(x for x in tree.body if isinstance(x,(ast.FunctionDef,ast.ClassDef)) and x.name==owner)
    return next(x for x in ast.walk(parent) if isinstance(x,ast.FunctionDef) and x.name==name)
def actual(text,name,globals_,owner='main'):
    exec(compile(ast.Module(body=[node(text,name,owner)],type_ignores=[]),'<actual-source:'+name+'>','exec'),globals_)
    return globals_[name]
source=(HERE/'integration.py').read_text();helper=HELPER.read_text()
assert unit.sha(HELPER)=='3f5ca99841be6a2ab4218bd45c5e44c5bb368e331d4b323b906b25354baa444c'
results=[]
row={'pid':48123,'birth':[100,200],'uid':os.getuid(),'status':2}
def exercise(mode):
    root=ROOT/mode;root.mkdir();proof=root/'proof';proof.mkdir();packet=root/'packet';packet.mkdir()
    jobs=[];handles=[];trace=[];state={'drained':False};private=root/'private-tmp';scratch=root/'owned-scratch'
    if mode=='out-allocation':(proof/'producer').write_text('retained allocation conflict')
    def identity(pid):return None if state['drained'] else row.copy()
    def kernel(cid):return {'live':0 if state['drained'] else 1,'coalition_absent':state['drained']}
    def members(cid):return [] if state['drained'] else [row.copy()]
    def simulated_run(argv,**kwargs):
        if argv[:2]==['/bin/launchctl','bootstrap']:
            trace.append('bootstrap')
            if mode=='bootstrap':raise OSError('injected bootstrap failure')
            return types.SimpleNamespace(returncode=0,stdout='',stderr='')
        assert argv[:2]==['/bin/launchctl','print'],argv
        return types.SimpleNamespace(returncode=1,stdout='',stderr='')
    def write(path,value):
        if mode=='pre-go' and Path(path).name=='boundary.json' and value.get('coalition_id'):
            raise OSError('injected durable-boundary save failure before go')
        unit.save(path,value)
    helper_globals=dict(subprocess=types.SimpleNamespace(run=simulated_run),os=os,write=write,
        deadline=lambda seconds:contextlib.nullcontext(),time=time,json=json,identity=identity,
        coalition=lambda pid:[1000 if pid==os.getpid() else 999],kernel_tasks=kernel)
    start=actual(helper,'start',helper_globals,'StationJob')
    class FakeJob:
        def __new__(cls,*args,**kwargs):
            if mode=='new':raise OSError('injected object allocation failure')
            return object.__new__(cls)
        def __init__(self,out,argv,cwd,**kwargs):
            self.out=Path(out);self.out.mkdir()
            if mode=='constructor-early':raise OSError('injected constructor failure before scratch')
            self.scratch=scratch;scratch.mkdir();(scratch/'preserve.txt').write_text('scratch bytes')
            self.target='gui/review-only/fake';self.root=None;self.coalition_id=None;self.registered=False;self.known={}
            self.state={'exits':{},'errors':[],'drained':False,'clean':False}
            if mode=='constructor-scratch':raise OSError('injected constructor failure after scratch')
            unit.save(scratch/'worker.json',{'root':row});self.save()
        def save(self):write(self.out/'boundary.json',{'coalition_id':self.coalition_id,'registered':self.registered,**self.state})
        def members(self):return members(self.coalition_id)
        def status(self):
            assert (scratch/'go').exists();trace.append('post-go-status')
            if mode in ['post-go','post-go-clean']:raise OSError('injected status receipt read failure after durable coalition/go')
            return {'launch_complete':True}
        def wait(self,seconds,observe):
            if mode=='wait':raise OSError('injected wait failure')
            self.state['exits']['capture']=0;return 'completed'
        def drain(self,seconds):
            trace.append('drain')
            if mode in ['pre-go','post-go']:return {'drained':False,'clean':False}
            state['drained']=True;self.state.update(drained=True,clean=True)
            return {'drained':True,'clean':True}
        def archive(self,**kwargs):scratch.rename(root/'retained-scratch')
    FakeJob.start=start
    def private_tmp(path):
        if mode=='private-before':raise OSError('injected private TMP allocation failure')
        private.mkdir();(private/'preserve.txt').write_text('private bytes')
        if mode=='private-after':
            error=OSError('injected private TMP admission failure')
            error.private_tmp_allocation={'path':str(private),'released':False,'cleanup_failure':{'type':'OSError','message':'simulated nonempty namespace retained'}}
            raise error
        return private,{'review_only':True}
    def preserve(path,admission,destination,**kwargs):
        path.rename(root/'retained-private-tmp');return {'all_bytes_preserved':True,'namespace_removed':True}
    ready={'fixtureDiskAdmission':{'newAttemptMaxNativeJobs':2},'root':str(root),'pathEnvironment':'review-only',
        'purpose':'PURE_SOURCE_FAULT_CONTROLS','nativeRawDirectory':str(root/'raw')}
    globals_=dict(unit.__dict__);globals_.update(ready=ready,proof=proof,packet=packet,jobs=jobs,handles=handles,
        StationJob=FakeJob,deadline=lambda seconds:contextlib.nullcontext(),create_private_tmp=private_tmp,
        preserve_private_tmp=preserve,kernel_tasks=kernel,coalition_members=members,identity=identity,
        subprocess=types.SimpleNamespace(run=simulated_run))
    owned=actual(source,'owned',globals_);audit=actual(source,'audit_one',globals_)
    result={'status':'HOLD','primaryFailure':None,'jobs':jobs,'runtimeAuthorization':False}
    try:owned('producer',['review-only-no-process'])
    except AssertionError as error:result['primaryFailure']={'type':type(error).__name__,'message':str(error)}
    else:assert mode=='healthy',mode;result['status']='PASS_PURE_SIMULATION'
    assert len(jobs)==len(handles)==1
    receipt=json.loads(Path(jobs[0]['path']).read_text())
    unit.persist_terminal_summary(result,handles,audit,jobs,proof,packet,time.monotonic())
    stored=json.loads((packet/'integration-result.json').read_text())
    positive=mode in ['healthy','wait','post-go-clean']
    assert stored['terminalReleaseProved'] is positive,(mode,stored)
    assert stored['nativeJobs']==1 and len(stored['terminalAudit'])+len([e for e in stored['terminalAuditFailures'] if e.get('type')!='TerminalAttemptAccountingFailure' and 'attemptPath' not in e])==1
    if mode=='healthy':assert receipt['primaryFailure'] is None and receipt['cleanupFailure'] is None
    else:assert receipt['primaryFailure'] is not None and stored['status']=='HOLD'
    if not positive:assert receipt['cleanupFailure'] is not None and stored['terminalAuditFailures']
    if mode=='private-after':assert receipt['privateTmpAllocation']['released'] is False and private.exists()
    if mode in ['constructor-scratch','bootstrap','pre-go','post-go']:assert scratch.exists() and private.exists()
    if mode in ['post-go','post-go-clean']:assert 'post-go-status' in trace
    if mode=='pre-go':assert not (scratch/'go').exists()
    results.append({'control':mode,'pass':True,'terminalReleaseProved':stored['terminalReleaseProved'],
        'primaryFailure':receipt['primaryFailure'],'cleanupFailure':receipt['cleanupFailure'],'trace':trace,'summary':str(packet/'integration-result.json')})
for mode in ['out-allocation','private-before','private-after','new','constructor-early','constructor-scratch','bootstrap','pre-go','post-go','post-go-clean','wait','healthy']:exercise(mode)

def summary_case(name,change):
    root=ROOT/name;root.mkdir();proof=root/'proof';proof.mkdir();packet=root/'packet';packet.mkdir()
    path=root/'receipt.json';unit.save(path,{'primaryFailure':None,'cleanupFailure':None})
    jobs=[{'path':str(path)}];handles=[object()]
    positive={'attemptPath':str(path),'releaseProved':True,'kernel':{'live':0,'coalition_absent':True}}
    def audit(handle):return copy.deepcopy(positive)
    result={'status':'PASS_PURE_SIMULATION','primaryFailure':{'type':'FirstFailure','message':'keep original'}}
    audit,expected=change(jobs,handles,positive,audit,result,path)
    unit.persist_terminal_summary(result,handles,audit,jobs,proof,packet,time.monotonic())
    stored=unit.load(packet/'integration-result.json');complete=unit.load(proof/'result.json')
    assert stored['terminalReleaseProved'] is expected and complete['primaryFailure']==result['primaryFailure']
    assert (packet/'integration-result.json').stat().st_size<=unit.budget.RECORD_BYTES
    if not expected:assert complete['status']=='HOLD' and complete['terminalAuditFailures']
    results.append({'control':name,'pass':True,'terminalReleaseProved':expected,'summary':str(packet/'integration-result.json')})
def removed_handle(jobs,handles,positive,audit,result,path):handles.clear();return audit,False
def no_attempt(jobs,handles,positive,audit,result,path):jobs.clear();handles.clear();return audit,False
def audit_failure(jobs,handles,positive,audit,result,path):
    def fail(handle):raise OSError('injected terminal audit failure')
    return fail,False
def cleanup_failure(jobs,handles,positive,audit,result,path):unit.save(path,{'cleanupFailure':{'type':'UnresolvedCleanup','message':'retained'}});return audit,False
def wrong_path(jobs,handles,positive,audit,result,path):positive['attemptPath']='wrong-attempt';return audit,False
def no_positive(jobs,handles,positive,audit,result,path):positive.pop('releaseProved');return audit,False
def live_kernel(jobs,handles,positive,audit,result,path):positive['kernel']['live']=1;return audit,False
def present_coalition(jobs,handles,positive,audit,result,path):positive['kernel']['coalition_absent']=False;return audit,False
def duplicate(jobs,handles,positive,audit,result,path):jobs.extend(jobs.copy());handles.append(object());return audit,False
def missing_receipt(jobs,handles,positive,audit,result,path):jobs[0]['path']=str(path.parent/'absent.json');return audit,False
def oversized(jobs,handles,positive,audit,result,path):result['primaryFailure']['message']='original failure '*unit.budget.RECORD_BYTES;return audit,True
for name,change in [('missing-handle',removed_handle),('zero-attempts',no_attempt),('audit-failure',audit_failure),('unresolved-cleanup-with-positive-audit',cleanup_failure),('wrong-audit-attempt',wrong_path),('missing-positive-evidence',no_positive),('live-kernel-with-positive-flag',live_kernel),('present-coalition-with-positive-flag',present_coalition),('duplicate-attempt',duplicate),('missing-receipt',missing_receipt),('bounded-overflow-summary',oversized)]:summary_case(name,change)

# Preserve the independent repro exactly except source/output routing and fixed-behavior expectations.
repro=(REVIEW/'repro_vacuous_release.py').read_text()
assert hashlib.sha256((REVIEW/'review.md').read_bytes()).hexdigest()=='aa4b58d5219b4151ca769afdd337fc44be5ef1244da51e146fb8c162e1ba0833'
for version,text in [('before',old_source),('after',source)]:
    root=ROOT/('original-repro-'+version);root.mkdir();snapshot=root/'source';snapshot.mkdir();(snapshot/'integration.py').write_text(text)
    adapted=repro.replace("SOURCE = Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/packages/tools/blender/characters/animations/lossless-primary-observer-corrected')",'SOURCE = Path('+repr(str(snapshot))+')')
    adapted=adapted.replace("ROOT = Path(__file__).resolve().parent / 'vacuous-release-fixture'",'ROOT = Path('+repr(str(root/'vacuous-release-fixture'))+')')
    adapted=adapted.replace('trace = []','unit.HERE = Path('+repr(str(HERE))+')\ntrace = []')
    if version=='after':
        adapted=adapted.replace('assert len(jobs) == 1 and handles == []','assert len(jobs) == 1 and len(handles) == 1')
        adapted=adapted.replace("stored['terminalReleaseProved'] is True","stored['terminalReleaseProved'] is False")
        adapted=adapted.replace("assert stored['terminalAudit'] == [] and stored['terminalAuditFailures'] == [] and audit_calls == []","assert stored['terminalAudit'] == [None] and stored['terminalAuditFailures'] and len(audit_calls) == 1")
        adapted=adapted.replace("'REPRODUCED_FALSE_TERMINAL_RELEASE'","'REFUSED_FALSE_TERMINAL_RELEASE'")
    # Keep serialized evidence finite; handle objects are not JSON data.
    adapted=adapted.replace("'trace':trace, 'handles':handles, 'jobCount':len(jobs)","'trace':trace, 'handleCount':len(handles), 'jobCount':len(jobs)")
    (root/'adapted-repro.py').write_text(adapted)
    with contextlib.redirect_stdout((root/'stdout.json').open('w')):exec(compile(adapted,str(root/'adapted-repro.py'),'exec'),{'__file__':str(root/'adapted-repro.py')})
    evidence=unit.load(root/'vacuous-release-result.json')
    assert evidence['terminalReleaseProved'] is (version=='before')
    results.append({'control':'original-independent-repro-'+version,'pass':True,'terminalReleaseProved':evidence['terminalReleaseProved'],'evidence':str(root/'vacuous-release-result.json')})

worker_spec=importlib.util.spec_from_file_location('worker',HERE/'rgb-primary.py');worker=importlib.util.module_from_spec(worker_spec);worker_spec.loader.exec_module(worker)
text=(HERE.parent/'lossless-feasibility/decoded-framehash.txt').read_text()
rows=unit.load('/private/tmp/t02-lossless-rgb-sample-132-717fs7_b/pixel-proof.json')['sourceFrames']
worker.parse_framehash(text,rows,'rgb');results.append({'control':'existing-valid-132-framehash','pass':True})
for header in ['#tb 0: 1/60000','#tb 0: 1/60suffix','#tb 0: 1/60\n#tb 0: 1/60000','#tb 0: 1/60\n#tb 0: 1/60']:
    altered=text.replace('#tb 0: 1/60',header)
    try:worker.parse_framehash(altered,rows,'rgb')
    except AssertionError as error:assert 'timebase' in str(error)
    else:raise AssertionError('Malformed timebase accepted: '+header)
    results.append({'control':'reject-header-'+repr(header),'pass':True})
assert not native_calls
ready=unit.load(HERE/'readiness.json');assert not Path(ready['packetRoot']).exists() and not Path(ready['cpuProofRoot']).exists()
REPORT.mkdir(exist_ok=True)
unit.save(REPORT/'release-controls.json',{'status':'PASS_PURE_ALLOCATION_RELEASE_AND_FRAMEHASH_CONTROLS','controls':results,'count':len(results),'nativeCalls':native_calls,'fixtureRoot':str(ROOT),'sourceSha256':{'integration.py':unit.sha(HERE/'integration.py'),'rgb-primary.py':unit.sha(HERE/'rgb-primary.py'),'release-controls.py':unit.sha(HERE/'release-controls.py')},'baselineCommit':BASE,'originalReproSha256':unit.sha(REVIEW/'repro_vacuous_release.py'),'reviewSha256':unit.sha(REVIEW/'review.md'),'helperSha256':unit.sha(HELPER),'noNativeIntegrationClaim':True})
print(json.dumps({'status':'PASS','controls':len(results),'nativeCalls':0,'fixturesRetained':str(ROOT)}))
