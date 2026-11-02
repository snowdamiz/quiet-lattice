"""Owned CPU controls for the station coalition candidate; no browser or capture."""
import errno
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

from round4_job_boundary import StationJob, DeadlineExpired, deadline, identity, coalition, kernel_tasks, write
from round4_capture_children import CaptureChildren, UnsafeCaptureGroup
from capture_round4_stage import run_plan

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(os.environ['ROUND4_TEST_OUTPUT']).resolve()
OUT.mkdir(parents=True, exist_ok=False)
RECORDS = []


def eventually(predicate, seconds=4):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = predicate()
        if value:
            return value
        time.sleep(.01)
    raise AssertionError('CPU fixture condition did not arrive')


def plan():
    return {'stages': json.loads((ROOT / 'assets/renders/stations/round4/remaining8_readiness.json').read_text())['stages']}


class JobBoundaryControls(unittest.TestCase):
    def setUp(self):
        self.out = OUT / self._testMethodName
        self.out.mkdir()
        self.jobs = []
        self.aux = []

    def job(self, code, name='job'):
        job = StationJob(self.out / name, [sys.executable, '-c', code], ROOT, env={'PATH': os.environ['PATH']})
        self.jobs.append(job)
        job.start()
        return job

    def aux_child(self, argv):
        child = subprocess.Popen(argv, start_new_session=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        info = identity(child.pid)
        self.aux.append((child, info))
        write(self.out / f'aux_{child.pid}.json', info)
        return child

    def tearDown(self):
        for job in self.jobs:
            if not job.state['drained']:
                job.drain(3)
            self.assertTrue(job.state['drained'], job.state)
            self.assertFalse(job.members())
            job.archive()
        for child, original in self.aux:
            if child.poll() is None:
                current = identity(child.pid)
                self.assertEqual(current['birth'], original['birth'])
                self.assertEqual(current['uid'], os.getuid())
                os.kill(child.pid, signal.SIGKILL)
            child.wait(timeout=3)
            for stream in (child.stdin, child.stdout, child.stderr):
                if stream and not stream.closed:
                    stream.close()
            self.assertIsNone(identity(child.pid))
        RECORDS.append({'test': self.id(), 'job_directories': [str(j.out.relative_to(ROOT)) for j in self.jobs],
                        'aux_pids': [i for _, i in self.aux], 'all_fixture_pids_coalitions_registrations_absent': True})
        write(OUT / 'fixtures.json', RECORDS)

    def test_reap_watched_caffeinate_before_signalling(self):
        job = self.job('raise SystemExit(0)')
        self.assertEqual(job.wait(2), 'completed')
        eventually(lambda: 'caffeinate' in job.status()['exits'])
        result = job.drain(1)
        self.assertTrue(result['clean'], result)
        self.assertEqual(result['exits'], {'capture': 0, 'caffeinate': 0})
        self.assertFalse(result['signals'])

    def test_already_exited_unreaped_child(self):
        job = self.job('raise SystemExit(0)')
        eventually(lambda: 'capture' in job.status()['exits'])  # Receipt, not scheduling delay.
        self.assertTrue(job.drain(1)['clean'])
        self.assertEqual(job.state['exits']['capture'], 0)

    def test_natural_exit_status(self):
        job = self.job('raise SystemExit(7)')
        self.assertEqual(job.wait(2), 'completed')
        self.assertEqual(job.status()['exits']['capture'], 7)
        self.assertTrue(job.drain(1)['clean'])

    def test_real_exit_between_verification_and_signal(self):
        go = self.out / 'exit'
        job = self.job(f"import os,time\nwhile not os.path.exists({str(go)!r}):time.sleep(.01)")
        row = eventually(lambda: next((r for r in job.members() if r['pid'] != job.root['pid'] and r['pid'] != job.status().get('caffeinate_launch_identity', {}).get('pid')), None))
        real_kill = os.kill
        def exit_then_signal(pid, sig):
            go.touch()
            eventually(lambda: identity(pid) is None)
            return real_kill(pid, sig)  # Actual ESRCH race, accepted only after absence.
        with patch('round4_job_boundary.os.kill', exit_then_signal):
            job.signal_pid(row, signal.SIGTERM)
        self.assertTrue(job.drain(1)['clean'])

    def test_resistant_parent_and_descendant_with_exited_child(self):
        ready = self.out / 'ready'
        code = f"import signal,subprocess,sys,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(20)'],start_new_session=True);open({str(ready)!r},'w').write('ready');time.sleep(20)"
        job = self.job(code)
        eventually(ready.exists)
        self.assertTrue(job.drain(.8)['clean'], job.state)
        self.assertEqual(job.state['exits']['capture'], -signal.SIGKILL)
        self.assertTrue(any(s['signal'] == 'SIGKILL' for s in job.state['signals']))

    def test_group_error_does_not_abandon_other_owned_child(self):
        ready = self.out / 'ready'
        job = self.job(f"import subprocess,sys,time;subprocess.Popen([sys.executable,'-c','import time;time.sleep(20)'],start_new_session=True);open({str(ready)!r},'w').write('ready');time.sleep(20)")
        eventually(ready.exists)
        denied = job.status()['capture_launch_identity']['pid']
        real_kill = os.kill
        def one_denial(pid, sig):
            if pid == denied and sig == signal.SIGTERM:
                raise PermissionError(errno.EPERM, 'controlled one-target denial')
            return real_kill(pid, sig)
        with patch('round4_job_boundary.os.kill', one_denial):
            result = job.drain(.8)
        self.assertTrue(result['drained'], result)
        self.assertFalse(result['clean'])
        self.assertTrue(any(s['pid'] != denied and s['signal'] == 'SIGTERM' for s in result['signals']))

    def test_unknown_invalid_and_reused_identities_refused(self):
        job = self.job('import time;time.sleep(20)')
        outsider = self.aux_child([sys.executable, '-c', 'import time;time.sleep(20)'])
        row = eventually(lambda: next((r for r in job.members() if r['pid'] != job.root['pid']), None))
        for candidate in ({**row, 'pid': 0}, {**row, 'pid': -1}, {**row, 'birth': [0, 0]}, identity(outsider.pid)):
            with self.assertRaises((AssertionError, UnsafeCaptureGroup)):
                job.signal_pid(candidate, signal.SIGTERM)
        self.assertIsNone(outsider.poll())
        self.assertTrue(job.drain(1)['clean'])

    def test_unverified_group_member_refused(self):
        job = self.job('import time;time.sleep(20)')
        outsider = self.aux_child([sys.executable, '-c', 'import time;time.sleep(20)'])
        forged = {**identity(outsider.pid), 'ppid': job.root['pid'], 'pgid': job.root['pgid'], 'coalition': [job.coalition_id, 0]}
        with patch('round4_job_boundary.os.kill') as spy:
            with self.assertRaises(UnsafeCaptureGroup):
                job.signal_pid(forged, signal.SIGTERM)
            spy.assert_not_called()
        self.assertNotIn(outsider.pid, [r['pid'] for r in job.members()])
        self.assertIsNone(outsider.poll())

    def late_writer(self, name):
        ready, late = self.out / (name + '_ready'), self.out / (name + '_late')
        job = self.job(f"import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);open({str(ready)!r},'w').write('ready');time.sleep(1);open({str(late)!r},'w').write('late');time.sleep(20)")
        eventually(ready.exists)
        return job, late

    def test_observer_failure_drains_known_children_without_late_write(self):
        job, late = self.late_writer('observer')
        def failure(): raise RuntimeError('controlled observer failure')
        self.assertEqual(job.wait(1, failure), 'observer_failed')
        self.assertTrue(job.drain(.5)['drained'])
        self.assertFalse(job.state['clean'])
        time.sleep(1)
        self.assertFalse(late.exists())

    def test_timeout_drains_resistant_child_without_late_write(self):
        job, late = self.late_writer('timeout')
        self.assertEqual(job.wait(.05), 'timed_out')
        self.assertTrue(job.drain(.5)['drained'])
        time.sleep(1)
        self.assertFalse(late.exists())

    def test_status_persisted_before_injected_cleanup_failure(self):
        job = self.job('raise SystemExit(9)')
        self.assertEqual(job.wait(2), 'completed')
        self.assertEqual(json.loads((job.scratch / 'worker.json').read_text())['exits']['capture'], 9)
        def failure(): raise RuntimeError('controlled cleanup failure')
        self.assertFalse(job.drain(.2, failure)['drained'])
        self.assertEqual(json.loads((job.out / 'boundary.json').read_text())['exits']['capture'], 9)

    def test_real_sandbox_permission_failure_fails_closed(self):
        job = self.job('import time;time.sleep(20)')
        row = eventually(lambda: next((r for r in job.members() if r['pid'] != job.root['pid']), None))
        script = "import os,signal,sys\ntry:os.kill(int(sys.argv[1]),signal.SIGTERM)\nexcept PermissionError:raise SystemExit(77)"
        child = self.aux_child(['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny signal)', sys.executable, '-c', script, str(row['pid'])])
        child.communicate(timeout=2)
        self.assertEqual(child.returncode, 77)
        self.assertEqual(identity(row['pid'])['birth'], row['birth'])
        def real_denial(*_): raise PermissionError(errno.EPERM, 'retained actual seatbelt signal denial')
        with patch('round4_job_boundary.os.kill', real_denial):
            result = job.drain(.15)
        write(self.out / 'actual_denial_phase.json', result)
        self.assertFalse(result['drained'])
        self.assertFalse(result['clean'])
        self.assertTrue(any('PermissionError' in e for e in result['errors']))

    def test_revoked_nine_stage_grant_cannot_launch_controller(self):
        child = self.aux_child([sys.executable, str(ROOT / 'assets/blend/stations/_authoring/capture_round4_stage.py')])
        _, stderr = child.communicate(timeout=2)
        self.assertEqual(child.returncode, 1)
        self.assertIn(b'previous nine-stage grant is revoked', stderr)

    def test_hard_capture_deadline_interrupts_stalled_observer(self):
        previous = signal.getsignal(signal.SIGALRM)
        started = time.monotonic()
        with self.assertRaises(DeadlineExpired):
            with deadline(.05): time.sleep(5)
        self.assertLess(time.monotonic() - started, .3)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))

    def test_cleanup_deadline_includes_slow_observer(self):
        job = self.job('import time;time.sleep(20)')
        started = time.monotonic()
        result = job.drain(.05, lambda: time.sleep(.25))
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, .3)
        self.assertFalse(result['drained'])
        self.assertFalse(result['clean'])
        write(self.out / 'deadline_receipt.json', {'budget': .05, 'elapsed': elapsed, 'release_claimed': False})

    def test_exit_before_registration_and_orphan_between_observations(self):
        for index in (0, 1):
            late = self.out / f'late{index}'
            child = f"import os,time;os.setsid();time.sleep(.6);open({str(late)!r},'w').write('late');time.sleep(20)"
            job = self.job(f"import subprocess,sys;subprocess.Popen([sys.executable,'-c',{child!r}])", f'orphan{index}')
            if index: job.members()
            time.sleep(.1)
            self.assertEqual(job.wait(2), 'completed')
            self.assertTrue(any(r['ppid'] == 1 and r['pid'] != job.root['pid'] for r in job.members()))
            self.assertTrue(job.drain(.3)['clean'], job.state)
            time.sleep(.6)
            self.assertFalse(late.exists())

    def test_retired_sampler_cannot_claim_release(self):
        with self.assertRaises(UnsafeCaptureGroup): CaptureChildren({}, {})

    def test_worker_loss_preserves_unknown_child_status(self):
        job = self.job('import time;time.sleep(20)')
        eventually(lambda: 'capture_launch_identity' in job.status())
        job.signal_pid(next(r for r in job.members() if r['pid'] == job.root['pid']), signal.SIGKILL)
        eventually(lambda: identity(job.root['pid']) is None)
        self.assertEqual(job.wait(1), 'worker_lost')
        result = job.drain(.5)
        self.assertTrue(result['drained'], result)
        self.assertFalse(result['clean'])
        self.assertEqual(result['exits']['capture'], 'UNKNOWN')

    def test_failure_holds_attempt_and_prevents_second_stage(self):
        launched = []
        def runner(stage, out):
            launched.append(stage['id'])
            job = self.job('raise SystemExit(7)')
            self.assertEqual(job.wait(2), 'completed')
            state = job.drain(1)
            return {'accepted': state['exits']['capture'] == 0 and state['clean'], 'exit': state['exits']['capture']}
        with self.assertRaises(RuntimeError): run_plan(plan(), self.out / 'consumed', 'one-failing-grant', runner)
        self.assertEqual(launched, [plan()['stages'][0]['id']])
        state = json.loads(next((self.out / 'consumed').glob('*/attempt.json')).read_text())
        self.assertEqual(state['status'], 'PERMANENT_HOLD')
        with self.assertRaises(FileExistsError): run_plan(plan(), self.out / 'consumed', 'one-failing-grant', runner)
        self.assertEqual(len(launched), 1)

    def test_concurrent_grant_consumption_and_ordered_success(self):
        fixture = self.out / 'sequence.py'
        fixture.write_text(f"import sys,time,json\nsys.path.insert(0,{str(Path(__file__).parent)!r})\nfrom capture_round4_stage import run_plan\nfrom pathlib import Path\nready=json.loads(Path({str(ROOT / 'assets/renders/stations/round4/remaining8_readiness.json')!r}).read_text())\ndef run(stage,out):\n time.sleep(.03);return {{'accepted':True}}\ntry:run_plan(ready,{str(self.out / 'consumed')!r},'exclusive-cpu-grant',run)\nexcept FileExistsError:raise SystemExit(23)\n")
        children = [self.aux_child([sys.executable, str(fixture)]) for _ in range(2)]
        for child in children: child.communicate(timeout=3)
        self.assertEqual(sorted(c.returncode for c in children), [0, 23])
        state = json.loads(next((self.out / 'consumed').glob('*/attempt.json')).read_text())
        self.assertEqual(state['status'], 'ALL_EIGHT_SUCCEEDED')
        self.assertEqual(state['completed'], [s['id'] for s in plan()['stages']])

    def test_process_crash_cannot_resume_consumed_grant(self):
        fixture = self.out / 'crash.py'
        consumed = self.out / 'consumed'
        fixture.write_text(f"import os,sys,json\nsys.path.insert(0,{str(Path(__file__).parent)!r})\nfrom capture_round4_stage import run_plan\nfrom pathlib import Path\nready=json.loads(Path({str(ROOT / 'assets/renders/stations/round4/remaining8_readiness.json')!r}).read_text())\nrun_plan(ready,{str(consumed)!r},'crashed-cpu-grant',lambda *_:os._exit(42))\n")
        child = self.aux_child([sys.executable, str(fixture)])
        child.communicate(timeout=2)
        self.assertEqual(child.returncode, 42)
        state = json.loads(next(consumed.glob('*/attempt.json')).read_text())
        self.assertEqual(state['status'], 'ACTIVE_OR_INTERRUPTED_HOLD')
        with self.assertRaises(FileExistsError):
            run_plan(plan(), consumed, 'crashed-cpu-grant', lambda *_: self.fail('must not launch'))

    def test_single_stage_cli_is_retired(self):
        child = self.aux_child([sys.executable, str(ROOT / 'assets/blend/stations/_authoring/capture_round4_stage.py'), 'standard-scrapyard-sy_rock'])
        _, stderr = child.communicate(timeout=2)
        self.assertEqual(child.returncode, 1)
        self.assertIn(b'no stage IDs, retries or skips', stderr)

    def test_atomic_count_rejects_missed_replacement_child(self):
        ready = self.out / 'ready'
        job = self.job(f"import subprocess,sys,time;subprocess.Popen([sys.executable,'-c','import time;time.sleep(20)'],start_new_session=True);open({str(ready)!r},'w').write('ready')")
        eventually(ready.exists)
        self.assertEqual(job.wait(2), 'completed')
        eventually(lambda: job.status()['exits'].get('caffeinate') == 0)
        real_members = job.members
        self.assertEqual(kernel_tasks(job.coalition_id)['live'], 2)
        # The real timing counterpart is prove_round4_enumeration_race.py. Force that
        # classified omission through the exact terminal mechanism: it must remain held.
        with patch.object(job, 'members', lambda: [r for r in real_members() if r['pid'] == job.root['pid']]):
            result = job.drain(.1)
        write(self.out / 'held_phase_result.json', result)
        self.assertFalse(result['drained'])
        self.assertFalse((job.scratch / 'release').exists())
        self.assertEqual(result['kernel_before_root_release']['live'], 2)


if __name__ == '__main__': unittest.main()
