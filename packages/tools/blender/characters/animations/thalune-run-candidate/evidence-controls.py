"""Real adapter + dispatcher adverse controls; OS/StationJob facts are inert injections."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
import caller
import contract

NATIVE_CALLS = []
def refuse(*args, **kwargs):
    NATIVE_CALLS.append(str(args))
    raise AssertionError('Native execution refused by evidence controls')
subprocess.Popen = refuse

@contextmanager
def deadline(seconds):
    yield

CASES = [
    'happy', 'start-final-write', 'start-cleanup-final-write', 'start-both-proof-writes',
    'success-final-write', 'initial-receipt-write', 'registration', 'kernel-live',
    'coalition-present', 'members', 'birth', 'scratch', 'private', 'kernel-read',
    'members-read', 'birth-read', 'registration-read', 'drain-kernel', 'drain-members',
    'oversized-audit',
]

def scenario(mode, root, ready):
    (root/'packet').mkdir(); (root/'proof').mkdir()
    local = {**ready, 'packetRoot':str(root/'packet'), 'proofRoot':str(root/'proof'),
             'tsxImport':'/synthetic/tsx', 'process_binary_sha256':{}}
    starts, counters = [], {'kernel':0, 'members':0}
    start_error = mode in ['start-final-write', 'start-cleanup-final-write', 'start-both-proof-writes']
    write_error = mode in ['start-final-write', 'start-cleanup-final-write', 'start-both-proof-writes', 'success-final-write']
    class Job:
        def __init__(self, out, argv, checkout, **kwargs):
            self.out = out; out.mkdir(); self.scratch = out/'scratch'; self.scratch.mkdir()
            self.target = 'inert'; self.coalition_id = 123
            self.known = {str(pid):{'birth':[11,pid], 'uid':200, 'unknownRecorded':{'pid':pid}} for pid in [51,52]}
            self.state = {'exits':{'capture':0, 'caffeinate':0}}
        def save(self): pass
        def start(self):
            starts.append(self.out.parent.name)
            if start_error: raise RuntimeError('ORIGINAL_START_FAILURE')
        def wait(self, *args): return 'completed'
        def members(self): return []
        def drain(self, *args):
            if mode == 'start-cleanup-final-write': raise RuntimeError('CLEANUP_DRAIN_FAILURE')
            return {'drained':True, 'clean':True, 'unknownDrain':{'preserved':True}}
        def archive(self, **kwargs):
            if mode != 'scratch': self.scratch.rmdir()
            caller.write(self.out/'profile_release.json', {'all_absent':True, 'unknownProfile':[1,None]})
    def allocate(path):
        private = path.parent/'private'; private.mkdir()
        return private, {'synthetic':True, 'unknownAdmission':{'preserved':True}}
    def preserve(private, *args, **kwargs):
        if mode != 'private': private.rmdir()
        return {'all_bytes_preserved':True, 'namespace_removed':True, 'unknownCache':{'preserved':True}}
    def kernel(_):
        counters['kernel'] += 1; count = counters['kernel']
        if mode == 'kernel-read' and count > 1: raise OSError('KERNEL_READ_FAILURE')
        return {'live':1 if mode == 'drain-kernel' or (mode == 'kernel-live' and count > 1) else 0,
                'coalition_absent':mode != 'coalition-present' or count == 1,
                'unknownKernel':{'raw':91, 'read':count, 'extra':'x'*140000 if mode == 'oversized-audit' else [None,False,7]}}
    def members(_):
        counters['members'] += 1; count = counters['members']
        if mode == 'members-read' and count > 1: raise OSError('MEMBERS_READ_FAILURE')
        if mode == 'drain-members' or (mode == 'members' and count > 1):
            return [{'pid':51, 'unknownMember':{'raw':92}}]
        return []
    def identity(pid):
        if mode == 'birth-read' and pid == 52: raise OSError('BIRTH_READ_FAILURE')
        return {'pid':pid, 'birth':[11,pid] if mode == 'birth' else [44,pid], 'unknownIdentity':{'raw':93}}
    def registration(argv, **kwargs):
        if mode == 'registration-read':
            raise subprocess.TimeoutExpired(argv,3,output='PARTIAL_REGISTRATION_OUTPUT',stderr='PARTIAL_REGISTRATION_ERROR')
        return SimpleNamespace(returncode=0 if mode in ['registration','oversized-audit'] else 1,
                               stdout='RAW_REGISTRATION_OUTPUT',stderr='RAW_REGISTRATION_ERROR')
    adapter = caller.StationAdapter.__new__(caller.StationAdapter)
    adapter.ready = local; adapter.grant = {'authorizationId':'synthetic'}
    adapter.core = SimpleNamespace(deadline=deadline, StationJob=Job, coalition_members=members,
                                   kernel_tasks=kernel, identity=identity)
    adapter.temp = SimpleNamespace(create_private_tmp=allocate, preserve_private_tmp=preserve, executable_path=refuse)
    adapter.support = SimpleNamespace(StageReceipts=lambda *a:SimpleNamespace(observe=lambda:None, require_browser=lambda:None))
    adapter.inspect = lambda *args: {'accepted':True}
    adapter.inspect_packet = lambda *args: None
    original_write = caller.write
    def write(path, value):
        name = Path(path).name
        if name == 'receipt.json':
            if mode == 'initial-receipt-write': raise OSError('INITIAL_RECEIPT_WRITE_FAILURE')
            if write_error and ('ownedAllocation' in value): raise OSError('FINAL_RECEIPT_WRITE_FAILURE')
        if mode == 'start-both-proof-writes' and name == 'returned-receipts.json':
            raise OSError('RETURNED_RECEIPTS_WRITE_FAILURE')
        return original_write(path, value)
    with patch.object(caller, 'write', write), patch.object(subprocess, 'run', registration):
        result = caller.run_sequence(local, adapter, root/'packet', root/'proof', writer=write)
    retained = json.loads((root/'proof/result.json').read_text())
    # Proof is the snapshot before sink outcomes; the returned result qualifies those writes separately.
    assert {k:v for k,v in retained.items() if k!='terminalDelivery'} == {k:v for k,v in result.items() if k!='terminalDelivery'}
    assert result['terminalDelivery']['proof']['status'] == result['terminalDelivery']['packet']['status'] == 'written'
    assert result['terminalDelivery']['completeObservationsPersisted'] is True
    text = json.dumps(retained)
    if mode == 'happy':
        assert result['status'] == 'CAPTURED_PENDING_VISUAL_REVIEW' and result['primaryFailure'] is None
        assert len(starts) == result['nativeJobs'] == len(result['terminalAudit']) == 5
        assert result['terminalReleaseProved'] and result['receiptFallbacks'] == []
        assert all(a['registrationStdout'] == 'RAW_REGISTRATION_OUTPUT' and a['releaseProved'] for a in result['terminalAudit'])
    else:
        assert result['status'] == 'HOLD' and result['nativeJobs'] == 1
        assert len(starts) == (0 if mode == 'initial-receipt-write' else 1)
        assert result['primaryFailure']['message'], 'Explicit primary failure required'
        if start_error:
            assert result['primaryFailure']['message'] == 'ORIGINAL_START_FAILURE'
            assert 'FINAL_RECEIPT_WRITE_FAILURE' in text
            assert result['receiptFallbacks'][0]['receipt']['primaryFailure']['message'] == 'ORIGINAL_START_FAILURE'
        if mode == 'start-cleanup-final-write':
            assert result['receiptFallbacks'][0]['receipt']['cleanupFailure']['message'] == 'CLEANUP_DRAIN_FAILURE'
        if mode == 'start-both-proof-writes': assert result['dispatchFailure']['message'] == 'RETURNED_RECEIPTS_WRITE_FAILURE'
        if mode == 'success-final-write': assert result['primaryFailure']['message'] == 'FINAL_RECEIPT_WRITE_FAILURE'
        if mode == 'initial-receipt-write':
            assert 'INITIAL_RECEIPT_WRITE_FAILURE' in text and result['receiptFallbacks'][0]['receipt']['persistenceFailures']
        for audit in result['terminalAudit']:
            if not audit['releaseProved']: assert audit['failure']['message']
        if mode in ['registration','kernel-live','coalition-present','members','birth','scratch','private','oversized-audit']:
            audit = result['terminalAudit'][0]
            assert audit['releaseProved'] is False and audit['kernel']['unknownKernel']['raw'] == 91
            assert audit['registrationStdout'] == 'RAW_REGISTRATION_OUTPUT' and audit['registrationStderr'] == 'RAW_REGISTRATION_ERROR'
            assert audit['births'][0]['recorded']['unknownRecorded']['pid'] == 51
            assert audit['births'][0]['current']['unknownIdentity']['raw'] == 93
            receipt = result['receiptFallbacks'][0]['receipt']
            first = receipt['releaseAudits'][0]
            assert first['failure']['message'] and first['kernel']['unknownKernel']['read'] == 2
            assert audit['kernel']['unknownKernel']['read'] == 3  # Separate observations survive; no overwrite.
        if mode == 'kernel-live': assert result['terminalAudit'][0]['kernel']['live'] == 1
        if mode == 'coalition-present': assert result['terminalAudit'][0]['kernel']['coalition_absent'] is False
        if mode == 'members': assert result['terminalAudit'][0]['members'][0]['unknownMember']['raw'] == 92
        if mode == 'birth': assert 'Recorded process birth remains live' in text
        if mode == 'scratch': assert result['terminalAudit'][0]['scratchAbsent'] is False
        if mode == 'private': assert result['terminalAudit'][0]['privateTmpAbsent'] is False
        if mode in ['kernel-read','members-read','birth-read','registration-read']:
            audit = result['terminalAudit'][0]
            assert audit['releaseProved'] is False
            if mode == 'kernel-read': assert 'KERNEL_READ_FAILURE' in text
            else: assert audit['kernel']['unknownKernel']['raw'] == 91
            if mode == 'birth-read':
                assert audit['births'][0]['current']['unknownIdentity']['raw'] == 93
                assert 'current' not in audit['births'][1] and 'BIRTH_READ_FAILURE' in text
            if mode == 'registration-read':
                assert 'PARTIAL_REGISTRATION_OUTPUT' in text and 'PARTIAL_REGISTRATION_ERROR' in text
        if mode in ['drain-kernel','drain-members']:
            receipt = result['receiptFallbacks'][0]['receipt']
            assert receipt['drainKernel']['unknownKernel']['read'] == 1
            if mode == 'drain-members': assert receipt['drainMembers'][0]['unknownMember']['raw'] == 92
        if mode == 'oversized-audit':
            summary = json.loads((root/'packet/integration-result.json').read_text())
            assert summary['terminalPersistenceFailure']['type'] == 'ReservedTerminalRecordOverflow'
            assert summary['completeTerminalSummary']['sha256'] == hashlib.sha256((root/'proof/result.json').read_bytes()).hexdigest()
            assert summary['completeTerminalSummary']['path'] == str(root/'proof/result.json')
    assert not NATIVE_CALLS
    assert not any(m in sys.modules for m in ['round4_job_boundary','round4_capture_children','run_round4_browser_proof','run_round4_remaining8'])
    return {'control':mode,'pass':True,'root':str(root),'status':result['status'],
            'attempts':result['nativeJobs'],'starts':len(starts),'proofSha256':hashlib.sha256((root/'proof/result.json').read_bytes()).hexdigest()}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--report',type=Path,required=True)
    args = parser.parse_args()
    ready = json.loads((contract.HERE/'readiness.json').read_text())
    root = Path(tempfile.mkdtemp(prefix='thalune-evidence-controls-')).resolve()
    results = []
    for mode in CASES:
        case = root/mode; case.mkdir(); results.append(scenario(mode,case,ready))
    report = {'status':'PASS_REAL_ADAPTER_DISPATCHER_INERT_OS_FACTS','nativeCalls':0,'runtimeJobs':0,'controls':results}
    args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'controls':len(results),'nativeCalls':0,'root':str(root)}))
if __name__ == '__main__': main()
