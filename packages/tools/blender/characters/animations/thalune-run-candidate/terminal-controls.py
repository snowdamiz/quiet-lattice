"""Exercise actual CLI -> dispatcher -> adapter -> bounded sinks with inert OS facts."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import argparse,hashlib,io,json,subprocess,tempfile
from pathlib import Path
from types import SimpleNamespace
from contextlib import contextmanager
from unittest.mock import patch
import caller,contract,release_accounting as release

native=[]
def refuse(*args,**kwargs):native.append(str(args));raise AssertionError('Native execution forbidden')
subprocess.Popen=refuse
@contextmanager
def deadline(seconds):yield

def cases():
    result=[dict(name=f'{payload}-proof-{proof}-packet-{packet}',payload=payload,proof=proof,packet=packet)
            for payload in ['start','cleanup','small-audit','large-audit'] for proof in ['ok','fail'] for packet in ['ok','fail']]
    result.extend([
        dict(name='large-error-proof-fail',payload='large-error',proof='fail'),
        dict(name='happy-five',payload='happy'),
        dict(name='first-refused-audit-recovers',payload='recover'),
        dict(name='partial-proof-write',proof='partial'),
        dict(name='mismatched-proof-write',proof='mismatch'),
        dict(name='partial-packet-write',packet='partial'),
        dict(name='mismatched-packet-write',packet='mismatch'),
        dict(name='disk-observation-failure',metrics=True),
        dict(name='stdout-fails',proof='fail',packet='fail',stdout='fail'),
        dict(name='stdout-short-write',proof='fail',packet='fail',stdout='short'),
        dict(name='stdout-flush-fails',proof='fail',packet='fail',stdout='flush'),
        dict(name='all-sinks-fail',proof='fail',packet='fail',stdout='fail',stderr='fail'),
        dict(name='large-stdout-fails',payload='large-audit',proof='fail',packet='fail',stdout='fail'),
        dict(name='large-all-sinks-fail',payload='large-audit',proof='fail',packet='fail',stdout='fail',stderr='fail'),
    ])
    return result

class Stream(io.StringIO):
    def __init__(self,mode,name):super().__init__();self.mode=mode;self.name=name;self.writes=0
    def write(self,text):
        self.writes+=1
        if self.mode=='fail':raise OSError(self.name.upper()+'_WRITE_FAILURE')
        if self.mode=='short':super().write(text[:10]);return 10
        return super().write(text)
    def flush(self):
        if self.mode=='flush':raise OSError(self.name.upper()+'_FLUSH_FAILURE')
        return super().flush()

def scenario(case,root,ready):
    packet=root/'packet';proof=root/'proof';packet.mkdir();proof.mkdir()
    local={**ready,'packetRoot':str(packet),'proofRoot':str(proof),'tsxImport':'/inert/tsx','process_binary_sha256':{}}
    config=root/'input-readiness.json';config.write_text(json.dumps(local))
    payload=case.get('payload','start');large=payload=='large-audit'
    start_error=payload in ['start','cleanup','large-error']
    original='ORIGINAL_START_FAILURE'+('x'*140000 if payload=='large-error' else '')
    starts=[];sink_attempts={'proof':0,'packet':0};registrations=[];captured={}
    class Job:
        def __init__(self,out,argv,checkout,**kwargs):
            self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.target='inert';self.coalition_id=123
            self.known={'51':{'birth':[1,2],'unknownRecorded':{'id':99}}};self.state={'exits':{'capture':0}}
        def save(self):pass
        def start(self):
            starts.append(self.out.parent.name)
            if start_error:raise RuntimeError(original)
        def wait(self,*args):return 'completed'
        def members(self):return []
        def drain(self,*args):
            if payload=='cleanup':raise RuntimeError('CLEANUP_DRAIN_FAILURE')
            return {'drained':True,'clean':True,'unknownDrain':{'id':77}}
        def archive(self,**kwargs):self.scratch.rmdir();caller.write(self.out/'profile_release.json',{'all_absent':True})
    def allocate(path):private=path.parent/'private';private.mkdir();return private,{'unknownAllocation':23}
    def preserve(private,*args,**kwargs):private.rmdir();return {'all_bytes_preserved':True,'namespace_removed':True}
    def registration(*args,**kwargs):
        registrations.append(True)
        failed=payload in ['small-audit','large-audit'] or (payload=='recover' and len(registrations)==1)
        return SimpleNamespace(returncode=0 if failed else 1,stdout='RAW_REGISTRATION_OUTPUT',stderr='RAW_REGISTRATION_ERROR')
    adapter=caller.StationAdapter.__new__(caller.StationAdapter);adapter.ready=local;adapter.grant={'authorizationId':'inert'}
    adapter.core=SimpleNamespace(deadline=deadline,StationJob=Job,coalition_members=lambda _:[],
        kernel_tasks=lambda _:dict(live=0,coalition_absent=True,unknownKernel={'raw':91,'extra':'x'*140000 if large else None}),
        identity=lambda _:dict(birth=[2,3],unknownIdentity=73))
    adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=preserve,executable_path=refuse)
    adapter.support=SimpleNamespace(StageReceipts=lambda *a:SimpleNamespace(observe=lambda:None,require_browser=lambda:None))
    adapter.inspect=lambda *a:{'accepted':True};adapter.inspect_packet=lambda *a:None
    actual_sequence=caller.run_sequence;actual_write=caller.write;actual_save=release.save;actual_packet=release.budget.write_json
    def write(path,value):
        if payload not in ['happy','recover']:
            if Path(path).name=='receipt.json' and 'ownedAllocation' in value:raise OSError('FINAL_RECEIPT_WRITE_FAILURE')
            if Path(path).name=='returned-receipts.json':raise OSError('RETURNED_RECEIPTS_WRITE_FAILURE')
        return actual_write(path,value)
    def save(path,value):
        sink_attempts['proof']+=1;mode=case.get('proof','ok')
        if mode=='fail':raise OSError('TERMINAL_PROOF_WRITE_FAILURE')
        if mode=='partial':Path(path).write_text('{partial');raise OSError('TERMINAL_PROOF_PARTIAL_WRITE_FAILURE')
        if mode=='mismatch':return actual_save(path,{'wrong':True})
        return actual_save(path,value)
    def packet_write(packet_root,path,value,**kwargs):
        sink_attempts['packet']+=1;mode=case.get('packet','ok')
        assert len(release.encode(value))<=release.budget.RECORD_BYTES
        if mode=='fail':raise OSError('TERMINAL_PACKET_WRITE_FAILURE')
        if mode=='partial':Path(path).write_text('{partial');raise OSError('TERMINAL_PACKET_PARTIAL_WRITE_FAILURE')
        if mode=='mismatch':return actual_packet(packet_root,path,{'wrong':True},**kwargs)
        return actual_packet(packet_root,path,value,**kwargs)
    def sequence(*args,**kwargs):
        result=actual_sequence(*args,**kwargs,writer=write);captured['result']=result;return result
    stdout=Stream(case.get('stdout','ok'),'stdout');stderr=Stream(case.get('stderr','ok'),'stderr');raised=None
    disk=release.shutil.disk_usage
    def disk_usage(path):
        if case.get('metrics'):raise OSError('FREE_SPACE_READ_FAILURE')
        return disk(path)
    with patch.object(caller,'READY',config),patch.object(caller,'consume',lambda *a:{'authorizationId':'inert'}),\
         patch.object(caller,'StationAdapter',lambda *a:adapter),patch.object(caller,'verify_runtime',lambda *a:None),\
         patch.object(caller,'run_sequence',sequence),patch.object(caller,'write',write),\
         patch.object(subprocess,'run',registration),patch.object(release,'save',save),\
         patch.object(release.budget,'write_json',packet_write),patch.object(release.shutil,'disk_usage',disk_usage),\
         patch.object(sys,'argv',['caller.py','--execute','--grant','inert']),\
         patch.object(sys,'stdout',stdout),patch.object(sys,'stderr',stderr):
        try:code=caller.main()
        except caller.TerminalDeliveryError as error:raised=error;code=1
    assert 'result' in captured,'Dispatcher failed to return complete evidence'
    result=captured['result'];text=json.dumps(result);delivery=result['terminalDelivery']
    assert sink_attempts=={'proof':1,'packet':1},'One failure must not bypass another sink, or cause retries'
    assert stdout.writes==1 and stderr.writes==(1 if case.get('stdout','ok')!='ok' else 0)
    proof_ok=case.get('proof','ok')=='ok';packet_ok=case.get('packet','ok')=='ok'
    assert delivery['proof']['status']==('written' if proof_ok else 'failed')
    assert delivery['packet']['status']==('written' if packet_ok else 'failed')
    assert delivery['completeObservationsPersisted']==(proof_ok or (packet_ok and not large and payload!='large-error'))
    failures={e['sink']:e for e in result['terminalPersistenceFailures']}
    assert ('proof' in failures)==(not proof_ok) and ('packet' in failures)==(not packet_ok)
    if payload=='happy':
        assert code==0 and len(starts)==5 and result['status']=='CAPTURED_PENDING_VISUAL_REVIEW' and result['primaryFailure'] is None
    else:
        assert code==1 and len(starts)==1 and result['nativeJobs']==1 and result['status']=='HOLD'
        if start_error:assert result['primaryFailure']['message']==original
        if payload not in ['recover']:
            assert 'FINAL_RECEIPT_WRITE_FAILURE' in text and 'RETURNED_RECEIPTS_WRITE_FAILURE' in text
        if payload=='cleanup':assert result['receiptFallbacks'][0]['receipt']['cleanupFailure']['message']=='CLEANUP_DRAIN_FAILURE'
        if payload=='recover':
            assert result['terminalReleaseProved'] is False and result['terminalAudit'][0]['releaseProved'] is True
            assert result['receiptFallbacks'][0]['receipt']['releaseAudits'][0]['releaseProved'] is False
    assert result['terminalAudit'][0]['kernel']['unknownKernel']['raw']==91
    assert result['terminalAudit'][0]['registrationStdout']=='RAW_REGISTRATION_OUTPUT'
    assert result['terminalAudit'][0]['births'][0]['recorded']['unknownRecorded']['id']==99
    if large:assert result['terminalAudit'][0]['kernel']['unknownKernel']['extra']=='x'*140000
    if case.get('metrics'):assert 'FREE_SPACE_READ_FAILURE' in text
    if packet_ok:
        record=json.loads((packet/'integration-result.json').read_text())
        if 'completeTerminalSummary' in record:
            assert proof_ok
            assert record['completeTerminalSummary']['sha256']==hashlib.sha256((proof/'result.json').read_bytes()).hexdigest()
        if not proof_ok:assert 'completeTerminalSummary' not in record
        if large or payload=='large-error':
            assert record['observationsIncluded'] is False and record['completeObservationsPersisted']==proof_ok
        elif start_error:
            assert record['primaryFailure']['message']==original
            if not proof_ok:assert any(f['sink']=='proof' for f in record['terminalPersistenceFailures'])
    if case.get('proof')=='partial':assert (proof/'result.json').read_text()=='{partial'
    if case.get('packet')=='partial':assert (packet/'integration-result.json').read_text()=='{partial'
    if case.get('stdout','ok')=='ok':emitted=json.loads(stdout.getvalue())
    elif case.get('stderr','ok')=='ok':
        emitted=json.loads(stderr.getvalue());assert emitted['terminalDelivery']['stdout']['status']=='failed'
        assert any(f['sink']=='stdout' for f in emitted['terminalPersistenceFailures'])
    else:
        assert raised is not None and raised.result is result
        assert {'stdout','stderr'}<=failures.keys();emitted=None
    if emitted is not None:
        assert emitted['primaryFailure']==result['primaryFailure'] and emitted['terminalAudit']==result['terminalAudit']
        assert emitted['terminalPersistenceFailures']==result['terminalPersistenceFailures']
        assert emitted['receiptFallbacks']==result['receiptFallbacks']
    (root/'CLI.stdout').write_text(stdout.getvalue());(root/'CLI.stderr').write_text(stderr.getvalue())
    # This observer copy records the public structured result; it is not a candidate persistence sink.
    (root/'returned-result-observer.json').write_text(json.dumps(result,indent=2)+'\n')
    assert not native and not any(m in sys.modules for m in ['round4_job_boundary','round4_capture_children','run_round4_browser_proof','run_round4_remaining8'])
    return dict(control=case['name'],pass_=True,root=str(root),cliExitCode=code,structuredException=raised is not None,
                starts=len(starts),sinkAttempts=sink_attempts,completeObservationsPersisted=delivery['completeObservationsPersisted'],
                returnedResultSha256=hashlib.sha256((root/'returned-result-observer.json').read_bytes()).hexdigest())

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args()
    ready=json.loads((contract.HERE/'readiness.json').read_text());root=Path(tempfile.mkdtemp(prefix='thalune-terminal-controls-')).resolve();rows=[]
    for case in cases():out=root/case['name'];out.mkdir();rows.append(scenario(case,out,ready))
    args.report.write_text(json.dumps(dict(status='PASS_ACTUAL_CLI_DISPATCHER_ADAPTER_INERT_SINK_MATRIX',nativeCalls=0,runtimeJobs=0,controls=rows),indent=2)+'\n')
    print(json.dumps(dict(status='PASS',controls=len(rows),nativeCalls=0,root=str(root))))
if __name__=='__main__':main()
