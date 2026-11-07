"""Actual adapter/helper wait/cleanup/dispatcher, only terminal sink ports injected."""
import contextlib,hashlib,importlib.util,itertools,json,signal,sys,time
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
D=Path(__file__).resolve().parent;A=D.parent
spec=importlib.util.spec_from_file_location('retained_controls',A/'revision-12/rss-controls.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=Path(sys.argv[1]);root.mkdir(exist_ok=False);results=[]

def scenario(proof_mode,packet_mode,compact=False):
    name=proof_mode+'-'+packet_mode+('-compact' if compact else '')
    path=root/name;events=[];raw={}
    for sink in ['proof','packet']:
        error=OSError('TERMINAL_'+sink.upper()+'_FAILURE');error.partialStdout=b'\xff\x00';error.partialStderr=b'\xfe';error.unknown={'keep':[None,17]};raw[sink]=error
    original_save=m.accounting.save;original_packet=m.accounting.budget.write_json;original_read=Path.read_bytes
    def call(sink,mode,fn,*args,**kwargs):
        events.append(sink)
        if mode=='raise':raise raw[sink]
        if mode=='cancel':
            error=KeyboardInterrupt();error.unknown={'sink':sink};raise error
        if mode=='deadline':
            with m.CORE['deadline'](.01):time.sleep(.2)
        result=fn(*args,**kwargs)
        if mode=='after':raise raw[sink]
        if mode=='corrupt':
            target=Path(args[0] if sink=='proof' else args[1]);target.write_bytes(b'{invalid retained sink bytes')
        return result
    def read(p):
        if p==path/'proof/result.json' and proof_mode=='read-fail':raise raw['proof']
        if p==path/'packet/integration-result.json' and packet_mode=='read-fail':raise raw['packet']
        return original_read(p)
    with contextlib.ExitStack() as stack:
        for port in [patch.object(m.accounting,'save',lambda *a,**kw:call('proof',proof_mode,original_save,*a,**kw)),patch.object(m.accounting.budget,'write_json',lambda *a,**kw:call('packet',packet_mode,original_packet,*a,**kw)),patch.object(Path,'read_bytes',read)]:stack.enter_context(port)
        if compact:stack.enter_context(patch.object(m.accounting.budget,'RECORD_BYTES',2048))
        value=m.cleanup('old-observer-error',path)
    result=value['result'];receipt=value['receipt'];delivery=result['terminalDelivery']
    assert events==['proof','packet'] and result['nativeJobs']==1 and result['status']=='HOLD'
    assert result['primaryFailure'] is receipt['primaryFailure']
    assert result['primaryFailure']['type']=='TimeoutExpired'
    assert result['primaryFailure']['details']['output']=="b'partial\\xff'" and result['primaryFailure']['details']['stderr']=="b'error\\xfe'"
    assert result['primaryFailure']['details']['unknown']=={'retained':17}
    assert receipt['persistenceFailures']==[] and receipt['cleanupFailure'] is None
    assert receipt['drain']['clean'] is False and result['terminalAudit'][0]['releaseProved'] is True
    assert result['terminalReleaseAuditProved'] is True
    assert value['events']==['start','drain','archive','private-release']
    qualified=proof_mode=='ok' or packet_mode=='ok' and not compact
    assert result['terminalReleaseProved'] is qualified
    assert delivery['completeObservationsPersisted'] is qualified
    failures=result['terminalPersistenceFailures']
    assert len(failures)==int(proof_mode!='ok')+int(packet_mode!='ok')
    for sink,mode in [('proof',proof_mode),('packet',packet_mode)]:
        if mode in ['raise','after','read-fail']:
            error=next(f for f in failures if f['sink']==sink)
            assert error['details']['partialStdout']==str(raw[sink].partialStdout) and error['details']['unknown']==raw[sink].unknown
        if mode=='ok':
            info=delivery[sink];p=Path(info['path']);data=p.read_bytes()
            assert info['status']=='written' and info['bytes']==len(data) and info['sha256']==hashlib.sha256(data).hexdigest()
            saved=json.loads(data)
            if sink=='proof':assert saved['terminalReleaseProved'] is False
            if not qualified:assert saved['terminalReleaseProved'] is False
    if compact:
        assert delivery['packet']['completeObservations'] is False
        if qualified:assert json.loads(Path(delivery['packet']['path']).read_text())['completeTerminalSummary']['sha256']==delivery['proof']['sha256']
    assert signal.getitimer(signal.ITIMER_REAL)[0]==0
    results.append(dict(name=name,status='PASS',compactEnvelopeFixture=compact,events=events,details=value))

for proof,packet in itertools.product(['ok','raise','after','corrupt','cancel','deadline'],repeat=2):scenario(proof,packet)
for proof,packet in [('read-fail','ok'),('ok','read-fail'),('read-fail','read-fail')]:scenario(proof,packet)
for proof in ['ok','raise']:scenario(proof,'ok',True)
with (root/'results.json').open('x') as f:json.dump(dict(status='PASS',count=len(results),controls=results),f,indent=2)
print(json.dumps(dict(status='PASS',count=len(results),nativeJobs=0,liveCapacityObservations=0)))
