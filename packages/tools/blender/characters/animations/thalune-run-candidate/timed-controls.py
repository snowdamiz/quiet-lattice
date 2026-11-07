"""Real retained SIGALRM/allocation/archive bodies; native process boundaries are inert."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import argparse, ast, contextlib, hashlib, io, json, os, signal, subprocess, tempfile, time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import caller, contract, release_accounting

NATIVE = []
def refuse(*args, **kwargs):
    NATIVE.append(str(args)); raise AssertionError('Native launch forbidden')

def retained(name, excluded, injected):
    path = contract.HERE/'retained-station'/name
    tree = ast.parse(path.read_text(), filename=str(path))
    tree.body = [node for node in tree.body if not isinstance(node, ast.ImportFrom) or node.module not in excluded]
    values = {'__name__':'inert_retained_body', '__file__':str(path), **injected}
    exec(compile(tree, str(path), 'exec'), values)
    return values

def scenario(mode, ready):
    root = Path(tempfile.mkdtemp(prefix='t02-time-', dir='/tmp')).resolve()
    packet, proof = root/'packet', root/'proof'; packet.mkdir(); proof.mkdir()
    events, starts, timer_events = [], [], []
    core = retained('round4_job_boundary.py', {'round4_capture_children'},
                    dict(identity=lambda _:None, LIBPROC=None, UnsafeCaptureGroup=RuntimeError))
    core['kernel_tasks'] = lambda _:dict(live=0, coalition_absent=True, unknownKernel={'preserved':77})
    core['coalition_members'] = lambda _:[]
    original_write = caller.write
    fired = False
    def expire(label):
        nonlocal fired
        fired = True; timer_events.append(dict(label=label, armedBefore=signal.getitimer(signal.ITIMER_REAL)[0]))
        assert timer_events[-1]['armedBefore'] > 0
        try: time.sleep(2)
        except core['DeadlineExpired']:
            timer_events[-1]['remainingAfterSignal'] = signal.getitimer(signal.ITIMER_REAL)[0]
            raise
        raise AssertionError('Real deadline did not interrupt blocking persistence')
    def write(path, value):
        path = Path(path)
        if mode=='capture-receipt-deadline' and not fired and path.name=='receipt.json' and 'exits' in value and 'ownedAllocation' not in value:
            expire('capture receipt')
        if mode=='observer-receipt-deadline' and not fired and path.name=='receipt.json' and value.get('actualExecutables'):
            expire('observer receipt')
        if mode=='cleanup-archive-deadline' and path.name=='unload.json' and not fired:
            expire('archive observation write')
        if mode=='final-receipt-after-bytes' and path.name=='receipt.json' and 'ownedAllocation' in value:
            original_write(path, value); raise OSError('FINAL_RECEIPT_CLOSE_AFTER_BYTES')
        if mode.startswith('allocation') and path.name=='private-tmp-admission.json':
            private = Path(value['path']); (private/'retained-allocation.txt').write_text('retain this allocation')
            error = OSError('ALLOCATION_PROOF_FAILURE'); error.unknownAllocation = {'raw':91}; raise error
        return original_write(path, value)
    core['write'] = write
    timeout = subprocess.TimeoutExpired(['inert','launchctl'], 3, output=b'PARTIAL\x00\xffSTDOUT', stderr=b'PARTIAL\x80STDERR')
    timeout.unknownObservation = {'raw':[None,False,{'value':83}]}
    def command(argv, **kwargs):
        events.append(dict(kind=argv[1], afterExpiry=fired, timer=signal.getitimer(signal.ITIMER_REAL)[0]))
        if mode=='archive-timeout' and argv[1]=='bootout': raise timeout
        if mode.startswith('terminal-timeout') and argv[1]=='print' and not any(e['kind']=='tmp-preserved' for e in events):
            return SimpleNamespace(returncode=1,stdout='archive check',stderr='')
        if mode.startswith('terminal-timeout') and argv[1]=='print': raise timeout
        return SimpleNamespace(returncode=1, stdout='RAW_COMMAND_RETURN', stderr='RAW_COMMAND_ERROR')
    core['subprocess'] = SimpleNamespace(run=command, Popen=refuse)
    temp = retained('run_round4_browser_proof.py', {'round4_job_boundary'},
                    {name:core[name] for name in ['StationJob','deadline','identity','coalition','LIBPROC','write','kernel_tasks','SUPPORTED_PROFILE_PREFIXES']})
    temp['PRIVATE_TMP_POLICY'] = {**temp['PRIVATE_TMP_POLICY'], 'parent':str(root)}
    actual_preserve = temp['preserve_private_tmp']
    real_copy = temp['shutil'].copytree
    def copy_private(*args, **kwargs):
        if mode=='cleanup-copy-deadline': expire('private namespace copy')
        return real_copy(*args, **kwargs)
    temp['shutil'] = SimpleNamespace(copytree=copy_private, rmtree=temp['shutil'].rmtree)
    def preserve(*args, **kwargs):
        value = actual_preserve(*args, **kwargs)
        events.append(dict(kind='tmp-preserved', afterExpiry=fired)); return value
    real_deadline = core['deadline']
    @contextlib.contextmanager
    def bounded(seconds):
        with real_deadline(1): yield
    core['deadline'] = bounded
    binary = root/'inert-executable'; binary.write_bytes(b'not executable')
    identity = dict(pid=4321, birth=[1,2], uid=os.getuid(), status=1)
    local = {**ready, 'packetRoot':str(packet), 'proofRoot':str(proof), 'tsxImport':'/inert/tsx',
             'process_binary_sha256':{str(binary):hashlib.sha256(binary.read_bytes()).hexdigest()}}
    entry_exit=0
    if mode=='entry-after-bytes-exit':
        publication=json.loads((contract.HERE/'revision-03/publication-controls.json').read_text())
        assert publication['status']=='PASS_AFTER_BYTES_ENTRY_EXIT'
        assert all(row['exitCode']==1 and row['returnedAccepted'] is False for row in publication['controls'])
        entry_exit=publication['controls'][0]['exitCode']
    class Job(core['StationJob']):
        def __init__(self, out, *args, **kwargs):
            self.out=out; out.mkdir(); self.scratch=out/'scratch'; self.scratch.mkdir()
            (self.scratch/'capture_stdout.txt').write_text('retained scratch log')
            self.target='inert'; self.coalition_id=123; self.known={}; self.registered=True
            self.state=dict(drained=True, clean=True, errors=[], exits={'capture':entry_exit,'caffeinate':0})
        def save(self): pass
        def start(self):
            starts.append(self.out.parent.name)
            if mode.startswith('cleanup') or mode.startswith('terminal-timeout') or mode=='archive-timeout':
                raise RuntimeError('ORIGINAL_CAPTURE_FAILURE')
        def status(self): return {'exits':{}} if mode=='observer-receipt-deadline' else {'exits':self.state['exits']}
        def members(self): return [identity] if mode=='observer-receipt-deadline' else []
        def drain(self, *args):
            events.append(dict(kind='drain', afterExpiry=fired, timer=signal.getitimer(signal.ITIMER_REAL)[0]))
            return dict(drained=True, clean=True)
    adapter=caller.StationAdapter.__new__(caller.StationAdapter);adapter.ready=local;adapter.grant={'authorizationId':'inert'}
    adapter.core=SimpleNamespace(deadline=bounded, StationJob=Job, kernel_tasks=core['kernel_tasks'],
                                 coalition_members=lambda _:[], identity=lambda _:identity if mode=='observer-receipt-deadline' else None)
    adapter.temp=SimpleNamespace(create_private_tmp=temp['create_private_tmp'], preserve_private_tmp=preserve, executable_path=lambda _:str(binary))
    adapter.support=SimpleNamespace(StageReceipts=lambda *a:SimpleNamespace(observe=lambda:None,require_browser=lambda:None))
    adapter.inspect=lambda *a:{'accepted':True};adapter.inspect_packet=lambda *a:None
    actual_save=release_accounting.save
    def save(path, value):
        if mode=='terminal-proof-after-bytes':actual_save(path,value);raise OSError('TERMINAL_PROOF_CLOSE_AFTER_BYTES')
        if mode.endswith('all-sinks'):raise OSError('TERMINAL_PROOF_FAILURE')
        return actual_save(path,value)
    packet_write=release_accounting.budget.write_json
    def save_packet(*args, **kwargs):
        if mode.endswith('all-sinks'):raise OSError('TERMINAL_PACKET_FAILURE')
        return packet_write(*args, **kwargs)
    actual_sequence = caller.run_sequence; captured = {}
    def sequence(*args, **kwargs):
        captured['result'] = actual_sequence(*args, **kwargs, writer=write); return captured['result']
    class Stream(io.StringIO):
        def write(self, text):
            if mode.endswith('all-sinks'): raise OSError('CLI_STREAM_FAILURE')
            return super().write(text)
    config=root/'ready.json';config.write_text(json.dumps(local));stdout=Stream();stderr=Stream();structured=None
    with patch.object(caller,'write',write),patch.object(subprocess,'run',command),patch.object(subprocess,'Popen',refuse),\
         patch.object(release_accounting,'save',save),patch.object(release_accounting.budget,'write_json',save_packet),\
         patch.object(caller,'run_sequence',sequence),patch.object(caller,'READY',config),\
         patch.object(caller,'consume',lambda *a:{'authorizationId':'inert'}),patch.object(caller,'verify_runtime',lambda *a:None),\
         patch.object(caller,'StationAdapter',lambda *a:adapter),patch.object(sys,'argv',['caller.py','--execute','--grant','inert']),\
         patch.object(sys,'stdout',stdout),patch.object(sys,'stderr',stderr):
        try:code=caller.main()
        except caller.TerminalDeliveryError as error:structured=error;code=1
    result=captured['result']; assert code==1
    if structured is not None:assert structured.result is result
    else:assert json.loads(stdout.getvalue())['primaryFailure']==result['primaryFailure']
    assert not NATIVE and signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
    text=json.dumps(result); receipts=json.loads((proof/'returned-receipts.json').read_text()) if (proof/'returned-receipts.json').exists() else {}
    receipt=next(iter(receipts.values()),{})
    assert result['status']=='HOLD' and result['nativeJobs']==(5 if mode=='terminal-proof-after-bytes' else 1)
    assert len(starts)==(0 if mode.startswith('allocation') else 5 if mode=='terminal-proof-after-bytes' else 1)
    if 'deadline' in mode:
        assert fired and 'DeadlineExpired' in json.dumps(receipt)
        if mode.startswith('cleanup'):
            assert receipt['primaryFailure']['message']=='ORIGINAL_CAPTURE_FAILURE'
            assert receipt['cleanupFailure']['type']=='DeadlineExpired'
            assert not any(e['kind']=='tmp-preserved' for e in events)
            if mode=='cleanup-archive-deadline':assert (proof/'jobs'/contract.CAPTURE_IDS[0]/'owned-job/scratch/capture_stdout.txt').exists()
    if mode.startswith('allocation'):
        details=receipt['primaryFailure']['details']; assert details['unknownAllocation']=={'raw':91}
        recovery=details['private_tmp_allocation']; assert recovery['released'] is False and Path(recovery['path']).is_dir()
        assert (Path(recovery['path'])/'retained-allocation.txt').read_text()=='retain this allocation'
        assert recovery['cleanup_failure'] and recovery['identity_at_allocation']['uid']==os.getuid()
        assert result['receiptFallbacks'][0]['receipt']['primaryFailure']['details']==details
    if 'timeout' in mode:
        details=receipt['cleanupFailure']['details']
        assert ast.literal_eval(details['output'])==timeout.output and ast.literal_eval(details['stderr'])==timeout.stderr
        assert receipt['primaryFailure']['message']=='ORIGINAL_CAPTURE_FAILURE'
        assert 'unknownObservation' in text and 'unknownObservation' in json.dumps(receipt)
        assert receipt['cleanupFailure']['details']['unknownObservation']==timeout.unknownObservation
        retained_details=result['receiptFallbacks'][0]['receipt']['cleanupFailure']['details']
        assert ast.literal_eval(retained_details['output'])==timeout.output and ast.literal_eval(retained_details['stderr'])==timeout.stderr
        assert retained_details['unknownObservation']==timeout.unknownObservation
    if mode=='final-receipt-after-bytes':
        assert result['primaryFailure']['message']=='FINAL_RECEIPT_CLOSE_AFTER_BYTES'
        assert result['receiptFallbacks'][0]['receipt']['persistenceFailures']
    if mode=='entry-after-bytes-exit':
        assert receipt['exits']['capture']==1 and receipt['primaryFailure'] is not None
    if mode=='terminal-proof-after-bytes':
        snapshot=json.loads((proof/'result.json').read_text());assert snapshot['status']=='CAPTURED_PENDING_VISUAL_REVIEW'
        assert result['terminalDelivery']['proof']['status']=='failed' and result['terminalDelivery']['packet']['status']=='written'
    if mode.endswith('all-sinks'):
        assert result['terminalDelivery']['completeObservationsPersisted'] is False
        assert {f['sink'] for f in result['terminalPersistenceFailures']}=={'proof','packet','stdout','stderr'}
        assert structured is not None
    (root/'returned-result-observer.json').write_text(json.dumps(result,indent=2)+'\n')
    return dict(case=mode,status='PASS',root=str(root),cliExitCode=code,structuredException=structured is not None,starts=starts,events=events,timers=timer_events,
                resultSha256=hashlib.sha256((root/'returned-result-observer.json').read_bytes()).hexdigest())

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args()
    ready=json.loads((contract.HERE/'readiness.json').read_text())
    modes=['capture-receipt-deadline','observer-receipt-deadline','cleanup-archive-deadline','cleanup-copy-deadline',
           'allocation-proof-error','allocation-all-sinks','archive-timeout','terminal-timeout','terminal-timeout-all-sinks',
           'final-receipt-after-bytes','terminal-proof-after-bytes','entry-after-bytes-exit']
    rows=[scenario(mode,ready) for mode in modes]
    args.report.write_text(json.dumps(dict(status='PASS_REAL_TIMERS_EXACT_HELPER_BODIES',controls=rows,nativeCalls=0),indent=2)+'\n')
    print(json.dumps(dict(status='PASS',controls=len(rows),nativeCalls=0)))

if __name__=='__main__':main()
