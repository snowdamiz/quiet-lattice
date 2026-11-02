"""One-use, separately granted, asset-free Chromium boundary proof. No station capture."""
import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

from round4_job_boundary import StationJob, deadline, identity, coalition, LIBPROC, write

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'assets/renders/stations/round4/browser_proof_ready02'
READY = BASE / 'readiness.json'
GRANT = BASE / 'parent_gpu_proof_grant.json'
RUN = ROOT / 'assets/renders/stations/round4/actual_browser_proof02'
CAPTURE_SECONDS = CLEANUP_SECONDS = 30


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def parse_launch(log, expected_binary, temporary_root):
    log = re.sub(r'\x1b\[[0-9;]*m', '', log)
    launches = re.findall(r'<launching> ([^\n]+)', log)
    pids = re.findall(r'<launched> pid=([0-9]+)', log)
    if not launches:
        return None
    assert len(launches) == 1 and len(pids) <= 1, 'Multiple launches or malformed launch receipt'
    assert log.count('<launched>') == len(pids), 'Malformed launched PID'
    assert launches[0].startswith(expected_binary + ' --'), 'Unexpected actual browser binary'
    pid = int(pids[0]) if pids else None
    assert pid is None or pid > 0, 'Invalid browser PID'
    profiles = re.findall(r'--user-data-dir=([^\s]+)', launches[0])
    assert len(profiles) == 1
    profile = Path(profiles[0])
    assert profile.is_absolute() and profile.parent == Path(temporary_root)
    assert profile.name.startswith('playwright_chromiumdev_profile-') and not profile.is_symlink()
    return {'pid': pid, 'binary': expected_binary, 'profile': str(profile),
            'angle_metal_requested': '--use-angle=metal' in launches[0]}


def backend_receipt(log, ready):
    rows = re.findall(r'^STATION_BROWSER_PROOF_BACKEND (.+)$', log, re.MULTILINE)
    if not rows or ready is None:
        return None
    assert len(rows) == 1, 'Multiple backend receipts'
    value = json.loads(rows[0])
    assert value == ready, 'Owned backend log/file disagree'
    assert value['viewport'] == [1920, 1080] and value['canvas'] == [1, 1]
    assert value['url'] == 'about:blank'
    assert all(value[k] is False for k in ('assetLoaded', 'screenshot', 'measurement'))
    assert isinstance(value['renderer'], str) and 'metal' in value['renderer'].lower(), 'Actual Metal backend unqualified'
    return value


def executable_path(pid):
    call = LIBPROC.proc_pidpath
    call.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    call.restype = ctypes.c_int
    buffer = ctypes.create_string_buffer(4096)
    count = call(pid, buffer, len(buffer))
    if count <= 0:
        raise OSError(ctypes.get_errno(), f'Owned PID{pid} executable path unavailable')
    return str(Path(os.fsdecode(buffer.value)).resolve())


def current_commands(rows):
    # Only already kernel-owned positive PIDs are queried. Returned argv is discarded on
    # any subsequent identity change; unrelated environment is never requested.
    ids = [r['pid'] for r in rows]
    assert ids and all(pid > 0 for pid in ids)
    result = subprocess.run(['/bin/ps', '-ww', '-p', ','.join(map(str, ids)), '-o', 'pid=,command='],
                            capture_output=True, text=True, timeout=2)
    assert result.returncode in (0, 1), 'Owned process observer failed'
    return {int(p[0]): p[1] for line in result.stdout.splitlines() if len(p := line.strip().split(None, 1)) == 2}


class BrowserReceipts:
    def __init__(self, job, probe_output, resolver, binaries, temporary_root):
        self.job, self.output = job, Path(probe_output)
        self.resolver, self.binaries, self.temporary_root = resolver, binaries, temporary_root
        self.released = False
        self.receipt = None

    def bind_profile(self, log):
        launch = parse_launch(log, self.resolver['selectedExecutable']['path'], self.temporary_root)
        if launch:
            self.job.state['profiles'] = [launch['profile']]
            self.job.save()
        return launch

    def observe(self):
        if self.released:
            return
        logfile = self.job.scratch / 'capture_stdout.txt'
        log = logfile.read_text() if logfile.exists() else ''
        launch = self.bind_profile(log)
        if launch is None:
            return
        rows = self.job.members()
        browser = next((r for r in rows if r['pid'] == launch['pid']), None)
        if browser is None:
            return
        commands = current_commands(rows)
        observed = []
        for row in rows:
            pid = row['pid']
            current = identity(pid)
            if current is None:
                continue
            assert current['birth'] == row['birth'] and current['uid'] == os.getuid(), 'Process identity changed'
            assert coalition(pid)[0] == self.job.coalition_id, 'Current kernel ownership changed'
            binary = executable_path(pid)
            after = identity(pid)
            if after is None:
                continue
            assert after['birth'] == row['birth'] and coalition(pid)[0] == self.job.coalition_id
            assert binary in self.binaries, f'Observed executable lacks prelaunch binding: {binary}'
            command = commands.get(pid)
            if command is None:
                continue
            process_type = re.search(r'(?:^|\s)--type=([^\s]+)', command)
            role = 'browser' if pid == launch['pid'] else process_type[1] if process_type else 'owned-launch-helper'
            if role != 'owned-launch-helper':
                assert binary in {b['path'] for b in self.resolver['installedBinaryAndLibraryCandidates'] if not b['path'].endswith('.dylib')}, 'Browser child executable not prebound'
            subtype = re.search(r'(?:^|\s)--utility-sub-type=([^\s]+)', command)
            observed.append({'kernel': after, 'coalition': coalition(pid), 'binary': binary,
                             'prelaunch_sha256': self.binaries[binary], 'role': role,
                             'utility_subtype': subtype[1] if subtype else None})
        roles = {r['role'] for r in observed}
        if not {'browser', 'gpu-process', 'renderer', 'utility'} <= roles:
            return  # Missing utility/helper evidence also holds the five-second barrier.
        browser_row = next(r for r in observed if r['role'] == 'browser')
        assert browser_row['binary'] == launch['binary'] and launch['angle_metal_requested']
        backend_file = self.output / 'ready_for_kernel_receipts.json'
        backend = backend_receipt(log, json.loads(backend_file.read_text()) if backend_file.exists() else None)
        if backend is None:
            return
        # Recheck every observed identity just before acknowledging; no stale PPID authority.
        for row in observed:
            latest = identity(row['kernel']['pid'])
            assert latest and latest['birth'] == row['kernel']['birth']
            assert latest['uid'] == os.getuid() and coalition(latest['pid'])[0] == self.job.coalition_id
        for binary in {r['binary'] for r in observed}:
            assert sha(binary) == self.binaries[binary], 'Observed binary changed since preflight'
        self.receipt = {'utc': utc(), 'scope': 'OBSERVED_CHROMIUM_EXECUTION_COHORT', 'launch': launch,
                        'processes': observed, 'backend': backend,
                        'external_native_XPC_service_ownership': 'UNQUALIFIED; no ownership inferred from PID/time/environment',
                        'all_ever_lived_processes_observed': False}
        write(self.output / 'kernel_receipts.json', self.receipt)
        (self.output / 'kernel_receipts_ready').write_text('Validated current-kernel observed Chromium receipts\n')
        self.released = True


def preflight(grant_path=GRANT, readiness_path=READY, runtime_output=RUN):
    assert Path(grant_path).is_file(), 'No separate parent proof grant; browser/GPU gate closed'
    grant = json.loads(Path(grant_path).read_text())
    assert grant['authorization_id'] == os.environ.get('STATION_BROWSER_PROOF_GRANT')
    assert grant['purpose'] == 'ASSET_FREE_CHROMIUM_BOUNDARY_PROOF_ONLY'
    assert grant['readiness_sha256'] == sha(readiness_path)
    assert grant['runner_sha256'] == sha(__file__)
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == grant['authorized_head']
    assert subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip() == 'task/P1-E11-T01'
    assert not (ROOT / 'assets/renders/stations/round4/PARENT_HOLD_GPU').exists()
    ready = json.loads(Path(readiness_path).read_text())
    for name, expected in ready['input_sha256'].items():
        assert sha(name) == expected, name
    assert str(Path(shutil.which('pnpm')).resolve()) == ready['pnpm_executable'], 'pnpm resolution drift'
    assert str(Path(sys.executable).resolve()) == ready['python_executable'], 'Python interpreter drift'
    assert ready['runtime_output'] == str(runtime_output) and not Path(runtime_output).exists()
    assert ready['capture_seconds'] == ready['cleanup_seconds'] == 30
    current = json.loads(subprocess.check_output(ready['resolver_argv'], cwd=ROOT, text=True, timeout=5))
    assert current == ready['resolver'] and current['spawnCalls'] == []
    assert current['validatedHeadless'] is True and current['selectedRegistryName'] == 'chromium-headless-shell'
    return grant, ready


def consume(grant, root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    attempt = root / hashlib.sha256(grant['authorization_id'].encode()).hexdigest()
    attempt.mkdir(exist_ok=False)  # Permanent atomic grant consumption, including crashes/failures.
    write(attempt / 'attempt.json', {'status': 'ACTIVE_OR_INTERRUPTED_HOLD', 'grant': grant, 'utc': utc()})
    return attempt


def execute(job_factory=StationJob):
    # Preflight belongs at the launch boundary, including direct Python callers.
    grant, ready = preflight()
    attempt = consume(grant, BASE / 'consumed_proof_grants')
    out = RUN
    out.mkdir(exist_ok=False)
    result = {'status': 'PERMANENT_HOLD', 'primary_failure': None, 'teardown_status': 'UNPROVED',
              'capture_exit': 'UNKNOWN', 'caffeinate_exit': 'UNKNOWN', 'observed_chromium_boundary_qualified': False,
              'external_native_XPC_service_ownership': 'UNQUALIFIED', 'actual_station_capture_enabled': False}
    job = observer = None
    job_initialised = False
    private_profiles = (out / 'private_profiles').resolve()
    try:
        with deadline(CAPTURE_SECONDS):
            started = time.monotonic()
            assert str(private_profiles) == ready['temporary_root']
            private_profiles.mkdir(mode=0o700)
            admission = attempt / 'admission.json'
            write(admission, {'authorization_id': grant['authorization_id'], 'payload_sha256': ready['payload_sha256'],
                              'probe_output': str(out / 'probe')})
            # Keep the partially initialised object if filesystem setup raises. The
            # accepted constructor creates no processes; its owned scratch can be retained.
            job = job_factory.__new__(job_factory)
            job_factory.__init__(job, out / 'owned_job', ready['argv'], ROOT, capture_seconds=30,
                env={'PATH': os.environ['PATH'], 'DEBUG': 'pw:browser', 'SMOKE_GL': 'metal', 'TMPDIR': str(private_profiles) + os.sep,
                     'STATION_BROWSER_PROOF_ADMISSION': str(admission),
                     'STATION_BROWSER_PROOF_GRANT': grant['authorization_id']})
            job_initialised = True
            job.state.update(scope='SEPARATELY_AUTHORIZED_ASSET_FREE_CHROMIUM_PROOF',
                             authorization_id=grant['authorization_id'])
            job.save()
            job.start()
            observer = BrowserReceipts(job, out / 'probe', ready['resolver'], ready['process_binary_sha256'], ready['temporary_root'])
            outcome = job.wait(max(.001, CAPTURE_SECONDS - (time.monotonic() - started)), observer.observe)
            exits = job.status().get('exits', {})
            result.update(capture_outcome=outcome, capture_exit=exits.get('capture', 'UNKNOWN'),
                          caffeinate_exit=exits.get('caffeinate', 'UNKNOWN'))
            assert outcome == 'completed' and result['capture_exit'] == 0, f'Proof payload failed: {outcome}, exit={result["capture_exit"]}'
            assert observer.released and observer.receipt, 'Required current kernel/backend receipts absent'
    except BaseException as error:
        result['primary_failure'] = {'type': type(error).__name__, 'message': str(error)}
    finally:
        try:
            with deadline(CLEANUP_SECONDS):
                cleanup_started = time.monotonic()
                if job is not None and getattr(job, 'coalition_id', None):
                    profile_binding_error = None
                    if observer is not None:
                        log = job.scratch / 'capture_stdout.txt'
                        if log.exists():
                            try:
                                observer.bind_profile(log.read_text())  # Retain exact owned profile on failure too.
                            except Exception as error:
                                profile_binding_error = error  # Never abandon live owned children for a parsing failure.
                    drained = job.drain(max(.001, CLEANUP_SECONDS - (time.monotonic() - cleanup_started)))
                    result['lifecycle'] = json.loads(json.dumps(drained))
                    result['capture_exit'] = drained['exits'].get('capture', 'UNKNOWN')
                    result['caffeinate_exit'] = drained['exits'].get('caffeinate', 'UNKNOWN')
                    assert drained['drained'], 'Owned coalition release unproved'
                    if profile_binding_error:
                        # Accepted archive parses profile paths from the log. Do not invoke it
                        # on a rejected binding; remove only the exact owned job registration.
                        stopped = subprocess.run(['/bin/launchctl', 'bootout', job.target], capture_output=True, text=True, timeout=3)
                        result['retained_profile_binding_failure'] = str(profile_binding_error)
                        result['owned_job_bootout_exit'] = stopped.returncode
                        raise RuntimeError('Cohort drained; profile binding unproved, raw scratch retained')
                    job.archive(profile_namespace=private_profiles, profile_prefixes=('playwright_chromiumdev_profile-',))
                    profile_release = json.loads((job.out / 'profile_release.json').read_text())
                    assert profile_release['all_absent']
                    assert len(profile_release['owned_logged_profiles']) == 1 or result['primary_failure'], 'Profile identity missing'
                    private_profiles.rmdir()  # Unexpected remaining data holds teardown; no broad namespace deletion.
                    result.update(teardown_status='DRAINED_AND_ARCHIVED', profile_release=profile_release,
                                  private_profile_namespace_removed=True)
                elif job is not None and job_initialised:
                    # Before the accepted API establishes its coalition, its go barrier
                    # has not opened. Remove only this unique owned registration; retain
                    # scratch/proof and mark release unproved rather than inventing exits.
                    stopped = subprocess.run(['/bin/launchctl', 'bootout', job.target], capture_output=True, text=True, timeout=3)
                    result['prelaunch_teardown'] = {'target': job.target, 'bootout_exit': stopped.returncode,
                                                   'stderr': stopped.stderr, 'retained_scratch': str(job.scratch)}
                    raise RuntimeError('Prelaunch boundary incomplete; scratch retained, release requires direct audit')
                elif job is not None:
                    scratch = getattr(job, 'scratch', None)
                    if scratch and Path(scratch).exists():
                        assert Path(scratch).name.startswith('stations-round4-owned-') and not Path(scratch).is_symlink()
                        shutil.copytree(scratch, out / 'partial_constructor_scratch')
                        shutil.rmtree(scratch)
                    result['teardown_status'] = 'NO_PROCESS_LAUNCH_CONSTRUCTOR_SCRATCH_PRESERVED'
                    private_profiles.rmdir()
                else:
                    result['teardown_status'] = 'NO_JOB_CREATED'
        except BaseException as error:
            result['teardown_status'] = 'UNPROVED'
            result['teardown_failure'] = {'type': type(error).__name__, 'message': str(error)}
        if result['primary_failure'] is None and result['teardown_status'] == 'DRAINED_AND_ARCHIVED' and 'teardown_failure' not in result:
            if result['lifecycle']['clean'] and isinstance(result['caffeinate_exit'], int):
                result.update(status='PASS_OBSERVED_CHROMIUM_EXECUTION_BOUNDARY', observed_chromium_boundary_qualified=True)
        write(out / 'result.json', result)
        write(attempt / 'attempt.json', {'status': result['status'], 'runtime_output': str(out), 'result': result})
    return result


def main():
    assert len(sys.argv) == 1, 'No alternate paths, retries or stage arguments'
    result = execute()
    print(json.dumps(result, indent=2))
    return 0 if result['observed_chromium_boundary_qualified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
