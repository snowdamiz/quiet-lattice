"""Actual CPU caller exits and receipt sinks, with inert helper observation ports."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import boundary
import caller
import native
from test_boundary import Repo, digest
from test_r2 import graph_decode

HERE = Path(__file__).resolve().parent


def child(root, mode):
    repo = Repo(root); spec, paths, _ = repo.grant(0)
    memory = []; calls = []; trace = []
    def runner(ready, spec, paths, record):
        if mode == 'success':
            def capture(r, s, ps, rec):
                for name in s['files']:
                    (Path(ps['output']) / name).write_text('INERT '+name)
                from observations import Journal
                facts={'phase':'cleanup'};journal=Journal(Path(ps['evidence'])/'helper-observations',facts);journal.finish()
                rec['helperEvidence']=journal.manifest
                trace.append('inert-released')
                return {'released': True}
            def decoder(*_):
                trace.append('inert-decoder')
            memory.append(record)
            return caller.run_unit(ready, spec, paths, record, capture=capture, decoder=decoder,
                cache_copy=lambda r, e, rec: rec.update(initialCacheBytes=0), final_verify=lambda _: {})
        Path(paths['evidence']).mkdir(parents=True)
        evidence = {'helperCalls': []}; record['native'] = evidence
        # The real observation wrapper produces these facts. Native commands,
        # kernel observation and helper ownership/cleanup are not executed here.
        modules = [SimpleNamespace(write=lambda *_: None, coalition=lambda _: None) for _ in range(3)]
        modules[0]._archive_profile_paths = lambda *_: None
        with native.observed_helpers(modules, evidence):
            for pid in range(6800): modules[0].coalition(pid)
        shared = {'future': b'\x00\xff'}
        shared['cycle'] = shared
        evidence.update(allocation={'admission': shared}, privateRelease={'admission': shared},
                        secondaryFailures=[ValueError('OWNED_CLEANUP_FAILURE')], partial={'unknown': b'\xff\x80'})
        trace.append('inert-drain-complete')
        error = AssertionError('UNBOUND_OWNED_EXECUTABLE')
        error.evidence = evidence; error.future = shared
        memory.append(record)
        raise error
    def writer(path, value):
        path = Path(path); calls.append(str(path))
        if path.name.endswith('.consumed.json'): return boundary.exclusive_json(path, value, cap=20*boundary.MIB)
        if mode == 'deadline':
            import time
            with boundary.deadline(.01): time.sleep(.1)
        if mode in ('both', 'all') or (mode == 'fallback' and path.name == 'result.json'):
            if not str(path).endswith('.failure-summary.json') or mode == 'all':
                error = OSError('PUBLICATION_FAILURE '+path.name); error.raw = b'\x00\xfe'; error.self = error
                raise error
        return boundary.exclusive_json(path, value, cap=20*boundary.MIB)
    def emit(data):
        if mode == 'all': raise OSError('STDERR_FAILURE')
        sys.stderr.buffer.write(data)
    real_encoded = caller.encoded
    def encode(value):
        if mode == 'unencodable' and isinstance(value, dict) and value.get('schema') == boundary.RESULT_SCHEMA:
            raise ValueError('INJECTED_COMPLETE_ENCODING_FAILURE')
        return real_encoded(value)
    result = None
    def execute(*args, **kwargs):
        nonlocal result
        code, result = caller.main(repo.ready_path, spec['id'], Path(paths['grant']), enabled=True,
            verifier=lambda _: {}, runner=runner, writer=writer, emit=emit)
        return code, result
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch.object(caller, 'HERE', repo.packet))
        stack.enter_context(patch.object(caller, 'encoded', encode))
        if mode == 'stdout':
            def broken_write(_): raise OSError('STATUS_STDOUT_FAILURE')
            stack.enter_context(patch.object(sys, 'stdout', SimpleNamespace(write=broken_write)))
        code = caller.cli(['--ready', str(repo.ready_path), '--unit', spec['id'], '--grant', paths['grant']], execute=execute)
    record = memory[0]
    if mode == 'success':
        assert code == 0 and result['durable'] and record['released']
        (root/'success.json').write_text(json.dumps({'paths':paths, 'trace':trace}))
        return code
    facts = {'exit': code, 'trace': trace, 'calls': calls, 'paths': paths,
             'primary': str(record['primaryFailure']), 'originalException': isinstance(record['primaryFailure'], AssertionError),
             'shared': record['primaryFailure'].future is record['native']['allocation']['admission'],
             'cyclic': record['primaryFailure'].future['cycle'] is record['primaryFailure'].future,
             'helperCalls': len(record['native']['helperCalls']), 'partialHex': record['native']['partial']['unknown'].hex(),
             'secondary': str(record['native']['secondaryFailures'][0]),
             'persistence': [str(e['error']) for e in record.get('persistenceErrors', [])]}
    if result:
        facts.update(durable=result['durable'], summaryPath=result.get('summaryPath'), metadataBytes=result['metadataBytes'])
        if result['durable']:
            disk, _ = boundary.json_snapshot(result['path'], 20*boundary.MIB)
            facts['completePrimaryEqual'] = disk['primaryFailure'] == boundary.raw(record['primaryFailure'])
            extras = graph_decode(disk['observations'])
            facts['completeHelperEqual'] = extras['native']['helperCalls'] == record['native']['helperCalls']
            facts['completePartialEqual'] = extras['native']['partial']['unknown'] == b'\xff\x80'
            facts['completeAlias'] = extras['native']['allocation']['admission'] is extras['native']['privateRelease']['admission']
            facts['completeCycle'] = extras['native']['allocation']['admission']['cycle'] is extras['native']['allocation']['admission']
    (root/'audit.json').write_text(json.dumps(facts, indent=2)+'\n')
    return code


class PublicationTests(unittest.TestCase):
    def test_actual_cli_zero_exit_can_authenticate_real_receipts_for_successor(self):
        root = Path(tempfile.mkdtemp(prefix='vm-cli-success-', dir=os.environ.get('VM_REVISION_TMP', '/private/tmp'))).resolve()
        argv = [sys.executable, '-B', str(HERE/'test_publication.py'), '--inert-child', str(root), 'success']
        p = subprocess.run(argv, capture_output=True, timeout=30)
        (root/'stdout').write_bytes(p.stdout); (root/'stderr').write_bytes(p.stderr)
        (root/'exit.json').write_text(json.dumps({'argv':argv,'exit':p.returncode}))
        self.assertEqual(p.returncode, 0, p.stdout+p.stderr)
        self.assertEqual(p.stderr, b'')
        facts = json.loads((root/'success.json').read_text())
        self.assertEqual(facts['trace'], ['inert-released','inert-decoder'])
        repo = Repo.__new__(Repo); repo.root=root/'repo'; repo.packet=repo.root/'packet'; repo.ready_path=root/'ready.json'
        repo.ready=json.loads(repo.ready_path.read_text()); repo.plan=json.loads((repo.packet/'inventory.json').read_text())
        repo.head=boundary.git(repo.root,'rev-parse','HEAD').decode().strip()
        repo.previous=[{'unit':'review-thalune','callerExit':p.returncode,
            'resultSha256':digest(Path(facts['paths']['evidence'])/'result.json'),
            'consumptionSha256':digest(facts['paths']['consumption'])}]
        admitted=repo.admit(1)
        self.assertEqual(admitted[1]['id'], 'review-ixari')
        self.assertFalse(Path(admitted[2]['consumption']).exists())

    def process(self, mode):
        root = Path(tempfile.mkdtemp(prefix='vm-publication-', dir=os.environ.get('VM_REVISION_TMP', '/private/tmp'))).resolve()
        argv = [sys.executable, '-B', str(HERE/'test_publication.py'), '--inert-child', str(root), mode]
        p = subprocess.run(argv, capture_output=True, timeout=30)
        (root/'stdout').write_bytes(p.stdout); (root/'stderr').write_bytes(p.stderr)
        (root/'exit.json').write_text(json.dumps({'argv': argv, 'exit': p.returncode}))
        self.assertEqual(p.returncode, 1, p.stdout+p.stderr)
        facts = json.loads((root/'audit.json').read_text())
        self.assertTrue(facts['originalException'] and facts['shared'] and facts['cyclic'])
        self.assertEqual(facts['helperCalls'], 6800)
        self.assertEqual(facts['trace'], ['inert-drain-complete'])
        self.assertEqual(facts['partialHex'], 'ff80')
        self.assertEqual(facts['secondary'], 'OWNED_CLEANUP_FAILURE')
        self.assertTrue(Path(facts['paths']['consumption']).exists())
        return root, p, facts

    def test_actual_exit_full_and_fallback_keep_every_observation_and_error(self):
        for mode in ('full', 'fallback'):
            with self.subTest(mode=mode):
                root, p, facts = self.process(mode)
                self.assertTrue(facts['durable'])
                for key in ('completePrimaryEqual', 'completeHelperEqual', 'completePartialEqual', 'completeAlias', 'completeCycle'):
                    self.assertTrue(facts[key], key)
                self.assertEqual(p.stderr, b'')
                self.assertNotIn(b'SystemExit', p.stdout)
                self.assertEqual(len(facts['persistence']), int(mode == 'fallback'))
                self.assertLessEqual(facts['metadataBytes']['dispatched'], 40*boundary.MIB)

    def test_actual_exit_all_full_sinks_fail_bounded_summary_and_minimal_stderr(self):
        for mode in ('both', 'unencodable'):
            with self.subTest(mode=mode):
                root, p, facts = self.process(mode)
                self.assertFalse(facts['durable'])
                self.assertLessEqual(len(p.stderr), boundary.FAILURE_SUMMARY_CAP)
                summary, _ = boundary.json_snapshot(facts['summaryPath'], boundary.FAILURE_SUMMARY_CAP)
                self.assertFalse(summary['completeRecordDurable'])
                self.assertEqual(summary['primaryFailure']['messagePrefix'], 'UNBOUND_OWNED_EXECUTABLE')
                self.assertEqual(summary['secondaryFailurePrefixes'][0]['messagePrefix'], 'OWNED_CLEANUP_FAILURE')
                self.assertEqual(summary['persistenceErrorCount'], 2)
                self.assertEqual(json.loads(p.stdout)['durable'], False)

    def test_actual_exit_all_sinks_keeps_memory_without_durable_claim(self):
        root, p, facts = self.process('all')
        self.assertFalse(facts['durable']); self.assertIsNone(facts['summaryPath'])
        self.assertEqual(len(facts['persistence']), 4)
        self.assertEqual(p.stderr, b'')
        self.assertEqual(json.loads(p.stdout)['durable'], False)
        self.assertFalse((Path(facts['paths']['evidence'])/'result.json').exists())

    def test_actual_exit_deadline_stops_later_sink_dispatch_and_keeps_primary(self):
        root, p, facts = self.process('deadline')
        self.assertEqual(len(facts['calls']), 2)  # consumption + interrupted result
        self.assertLessEqual(len(p.stderr), boundary.FAILURE_SUMMARY_CAP)
        summary = json.loads(p.stderr)
        self.assertEqual(summary['primaryFailure']['messagePrefix'], 'UNBOUND_OWNED_EXECUTABLE')
        self.assertFalse(summary['completeRecordDurable'])
        self.assertEqual(summary['persistenceErrorPrefixes'][0]['type'], 'DeadlineExpired')
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)

    def test_actual_exit_late_stdout_failure_retains_original_and_secondary(self):
        root, p, facts = self.process('stdout')
        self.assertEqual(p.stdout, b'')
        self.assertTrue(facts['durable'])
        summary = json.loads(p.stderr)
        self.assertEqual(summary['primaryFailure']['messagePrefix'], 'UNBOUND_OWNED_EXECUTABLE')
        self.assertEqual(summary['persistenceErrorPrefixes'][0]['messagePrefix'], 'STATUS_STDOUT_FAILURE')
        self.assertFalse(summary['accepted'])

    def test_snapshot_writer_and_reserved_summary_have_hard_size_limits(self):
        root = Path(tempfile.mkdtemp(prefix='vm-publication-size-', dir=os.environ.get('VM_REVISION_TMP', '/private/tmp'))).resolve()
        data = b'x'*32
        with self.assertRaises(ValueError): boundary.exclusive_bytes(root/'too-big', data, 31)
        self.assertFalse((root/'too-big').exists())
        self.assertEqual(boundary.exclusive_bytes(root/'exact', data, 32), hashlib.sha256(data).hexdigest())
        error = OSError('x'*100000)
        summary = boundary.encoded(boundary.failure_summary({'primaryFailure': error, 'persistenceErrors':[{'error':error}]*100}))
        self.assertLessEqual(len(summary), boundary.FAILURE_SUMMARY_CAP)
        escaped = {'type': '\x00'*100000, 'message': '\x00'*100000}
        summary = boundary.encoded(boundary.failure_summary({'primaryFailure': escaped,
            'secondaryFailures':[escaped]*2, 'persistenceErrors':[{'error':escaped}]*4}))
        self.assertLessEqual(len(summary), boundary.FAILURE_SUMMARY_CAP)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--inert-child':
        raise SystemExit(child(Path(sys.argv[2]), sys.argv[3]))
    unittest.main()
