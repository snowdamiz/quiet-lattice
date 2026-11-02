"""CPU-only actual filesystem/archive controls. Engine profiles are fixture directories."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from round4_job_boundary import StationJob, UnsafeCaptureGroup, kernel_tasks, write

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(os.environ['ROUND4_ARCHIVE_TEST_OUTPUT']).resolve()
OUT.mkdir(parents=True, exist_ok=False)
PREFIXES = ('playwright_chromiumdev_profile-', 'playwright_firefoxdev_profile-', 'playwright_webkitdev_profile-')
RECORDS = []


def eventually(predicate):
    end = time.monotonic() + 3
    while time.monotonic() < end:
        value = predicate()
        if value: return value
        time.sleep(.01)
    raise AssertionError('bounded CPU archive fixture wait expired')


class ArchiveControls(unittest.TestCase):
    def setUp(self):
        self.out = OUT / self._testMethodName
        self.out.mkdir()
        self.namespace = (self.out / 'private profiles').resolve()
        self.namespace.mkdir(mode=0o700)
        self.jobs = []

    def job(self, code, name='job', private_env=True):
        env = {'PATH': os.environ['PATH']}
        if private_env: env['TMPDIR'] = str(self.namespace) + os.sep
        job = StationJob(self.out / name, [sys.executable, '-c', code], ROOT,
                         env=env)
        self.jobs.append(job)
        job.start()
        self.assertEqual(job.wait(3), 'completed')
        eventually(lambda: 'caffeinate' in job.status()['exits'])
        self.assertTrue(job.drain(2)['drained'], job.state)
        return job

    def negative_fixture(self, log):
        # No job is registered for pure refusal controls; archive must reject before
        # any process/registration/filesystem mutation outside these fixture files.
        job = StationJob.__new__(StationJob)
        job.state = {'drained': True, 'profiles': []}
        job.out = self.out / 'fake_out'; job.out.mkdir()
        job.scratch = self.out / 'fake_scratch'; job.scratch.mkdir()
        (job.scratch / 'capture_stdout.txt').write_text(log)
        job.target = 'CPU-PATH-REFUSAL-NO-REGISTERED-JOB'
        return job

    def refused(self, job, **kwargs):
        log = (job.scratch / 'capture_stdout.txt').read_bytes()
        with patch('round4_job_boundary.subprocess.run', side_effect=AssertionError('refusal must precede launchctl')):
            with self.assertRaises((UnsafeCaptureGroup, ValueError)):
                job.archive(**kwargs)
        self.assertEqual((job.scratch / 'capture_stdout.txt').read_bytes(), log)

    def tearDown(self):
        for job in self.jobs:
            if not job.state['drained']: job.drain(2)
            self.assertTrue(job.state['drained'])
            self.assertFalse(job.members())
            self.assertEqual(kernel_tasks(job.coalition_id)['live'], 0)
            check = subprocess.run(['/bin/launchctl', 'print', job.target], capture_output=True, timeout=3)
            self.assertNotEqual(check.returncode, 0)
            self.assertFalse(job.scratch.exists(), 'Archive must remove only its exact private job scratch')
        RECORDS.append({'test': self.id(), 'mode': 'CPU_FILESYSTEM_ONLY_NO_BROWSER',
                        'jobs': [str(j.out.relative_to(ROOT)) for j in self.jobs],
                        'all_owned_processes_coalitions_jobs_scratch_absent': True})
        write(OUT / 'fixtures.json', RECORDS)

    def test_supported_prefixes_flags_and_unquoted_namespace_spaces(self):
        flags = ('--user-data-dir=', '-profile ', '--user-data-dir=')
        for index, (prefix, flag) in enumerate(zip(PREFIXES, flags)):
            profile = self.namespace / (prefix + 'cpuFixture')
            data = 'actual CPU fixture data ' + prefix
            code = f"from pathlib import Path;p=Path({str(profile)!r});p.mkdir();(p/'fixture.txt').write_text({data!r});print({flag!r}+str(p)+' --following-flag',flush=True)"
            job = self.job(code, f'job{index}')
            original_log = (job.scratch / 'capture_stdout.txt').read_bytes()
            job.archive(profile_namespace=self.namespace, profile_prefixes=PREFIXES)
            receipt = json.loads((job.out / 'profile_release.json').read_text())
            self.assertTrue(receipt['all_absent'])
            self.assertEqual(receipt['all_owned_profiles'], [str(profile)])
            self.assertIn(str(profile), receipt['owned_logged_profiles'])
            self.assertEqual((job.out / ('preserved_' + profile.name) / 'fixture.txt').read_text(), data)
            self.assertEqual((job.out / 'capture_stdout.txt').read_bytes(), original_log)
            self.assertFalse(profile.exists())

    def test_unlogged_webkit_profile_is_namespace_owned_not_log_observed(self):
        profile = self.namespace / (PREFIXES[2] + 'noArg')
        keep = self.namespace / 'unrelated-caller-data.txt'; keep.write_text('leave unchanged')
        job = self.job(f"from pathlib import Path;p=Path({str(profile)!r});p.mkdir();(p/'fixture.txt').write_text('webkit CPU fixture');print('nonpersistent WebKit has no profile argument',flush=True)")
        job.archive(profile_namespace=self.namespace, profile_prefixes=PREFIXES)
        receipt = json.loads((job.out / 'profile_release.json').read_text())
        self.assertEqual(receipt['owned_logged_profiles'], [])
        self.assertEqual(receipt['namespace_owned_profiles'], [str(profile)])
        self.assertEqual(receipt['all_owned_profiles'], [str(profile)])
        self.assertEqual(keep.read_text(), 'leave unchanged')
        self.assertTrue(self.namespace.exists())

    def test_already_removed_profile_retains_log_and_absent_receipt(self):
        profile = self.namespace / (PREFIXES[1] + 'removed')
        job = self.job(f"from pathlib import Path;import shutil;p=Path({str(profile)!r});p.mkdir();print('--profile '+str(p),flush=True);shutil.rmtree(p)")
        raw = (job.scratch / 'capture_stdout.txt').read_bytes()
        job.archive(profile_namespace=self.namespace, profile_prefixes=PREFIXES)
        receipt = json.loads((job.out / 'profile_release.json').read_text())
        self.assertEqual(receipt['all_owned_profiles'], [str(profile)])
        self.assertTrue(receipt['all_absent'])
        self.assertEqual((job.out / 'capture_stdout.txt').read_bytes(), raw)
        self.assertFalse((job.out / ('preserved_' + profile.name)).exists())

    def test_unrelated_logged_path_refused_before_any_profile_mutation(self):
        outside = self.out / (PREFIXES[0] + 'outside'); outside.mkdir()
        (outside / 'keep').write_text('untouched')
        valid = self.namespace / (PREFIXES[0] + 'valid'); valid.mkdir()
        job = self.negative_fixture(f'--user-data-dir={valid}\n--user-data-dir={outside}\n')
        self.refused(job, profile_namespace=self.namespace, profile_prefixes=PREFIXES)
        self.assertTrue(valid.exists())
        self.assertEqual((outside / 'keep').read_text(), 'untouched')
        self.assertFalse((job.out / ('preserved_' + valid.name)).exists())

    def test_namespace_or_profile_or_descendant_symlink_refused(self):
        target = self.out / 'outside'; target.mkdir(); (target / 'secret').write_text('never copy')
        link = self.out / 'namespace-link'; link.symlink_to(self.namespace, target_is_directory=True)
        job = self.negative_fixture('CPU path refusal')
        self.refused(job, profile_namespace=link, profile_prefixes=PREFIXES)
        profile_link = self.namespace / (PREFIXES[0] + 'link'); profile_link.symlink_to(target, target_is_directory=True)
        self.refused(job, profile_namespace=self.namespace, profile_prefixes=PREFIXES)
        profile_link.unlink()
        profile = self.namespace / (PREFIXES[0] + 'childlink'); profile.mkdir()
        (profile / 'nested-link').symlink_to(target, target_is_directory=True)
        self.refused(job, profile_namespace=self.namespace, profile_prefixes=PREFIXES)
        self.assertEqual((target / 'secret').read_text(), 'never copy')

    def test_prefix_extension_requires_private_namespace_and_exact_allowlist(self):
        job = self.negative_fixture('CPU path refusal')
        self.refused(job, profile_prefixes=PREFIXES)
        self.refused(job, profile_namespace=self.namespace, profile_prefixes=('playwright_',))
        self.refused(job, profile_namespace=self.namespace, profile_prefixes=())
        self.namespace.chmod(0o755)
        self.refused(job, profile_namespace=self.namespace, profile_prefixes=PREFIXES)
        self.namespace.chmod(0o700)

    def test_namespace_escape_and_unapproved_profile_prefix_refused(self):
        outside = self.out / (PREFIXES[0] + 'escape'); outside.mkdir()
        bad = self.namespace / '..' / outside.name
        job = self.negative_fixture(f'--user-data-dir={bad}\n')
        self.refused(job, profile_namespace=self.namespace, profile_prefixes=PREFIXES)
        unknown = self.namespace / 'playwright_unapproveddev_profile-bad'; unknown.mkdir()
        (job.scratch / 'capture_stdout.txt').write_text(f'--user-data-dir={unknown}\n')
        self.refused(job, profile_namespace=self.namespace, profile_prefixes=PREFIXES)
        self.assertTrue(outside.exists() and unknown.exists())

    def test_default_station_call_remains_chromium_log_bound(self):
        temp_root = Path(tempfile.gettempdir()).resolve()
        code = f"from pathlib import Path;import tempfile;p=Path(tempfile.mkdtemp(prefix={PREFIXES[0]!r},dir={str(temp_root)!r}));(p/'fixture.txt').write_text('default station CPU fixture');print('--user-data-dir='+str(p),flush=True)"
        job = self.job(code, private_env=False)
        job.archive()
        receipt = json.loads((job.out / 'profile_release.json').read_text())
        self.assertFalse(receipt['private_namespace_admitted'])
        self.assertEqual(receipt['prefixes'], [PREFIXES[0]])
        self.assertEqual(len(receipt['owned_logged_profiles']), 1)
        self.assertEqual(receipt['namespace_owned_profiles'], [])
        self.assertTrue(receipt['all_absent'])

    def test_namespace_uid_mismatch_refused_without_privilege_change(self):
        job = self.negative_fixture('CPU UID refusal')
        with patch('round4_job_boundary.os.getuid', return_value=os.getuid() + 1):
            self.refused(job, profile_namespace=self.namespace, profile_prefixes=PREFIXES)


if __name__ == '__main__': unittest.main()
