"""Native-shaped failure replay: actual helper bodies and one harmless owned CPU child."""
import sys
from pathlib import Path
D = Path(__file__).resolve().parent
sys.path.insert(0, str(D))
import ast, contextlib, copy, datetime, json, os, re, signal, subprocess, tempfile, time, shutil, stat
from types import SimpleNamespace
from unittest.mock import patch
import caller, controls, contract, evidence, native_ports, bindings
from revision_controls import extract
import unittest
import hashlib
import apple_encoder

def replay(mode='normal'):
    run = Path(tempfile.mkdtemp(prefix='effects-native-failure-control-', dir='/private/tmp'))
    f = controls.Fixture(run)
    fixture = json.loads((D / 'native_failure_fixture.json').read_text())
    b = fixture['boundary']
    obs = fixture['observed']
    old = json.loads((D / 'readiness.json').read_text())
    old['runtimeEnabled'] = True
    old['process_binary_sha256'].pop(obs['processes'][-1]['binary'], None)
    pids = fixture['pidInventory']
    f.ready.update({k: v for k, v in old.items() if k not in ('root', 'pilot', 'generatedCaches', 'budget')})
    controls.put(f.ready_path, f.ready)
    f.grant['readinessSha256'] = contract.sha(f.ready_path)
    controls.put(f.paths['grant'], f.grant)
    child = subprocess.Popen([sys.executable, '-B', '-c', 'import sys;sys.stdin.buffer.read()'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    state = {'spawnedChild': child.pid, 'probeCalls': 0}
    primary = obs['processes'][-1]['binary']
    held = {int(k): v for k, v in b['identities'].items()}
    scratch = run / 'scratch'
    scratch.mkdir()
    (scratch / 'capture_stdout.txt').write_bytes(fixture['captureLog'].encode())

    def released():
        state['rootReleased'] = state.get('rootReleased', False) or (scratch / 'release').exists()
        return state['rootReleased']

    def live(pid):
        return pid == b['root']['pid'] and (not released()) or (pid != b['root']['pid'] and child.poll() is None and (scratch / 'go').exists())

    def identity(pid):
        return copy.deepcopy(held[pid]) if pid in held and live(pid) else None

    def coalition(pid):
        state['probeCalls'] += 1
        return b['identities'][str(pid)]['coalition'] if pid in held and live(pid) else [87654, 87655]

    def kernel_tasks(_):
        if child.poll() is not None and (not released()) and (state.get('kernelPending', 0) < 2):
            state['kernelPending'] = state.get('kernelPending', 0) + 1
            return {'live': 3, 'coalition_absent': False}
        return {'live': int(not released()) + sum((live(pid) for pid in held if pid != b['root']['pid'])), 'coalition_absent': released()}

    def kill(pid, sig):
        assert pid in held and pid != b['root']['pid']
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=3)

    def write(path, value):
        if mode == 'archive-fail' and Path(path).name == 'profile_release.json':
            raise OSError(28, 'ARCHIVE_RECEIPT_FAILURE')
        controls.put(path, value)
    namespace = extract('round4_job_boundary.py', ['StationJob', 'coalition_members', 'deadline', 'DeadlineExpired', '_archive_profile_paths'], {'os': SimpleNamespace(**{**vars(os), 'kill': kill}), 'signal': signal, 'time': time, 'json': json, 'Path': Path, 'contextmanager': contextlib.contextmanager, 'write': write, 'identity': identity, 'coalition': coalition, 'kernel_tasks': kernel_tasks, 'user_pids': lambda: list(dict.fromkeys([*pids, *held])), 'UnsafeCaptureGroup': RuntimeError, 'subprocess': SimpleNamespace(run=lambda *a, **kw: subprocess.CompletedProcess(a[0], 113 if 'print' in a[0] else 0, '', 'Could not find service' if 'print' in a[0] else '')), 'shutil': shutil, 're': re, 'stat': stat, 'SUPPORTED_PROFILE_PREFIXES': ('playwright_chromiumdev_profile-',)})
    real_status = namespace['StationJob'].status

    def status(self):
        controls.put(self.scratch / 'worker.json', {'launch_complete': True, 'exits': {} if child.poll() is None else {'capture': child.returncode, 'caffeinate': -15}})
        return real_status(self)
    namespace['StationJob'].status = status
    sns = extract('run_round4_remaining8.py', ['StageReceipts'], {'Path': Path, 'time': time, 'os': os, 're': re, 'json': json, 'write': write, 'identity': identity, 'coalition': coalition, 'executable_path': lambda pid: next((x['binary'] for x in obs['processes'] if x['kernel']['pid'] == pid)), 'current_commands': lambda rows: {x['pid']: 'owned replay' for x in rows}, 'parse_launch': lambda *args: obs['launch'], 'VTENCODER': primary, 'utc': lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()})
    bns = extract('run_round4_browser_proof.py', ['preserve_private_tmp', 'tmp_admission', '_tmp_tree'], {'Path': Path, 'os': os, 'stat': stat, 'shutil': shutil, 'sha': contract.sha, 'kernel_tasks': kernel_tasks, 'SUPPORTED_PROFILE_PREFIXES': ('playwright_chromiumdev_profile-',)})

    def factory(ready, result):
        ready.update(process_binary_sha256=old['process_binary_sha256'], resolver=old['resolver'], initialCacheBytes=0)
        port = native_ports.NativePorts.__new__(native_ports.NativePorts)
        port.ready = ready
        port.result = result
        port.tmp = run / 'private'
        port.tmp.mkdir(mode=448)
        port.admission = bns['tmp_admission'](port.tmp)
        (port.tmp / 'cache').write_bytes(b'RETAINED_BYTES\x00\xff')
        (scratch / 'capture_stdout.txt').write_text((scratch / 'capture_stdout.txt').read_text().replace('/private/tmp/sbr-fbnx3i_z', str(port.tmp)))
        obs['launch']['profile'] = str(port.tmp / 'playwright_chromiumdev_profile-pVLJXu')
        port.browser = SimpleNamespace(**bns)
        port.boundary = SimpleNamespace(StationJob=namespace['StationJob'], kernel_tasks=kernel_tasks, identity=identity)
        port.stages = SimpleNamespace(StageReceipts=sns['StageReceipts'])
        port.allocate_tmp = lambda _: (port.tmp, {'inert': True})

        def initialize(job, out, ready_path):
            job.out = out / 'job'
            job.out.mkdir()
            job.scratch = scratch
            job.root = copy.deepcopy(b['root'])
            job.coalition_id = b['coalition_id']
            job.known = {}
            job.registered = True
            job.target = 'INERT_NOT_LAUNCHD'
            controls.put(scratch / 'worker.json', {'root': b['root']})
            job.state = {'exits': {}, 'errors': [], 'signals': [], 'drained': False, 'clean': False}
        port.initialize = initialize
        if mode in ('repeat-observer', 'cleanup-deadline'):
            original = port.observer

            def observer(job):
                value = original(job)
                observe = value.observe
                count = [0]

                def again():
                    count[0] += 1
                    if count[0] > 1:
                        if mode == 'cleanup-deadline':
                            signal.raise_signal(signal.SIGALRM)
                        raise RuntimeError('SECONDARY_CLEANUP_OBSERVATION')
                    return observe()
                value.observe = again
                return value
            port.observer = observer
        return port
    stderr = []

    def writer(path, data):
        if mode.startswith('sinks') and Path(path).name.startswith(('terminal.json', 'result.json', 'failed-result.json')):
            raise OSError(28, 'TERMINAL_SINK_FAILURE')
        return evidence.Receipts.exclusive(path, data)
    sink = evidence.Receipts(writer)

    def emit(data):
        if mode == 'sinks-and-stderr':
            raise OSError(5, 'STDERR_FAILURE')
        stderr.append(data)
    try:
        with patch.object(bindings, 'ROOT', f.root), patch.object(native_ports, 'subprocess', SimpleNamespace(run=lambda *a, **kw: subprocess.CompletedProcess(a[0], 113, '', 'Could not find service'))):
            result = caller.execute(f.ready_path, enabled=True, authorization=f.ready['pilot']['authorizationId'], verify_source=lambda _: f.source, ports_factory=factory, cache_guard=lambda *a: None, stderr=emit, sink=sink)
        measured = {'retainedHostPidCount': len(pids), 'actualAdapterProbeCalls': state['probeCalls'], 'actualChildPid': child.pid, 'actualChildExit': child.poll(), 'resultCompactBytes': len(json.dumps(evidence.raw(result), sort_keys=True).encode()), 'resultPrettyBytes': len((json.dumps(evidence.raw(result), sort_keys=True, indent=2) + '\n').encode()), 'errors': result['errors'], 'actualCallerReturnAccepted': result['accepted'], 'release': result['release'], 'metadataCharged': sum((x.get('bytes', 0) for x in result['metadataAttempts'])), 'stderrBytes': sum(map(len, stderr)), 'terminalExists': (Path(f.paths['evidence']) / 'terminal.json').exists(), 'resultExists': (Path(f.paths['evidence']) / 'result.json').exists(), 'fallbackExists': (Path(f.ready['pilot']['output']) / 'failed-result.json').exists(), 'drained': result['jobs'][0]['stateAfterCleanup'].get('drained'), 'clean': result['jobs'][0]['stateAfterCleanup'].get('clean'), 'run': str(run), 'evidence': f.paths['evidence']}
        measured['charged'] = sink.charged
        measured['stderrPayloads'] = [json.loads(v) for v in stderr]
        measured['memory'] = result
        if measured['resultExists']:
            measured['persisted'] = evidence.capture_snapshot(Path(f.paths['evidence']) / 'result.json')['value']
        measured['scratchAbsent'] = not scratch.exists()
        measured['tmpAbsent'] = not (run / 'private').exists()
        return measured
    finally:
        if child.poll() is None:
            child.stdin.close()
            child.wait(timeout=3)
        for stream in (child.stdin, child.stdout, child.stderr):
            if stream:
                stream.close()
        f.cleanup()
        shutil.rmtree(run)

class NativeFailureControls(unittest.TestCase):

    def test_actual_archive_receipt_failure_retains_primary_and_private_tmp(self):
        r = replay('archive-fail')
        self.assertIsNone(r['release'])
        self.assertFalse(r['tmpAbsent'])
        self.assertIn('Unbound owned executable', r['errors'][0]['message'])
        self.assertTrue(any(('ARCHIVE_RECEIPT_FAILURE' in v.get('message', '') for v in r['errors'])))
        self.assertEqual(r['persisted']['raw'], evidence.raw(r['memory']['raw']))

    def test_encoder_existing_observer_requires_exact_binding_and_owned_identity(self):
        bound = apple_encoder.binding()
        fixture = json.loads((D / 'native_failure_fixture.json').read_text())
        row = fixture['observed']['processes'][-1]['kernel']
        with tempfile.TemporaryDirectory(dir='/private/tmp', prefix='effects-encoder-control-') as tmp:
            for mode in ('bound', 'missing', 'wrong-coalition', 'unknown-executable'):
                root = Path(tmp) / mode
                root.mkdir()
                job = SimpleNamespace(out=root, scratch=root, state={}, members=lambda: [row], coalition_id=41959)
                ns = extract('run_round4_remaining8.py', ['StageReceipts'], {'Path': Path, 'time': time, 'os': os, 're': re, 'write': controls.put, 'identity': lambda _: row, 'coalition': lambda _: [123 if mode == 'wrong-coalition' else 41959, 41960], 'executable_path': lambda _: apple_encoder.PATH if mode != 'unknown-executable' else '/unbound/other-xpc', 'current_commands': lambda _: {row['pid']: 'inert owned executable'}, 'parse_launch': lambda *a: None, 'VTENCODER': apple_encoder.PATH, 'utc': lambda: 'inert-CPU-control'})
                ready = {'resolver': {'selectedExecutable': {'path': '/inert/browser'}}, 'process_binary_sha256': {} if mode == 'missing' else {apple_encoder.PATH: bound['executable']['sha256']}}
                stage = ns['StageReceipts'](job, ready, str(root))
                if mode == 'bound':
                    stage.observe()
                    observed = stage.receipt()['processes'][0]
                    self.assertTrue(observed['admitted'])
                    self.assertEqual(observed['role'], 'apple-video-encoder-xpc')
                    self.assertEqual(observed['prelaunch_sha256'], bound['executable']['sha256'])
                else:
                    with self.assertRaises(AssertionError):
                        stage.observe()

    def test_segmented_late_write_failure_never_accepts_complete_looking_receipt(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp', prefix='effects-late-parts-') as tmp:
            root = Path(tmp)
            out = root / 'packet'
            out.mkdir()

            def late(path, data):
                evidence.Receipts.exclusive(path, data)
                if Path(path).name == 'result.json':
                    raise OSError(5, 'LATE_FINAL_CLOSE')
            result = {'checksPassed': True, 'errors': [], 'raw': {'unknown': None, 'large': 'x' * (2 * contract.MIB)}, 'jobs': []}
            sink = evidence.Receipts(late)
            evidence.publish(result, root, out, sink, lambda _: None)
            self.assertFalse(result['accepted'])
            self.assertFalse(result['durable'])
            first = evidence.capture_snapshot(root / 'result.json')['value']
            self.assertFalse(first['accepted'])
            self.assertIn('LATE_FINAL_CLOSE', evidence.capture_snapshot(out / 'failed-result.json')['value']['errors'][0]['message'])
            self.assertEqual(len(sink.attempts), len({r['path'] for r in sink.attempts}))
            with self.assertRaises(contract.Refused):
                caller.parent_acceptance(root / 'result.json', root / 'absent', observed_os_exit=1, result_sha256=contract.sha(root / 'result.json'), consumption_sha256='0' * 64)

    def test_actual_helper_chain_large_failure_releases_and_preserves_every_observation(self):
        r = replay()
        self.assertFalse(r['actualCallerReturnAccepted'])
        self.assertTrue(r['drained'])
        self.assertFalse(r['clean'])
        self.assertEqual(r['actualChildExit'], -15)
        self.assertTrue(r['release']['released'])
        self.assertFalse(r['release']['captureClean'])
        self.assertTrue(r['scratchAbsent'] and r['tmpAbsent'])
        self.assertTrue(r['terminalExists'] and r['resultExists'])
        self.assertGreater(r['resultPrettyBytes'], contract.MIB)
        self.assertEqual(r['persisted']['raw'], evidence.raw(r['memory']['raw']))
        self.assertEqual(r['persisted']['jobs'], evidence.raw(r['memory']['jobs']))
        self.assertIn('Unbound owned executable', r['persisted']['errors'][0]['message'])
        self.assertLess(r['charged'], contract.METADATA_PER_PROCESS)

    def test_repeated_cleanup_observation_is_retained_without_aborting_owned_drain(self):
        r = replay('repeat-observer')
        self.assertTrue(r['release']['released'])
        self.assertIn('Unbound owned executable', r['errors'][0]['message'])
        self.assertTrue(any((v['phase'] == 'cleanup-observer' for v in r['errors'])))
        self.assertFalse(r['actualCallerReturnAccepted'])

    def test_real_cleanup_alarm_preserves_primary_and_refuses_release(self):
        previous = signal.getsignal(signal.SIGALRM)
        r = replay('cleanup-deadline')
        self.assertIsNone(r['release'])
        self.assertIn('Unbound owned executable', r['errors'][0]['message'])
        self.assertTrue(any((v['phase'] == 'cleanup' for v in r['errors'])))
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_combined_large_publication_failures_emit_small_reserved_summary(self):
        r = replay('sinks')
        self.assertFalse(r['resultExists'] or r['terminalExists'] or r['fallbackExists'])
        self.assertTrue(r['release']['released'])
        self.assertLess(r['stderrBytes'], evidence.FAILURE_SUMMARY_RESERVE)
        self.assertTrue(r['stderrPayloads'][0]['summaryOnly'])
        self.assertIn('Unbound owned executable', r['stderrPayloads'][0]['primaryMessagePrefix'])
        self.assertFalse(r['memory']['durable'])
        self.assertIn('Unbound owned executable', r['memory']['errors'][0]['message'])

    def test_all_sinks_failed_retains_full_memory_without_durable_claim(self):
        r = replay('sinks-and-stderr')
        self.assertEqual(r['stderrBytes'], 0)
        self.assertFalse(r['memory']['durable'])
        self.assertEqual(r['memory']['errors'][-1]['phase'], 'stderr-fallback-write')
        self.assertIn('Unbound owned executable', r['memory']['errors'][0]['message'])
        self.assertGreater(len(r['memory']['raw']['cleanup'][0]['observations']), 1000)

    def test_segment_roundtrip_tamper_same_snapshot_and_type_size_caps(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp', prefix='effects-parts-') as tmp:
            path = Path(tmp) / 'result.json'
            sink = evidence.Receipts()
            original = {'accepted': False, 'raw': {'unknown': None, 'bytes': b'\x00\xff', 'large': 'x' * (2 * contract.MIB)}}
            evidence.write_capture_record(sink, path, original)
            first = evidence.capture_snapshot(path)
            self.assertEqual(first['value'], evidence.raw(original))
            part = path.with_name(first['envelope']['parts'][0]['name'])
            good = part.read_bytes()
            actual = evidence.snapshot

            def replace_after_snapshot(file, *args):
                observed = actual(file, *args)
                if Path(file) == part:
                    part.write_text('{}')
                return observed
            with patch.object(evidence, 'snapshot', replace_after_snapshot):
                self.assertEqual(evidence.capture_snapshot(path)['value'], evidence.raw(original))
            with self.assertRaises(contract.Refused):
                evidence.capture_snapshot(path)
            part.write_bytes(b'x' * (contract.MIB + 1))
            with self.assertRaises(contract.Refused):
                evidence.capture_snapshot(path)
            part.unlink()
            os.mkfifo(part)
            with self.assertRaises(contract.Refused):
                evidence.capture_snapshot(path)
            part.unlink()
            part.write_bytes(good)
            self.assertEqual(evidence.capture_snapshot(path)['value'], evidence.raw(original))
            with self.assertRaises(contract.Refused):
                caller.parent_acceptance(path, Path(tmp) / 'absent', observed_os_exit=1, result_sha256=contract.sha(path), consumption_sha256='0' * 64)

    def test_reserved_summary_and_exact_writer_budget(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp', prefix='effects-summary-') as tmp:
            sink = evidence.Receipts()
            sink.charged = contract.METADATA_PER_PROCESS - evidence.FAILURE_SUMMARY_RESERVE
            with self.assertRaises(contract.Refused):
                sink.write(Path(tmp) / 'refused', {})
            stderr = []
            result = {'checksPassed': False, 'errors': [{'type': 'PRIMARY', 'message': 'original', 'unknown': b'\x00\xff'}], 'raw': {'large': 'x' * (2 * contract.MIB)}, 'jobs': []}
            evidence.publish(result, Path(tmp), Path(tmp), sink, stderr.append)
            self.assertLessEqual(sink.charged, contract.METADATA_PER_PROCESS)
            self.assertTrue(json.loads(stderr[0])['summaryOnly'])
            self.assertFalse(result['durable'])
            self.assertEqual(result['errors'][0]['unknown'], b'\x00\xff')
if __name__ == '__main__':
    unittest.main()
