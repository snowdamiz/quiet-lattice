"""Focused caller controls: no StationJob registration, browser, GPU or asset capture."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

import capture_round4_stage as sequence
import run_round4_remaining8 as caller
import run_round4_browser_proof as temporary

OUT = Path(os.environ['ROUND4_REMAINING8_TEST_OUTPUT']).resolve()
OUT.mkdir(parents=True, exist_ok=False)
ROOTS = []


class FakeJob:
    """Filesystem-only stand-in: no process/service methods call the OS."""
    capture_exit, caff_exit, clean, drained, archive_error = 0, 0, True, True, False
    calls = []
    def __init__(self, out, argv, cwd, capture_seconds, env):
        self.out = Path(out); self.out.mkdir()
        self.scratch = self.out / 'fake_scratch'; self.scratch.mkdir()
        self.private = Path(env['TMPDIR']); ROOTS.append(str(self.private))
        self.target, self.coalition_id, self.known = 'NO_REGISTERED_CPU_FIXTURE', 123, {}
        self.state = {'exits': {'capture': self.capture_exit, 'caffeinate': self.caff_exit},
                      'drained': False, 'clean': False, 'errors': []}
        (self.private / 'tsx-501').mkdir(); (self.private / 'tsx-501/cache').write_bytes(b'nonprofile CPU fixture')
        self.calls.append(('constructor', argv, capture_seconds, env))
    def save(self): pass
    def start(self): self.calls.append(('start',))
    def wait(self, seconds, observer): observer(); return 'completed'
    def drain(self, seconds):
        self.calls.append(('drain', seconds))
        self.state.update(drained=self.drained, clean=self.clean)
        return self.state
    def archive(self, **kwargs):
        self.calls.append(('archive', kwargs))
        if self.archive_error: raise OSError('injected archive error')
        temporary.write(self.out / 'profile_release.json', {'all_absent': True, 'all_owned_profiles': []})
        shutil.rmtree(self.scratch)


class CallerControls(unittest.TestCase):
    def setUp(self):
        self.out = OUT / self._testMethodName; self.out.mkdir()
        FakeJob.capture_exit = FakeJob.caff_exit = 0
        FakeJob.clean = FakeJob.drained = True
        FakeJob.archive_error = False; FakeJob.calls = []
        self.ready = {'stages': caller.original_stages(), 'input_sha256': {}, 'launch_path': os.environ['PATH'],
                      'capture_seconds': 600, 'cleanup_seconds': 60, 'private_tmp_policy': temporary.PRIVATE_TMP_POLICY}
        self.stage = self.ready['stages'][0]

    def tearDown(self):
        # Explicit fixture-only recovery for intentionally unproved cleanup controls.
        for name in ROOTS:
            path = Path(name)
            if path.exists():
                admission = temporary.tmp_admission(path)
                temporary.preserve_private_tmp(path, admission, self.out / ('recovered_' + path.name), no_process_launched=True)
        self.assertTrue(all(not Path(p).exists() for p in ROOTS))
        temporary.write(OUT / 'fixture_audit.json', {'mode': 'NO_PROCESS_NO_BROWSER_FILESYSTEM_CONTROLS',
            'private_roots': ROOTS, 'all_roots_absent': True, 'job_registrations_created': [], 'processes_launched': []})

    def run_fixture(self):
        with patch.object(caller, 'require_stage_admission'), patch.object(caller, 'StageReceipts') as observer, \
             patch.object(caller, 'terminal_audit', return_value={'fixture': 'NO_OS_JOB'}), \
             patch.object(caller, 'inspect_output', return_value={'valid': True}), \
             patch.object(temporary, 'kernel_tasks', return_value={'live': 0}):
            observer.return_value.observe.return_value = None
            return caller.run_stage(self.stage, self.out / 'stage', self.ready, job_factory=FakeJob)

    def test_existing_run_plan_AST_unchanged(self):
        old = sequence.ROOT / 'assets/renders/stations/round4/controller_revise01/freeze02/frozen_sources/capture_round4_stage.py'
        def function(path):
            return next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'run_plan')
        self.assertEqual(ast.dump(function(old)), ast.dump(function(Path(sequence.__file__))))

    def test_exact_eight_plan_and_no_recovered_stage(self):
        caller.validate_plan(self.ready)
        self.assertEqual(len(self.ready['stages']), 8)
        for mutation in ('argv', 'out_path'):
            changed = copy.deepcopy(self.ready)
            if mutation == 'argv': changed['stages'][0]['argv'].append('--different')
            else: changed['stages'][0]['out_path'] += '-different'
            with self.assertRaises(AssertionError): caller.validate_plan(changed)

    def test_absent_grant_refuses_without_any_spawn(self):
        with patch.object(caller, 'GRANT', self.out / 'absent'), patch.object(caller, 'StationJob', side_effect=AssertionError('must not construct')):
            with self.assertRaisesRegex(AssertionError, 'gate closed'): caller.execute()

    def test_direct_stage_requires_consumed_admission_before_allocation(self):
        with patch.object(caller, 'GRANT', self.out / 'absent'), patch.object(caller, 'create_private_tmp', side_effect=AssertionError('must not allocate')):
            result = caller.run_stage(self.stage, self.out / 'stage', self.ready, job_factory=FakeJob)
        self.assertFalse(result['accepted']); self.assertEqual(result['teardown_status'], 'NO_JOB_CREATED')
        self.assertIn('gate closed', result['primary_failure']['message'])
        self.assertEqual(FakeJob.calls, [])

    def test_stage_admission_exact_prior_success_and_one_claim(self):
        grant = {'authorization_id': 'CPU-ONLY-NO-LAUNCH'}
        key = hashlib.sha256(grant['authorization_id'].encode()).hexdigest()
        attempt = self.out / 'consumed_grants' / key; attempt.mkdir(parents=True)
        stage_out = attempt / self.stage['id']; stage_out.mkdir()
        state = {'status': 'ACTIVE_OR_INTERRUPTED_HOLD', 'failure': None, 'authorization_id': grant['authorization_id'],
                 'ordered_plan': self.ready['stages'], 'completed': [], 'current': self.stage['id']}
        temporary.write(attempt / 'attempt.json', state)
        ready_path = self.out / 'ready.json'; temporary.write(ready_path, self.ready)
        with patch.object(caller, 'FREEZE', self.out), patch.object(caller, 'READY', ready_path), \
             patch.object(caller, 'preflight', return_value=(grant, self.ready)):
            caller.require_stage_admission(self.stage, stage_out, self.ready)
            with self.assertRaises(FileExistsError): caller.require_stage_admission(self.stage, stage_out, self.ready)
            state.update(status='PERMANENT_HOLD'); temporary.write(attempt / 'attempt.json', state)
            with self.assertRaises(AssertionError): caller.require_stage_admission(self.stage, stage_out, self.ready)

    def test_sequence_stops_first_failure_and_refuses_reentry(self):
        launched = []
        def run(stage, out): launched.append(stage['id']); return {'accepted': False, 'capture_exit': 7}
        with self.assertRaises(RuntimeError): sequence.run_plan(self.ready, self.out / 'consume', 'grant', run)
        self.assertEqual(launched, [self.stage['id']])
        state = json.loads(next((self.out / 'consume').glob('*/attempt.json')).read_text())
        self.assertEqual(state['status'], 'PERMANENT_HOLD')
        with self.assertRaises(FileExistsError): sequence.run_plan(self.ready, self.out / 'consume', 'grant', run)
        self.assertEqual(len(launched), 1)

    def test_sequence_success_requires_release_before_next(self):
        order = []
        def run(stage, out):
            self.assertEqual(len(order), self.ready['stages'].index(stage)); order.append(stage['id'])
            return {'accepted': True, 'terminal_release': True}
        self.assertEqual(sequence.run_plan(self.ready, self.out / 'consume', 'grant', run)['status'], 'ALL_EIGHT_SUCCEEDED')
        self.assertEqual(order, [s['id'] for s in self.ready['stages']])

    def test_capture_failure_retained_after_clean_release(self):
        FakeJob.capture_exit = 7
        result = self.run_fixture()
        self.assertFalse(result['accepted']); self.assertEqual(result['capture_exit'], 7)
        self.assertEqual(result['teardown_status'], 'DRAINED_AND_ARCHIVED')
        self.assertIn('exit=7', result['primary_failure']['message'])
        self.assertEqual([r[0] for r in FakeJob.calls], ['constructor', 'start', 'drain', 'archive'])

    def test_archive_failure_keeps_capture_primary_and_unproved(self):
        FakeJob.capture_exit = 7; FakeJob.archive_error = True
        result = self.run_fixture()
        self.assertEqual(result['capture_exit'], 7)
        self.assertIn('exit=7', result['primary_failure']['message'])
        self.assertEqual(result['teardown_status'], 'UNPROVED')
        self.assertIn('archive error', result['teardown_failure']['message'])

    def test_clean_capture_archives_cache_before_acceptance(self):
        result = self.run_fixture()
        self.assertTrue(result['accepted']); self.assertEqual(result['caffeinate_exit'], 0)
        self.assertTrue(result['private_tmp_release']['all_bytes_preserved'])
        self.assertEqual((self.out / 'stage/preserved_private_tmp/tsx-501/cache').read_bytes(), b'nonprofile CPU fixture')
        self.assertEqual(FakeJob.calls[0][2], 600)
        self.assertLessEqual(next(r[1] for r in FakeJob.calls if r[0] == 'drain'), 60)

    def test_dirty_or_unobserved_monitor_exit_never_accepts(self):
        for index, changes in enumerate(({'clean': False}, {'caff_exit': 'UNKNOWN'})):
            FakeJob.clean = changes.get('clean', True); FakeJob.caff_exit = changes.get('caff_exit', 0)
            with patch.object(caller, 'require_stage_admission'), patch.object(caller, 'StageReceipts'), \
                 patch.object(caller, 'terminal_audit', return_value={}), patch.object(caller, 'inspect_output', return_value={'valid': True}), \
                 patch.object(temporary, 'kernel_tasks', return_value={'live': 0}):
                result = caller.run_stage(self.stage, self.out / f'stage{index}', self.ready, job_factory=FakeJob)
            self.assertFalse(result['accepted'])

    def test_allocation_failure_retains_exact_unreleased_namespace_truth(self):
        error = OSError('injected allocation persistence')
        error.private_tmp_allocation = {'path': '/CPU-ONLY-NOT-ALLOCATED', 'released': False}
        with patch.object(caller, 'require_stage_admission'), patch.object(caller, 'create_private_tmp', side_effect=error):
            result = caller.run_stage(self.stage, self.out / 'stage', self.ready, job_factory=FakeJob)
        self.assertEqual(result['teardown_status'], 'UNPROVED')
        self.assertEqual(result['private_tmp_allocation_failure'], error.private_tmp_allocation)
        self.assertEqual(result['primary_failure']['message'], 'injected allocation persistence')

    def test_parent_hold_stops_next_stage_before_allocation(self):
        base = self.out / 'base'; base.mkdir(); (base / 'PARENT_HOLD_GPU').touch()
        with patch.object(caller, 'BASE', base), patch.object(caller, 'require_stage_admission'):
            result = caller.run_stage(self.stage, self.out / 'stage', self.ready, job_factory=FakeJob)
        self.assertFalse(result['accepted']); self.assertEqual(FakeJob.calls, [])

    def test_artifact_inspection_failure_prevents_acceptance_after_release(self):
        with patch.object(caller, 'require_stage_admission'), patch.object(caller, 'StageReceipts'), \
             patch.object(caller, 'terminal_audit', return_value={}), \
             patch.object(caller, 'inspect_output', side_effect=ValueError('invalid artifact')), \
             patch.object(temporary, 'kernel_tasks', return_value={'live': 0}):
            result = caller.run_stage(self.stage, self.out / 'stage', self.ready, job_factory=FakeJob)
        self.assertFalse(result['accepted']); self.assertEqual(result['teardown_status'], 'DRAINED_AND_ARCHIVED')
        self.assertEqual(result['primary_failure']['message'], 'invalid artifact')

    def test_terminal_audit_retains_exact_owned_review_copy(self):
        root = self.out / 'root'; folder = root / 'packages/client/public/models/stations'; folder.mkdir(parents=True)
        tmp = folder / '_review_777777.glb'; tmp.write_bytes(b'exact fixture retained')
        job = Mock(); job.state = {'drained': True, 'clean': True}; job.coalition_id = 123
        job.known = {'777777': {'birth': [1, 2]}}; job.members.return_value = []
        job.scratch = self.out / 'absent_scratch'
        with patch.object(caller, 'ROOT', root), patch.object(caller, 'identity', return_value=None), \
             patch.object(caller, 'kernel_tasks', return_value={'live': 0}), \
             patch.object(caller.subprocess, 'run', return_value=Mock(returncode=1)):
            with self.assertRaisesRegex(AssertionError, 'review copy retained'):
                caller.terminal_audit(job, self.out / 'absent_private', [])
        self.assertEqual(tmp.read_bytes(), b'exact fixture retained')

    def test_terminal_audit_reused_pid_is_distinct_and_no_global_port_scan(self):
        job = Mock(); job.state = {'drained': True, 'clean': True}; job.coalition_id = 123
        job.known = {'777777': {'birth': [1, 2]}}; job.members.return_value = []
        job.scratch = self.out / 'absent_scratch'
        with patch.object(caller, 'identity', return_value={'birth': [9, 9]}), \
             patch.object(caller, 'kernel_tasks', return_value={'live': 0}), \
             patch.object(caller.subprocess, 'run', return_value=Mock(returncode=1)), \
             patch.object(caller.subprocess, 'check_output', return_value='pid 777777(new unrelated): assertion'):
            result = caller.terminal_audit(job, self.out / 'absent_private', [])
        self.assertTrue(result['owned_listeners_absent_via_no_live_owned_task'])
        self.assertFalse(result['global_port_scan'])


if __name__ == '__main__': unittest.main(verbosity=2)
