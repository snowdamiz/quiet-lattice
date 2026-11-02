"""One separately granted, sequential remaining-eight station attempt. No retries."""
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

from round4_job_boundary import StationJob, deadline, identity, coalition, kernel_tasks, write
from run_round4_browser_proof import (create_private_tmp, preserve_private_tmp, parse_launch,
    executable_path, current_commands, PRIVATE_TMP_POLICY)

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'assets/renders/stations/round4'
FREEZE = BASE / 'station_remaining8_ready04'
READY = FREEZE / 'readiness.json'
GRANT = FREEZE / 'parent_gpu_grant.json'
CAPTURE_SECONDS, CLEANUP_SECONDS = 600, 60
VTENCODER = '/System/Library/Frameworks/VideoToolbox.framework/Versions/A/XPCServices/VTEncoderXPCService.xpc/Contents/MacOS/VTEncoderXPCService'
ENCODER_REQUIREMENT = 'identifier "com.apple.coremedia.videoencoder" and anchor apple'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def failure(error):
    return {'type': type(error).__name__, 'message': str(error)}


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def original_stages():
    original = BASE / 'capture_readiness.json'
    assert sha(original) == 'd1dc9907f657cf9a707a2b5ee2cc477fa15831cf3ba378bebb51b05b6ac973fa'
    stages = [s for s in json.loads(original.read_text())['stages'] if s['id'] != 'standard-waystation-ws_fabricator']
    for stage in stages:
        stage['out_path'] = stage['out_path'].replace('/engine/attempt01/', '/engine/attempt02/')
        stage['argv'] = [arg.replace('/engine/attempt01/', '/engine/attempt02/') for arg in stage['argv']]
    return stages


def encoder_binding():
    path = Path(VTENCODER)
    assert path.resolve(strict=True) == path, 'Apple encoder path must be canonical'
    verify_argv = ['/usr/bin/codesign', '--verify', '--strict', '-R', '=' + ENCODER_REQUIREMENT, str(path)]
    verify = subprocess.run(verify_argv, capture_output=True, text=True, timeout=5)
    assert verify.returncode == 0, f'Apple encoder signature verification failed: {verify.stderr}'
    display_argv = ['/usr/bin/codesign', '-d', '--verbose=4', '-r-', str(path)]
    display = subprocess.run(display_argv, capture_output=True, text=True, timeout=5)
    assert display.returncode == 0, f'Apple encoder signature display failed: {display.stderr}'
    metadata = display.stdout + display.stderr
    fields = dict(line.split('=', 1) for line in metadata.splitlines() if '=' in line)
    assert fields['Identifier'] == 'com.apple.coremedia.videoencoder'
    assert fields['Platform identifier'].isdigit() and int(fields['Platform identifier']) > 0
    assert f'designated => {ENCODER_REQUIREMENT}' in metadata.splitlines()
    assert fields['CDHash']
    return {'canonical_path': str(path), 'sha256': sha(path), 'codesign_sha256': sha('/usr/bin/codesign'),
            'requirement': ENCODER_REQUIREMENT, 'identifier': fields['Identifier'],
            'platform_identifier': fields['Platform identifier'], 'cdhash': fields['CDHash'],
            'verify': {'argv': verify_argv, 'exit': verify.returncode, 'stdout': verify.stdout, 'stderr': verify.stderr},
            'display': {'argv': display_argv, 'exit': display.returncode, 'stdout': display.stdout, 'stderr': display.stderr}}


def verify_encoder_binding(ready):
    assert encoder_binding() == ready['apple_encoder_binding'], 'Apple encoder binding changed'


def validate_plan(ready):
    assert ready['stages'] == original_stages(), 'Original commands, assets, settings or output paths changed'
    assert ready['capture_seconds'] == CAPTURE_SECONDS and ready['cleanup_seconds'] == CLEANUP_SECONDS
    assert ready['private_tmp_policy'] == PRIVATE_TMP_POLICY
    for stage in ready['stages']:
        path = ROOT / stage['out_path']
        assert path.resolve() == path and not path.exists(), f'Output already exists or escapes: {path}'


def preflight(*, check_outputs=True):
    assert GRANT.is_file(), 'No new parent eight-stage grant; station GPU gate closed'
    grant = json.loads(GRANT.read_text())
    assert grant['authorization_id'] == os.environ.get('STATION_ROUND4_GPU_GRANT')
    assert grant['purpose'] == 'STATION_ROUND4_REMAINING_EIGHT_ONLY'
    assert grant['readiness_sha256'] == sha(READY) and grant['runner_sha256'] == sha(__file__)
    assert grant['entry_sha256'] == sha(Path(__file__).with_name('capture_round4_stage.py'))
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == grant['authorized_head']
    assert subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip() == 'task/P1-E11-T01'
    assert not (BASE / 'PARENT_HOLD_GPU').exists(), 'Parent hold prevents next launch'
    ready = json.loads(READY.read_text())
    for path, expected in ready['input_sha256'].items():
        assert sha(path) == expected, f'Input changed: {path}'
    assert str(Path(sys.executable).resolve()) == ready['python_executable']
    assert str(Path(shutil.which('pnpm')).resolve()) == ready['pnpm_executable']
    assert os.environ.get('PATH') == ready['launch_path'], 'Pinned launcher PATH changed'
    resolver = json.loads(subprocess.check_output(ready['resolver_argv'], cwd=ROOT, text=True, timeout=5))
    assert resolver == ready['resolver'] and resolver['spawnCalls'] == []
    # Actual logical resolution is re-queried, including ancestor links and entry bytes,
    # at initial admission and again by require_stage_admission before every stage.
    verify_routes(ready)
    verify_encoder_binding(ready)
    encoder = ready['apple_encoder_binding']
    assert ready['process_binary_sha256'][VTENCODER] == ready['input_sha256'][VTENCODER] == encoder['sha256']
    assert ready['input_sha256']['/usr/bin/codesign'] == encoder['codesign_sha256']
    proof = json.loads(Path(ready['qualification']['path']).read_text())
    assert proof['status'] == 'PASS_OBSERVED_CHROMIUM_EXECUTION_BOUNDARY' and proof['accepted_by_parent'] is True
    assert proof['external_native_XPC_ownership'] == 'UNQUALIFIED'
    if check_outputs:
        validate_plan(ready)
    else:
        assert ready['stages'] == original_stages()
    return grant, ready


def verify_routes(ready):
    completed = subprocess.run(ready['route_verify_argv'], cwd=ROOT, capture_output=True, text=True, timeout=10)
    assert completed.returncode == 0, f'Logical dependency route check failed: {completed.stderr}'


def require_stage_admission(stage, out, ready):
    grant, current_ready = preflight(check_outputs=False)
    assert current_ready == ready
    key = hashlib.sha256(grant['authorization_id'].encode()).hexdigest()
    attempt = FREEZE / 'consumed_grants' / key
    assert out == attempt / stage['id'], 'Not this consumed attempt stage'
    state = json.loads((attempt / 'attempt.json').read_text())
    assert state['status'] == 'ACTIVE_OR_INTERRUPTED_HOLD' and state['failure'] is None
    assert state['authorization_id'] == grant['authorization_id'] and state['ordered_plan'] == ready['stages']
    index = len(state['completed'])
    assert state['completed'] == [s['id'] for s in ready['stages'][:index]]
    assert index < 8 and ready['stages'][index] == stage and state['current'] == stage['id']
    (out / 'launch_claim').mkdir(exist_ok=False)  # A stage body cannot be invoked twice.
    write(out / 'launch_claim/admission.json', {'utc': utc(), 'authorization_id': grant['authorization_id'],
          'stage': stage, 'readiness_sha256': sha(READY)})


class StageReceipts:
    """Observe only current kernel-owned members; never use sampled ancestry as authority."""
    def __init__(self, job, ready, private_tmp):
        self.job, self.ready, self.private_tmp = job, ready, private_tmp
        self.processes = {}
        self.launch = None
        self.next_observation = 0

    def observe(self):
        if time.monotonic() < self.next_observation:
            return
        self.next_observation = time.monotonic() + .25
        log = self.job.scratch / 'capture_stdout.txt'
        launch = parse_launch(log.read_text() if log.exists() else '',
                              self.ready['resolver']['selectedExecutable']['path'], self.private_tmp)
        if launch:
            self.launch = launch
            self.job.state['profiles'] = [launch['profile']]
            self.job.save()
        rows = self.job.members()
        commands = current_commands(rows) if rows else {}
        for row in rows:
            current = identity(row['pid'])
            if current is None: continue
            assert current['birth'] == row['birth'] and current['uid'] == os.getuid()
            assert coalition(row['pid'])[0] == self.job.coalition_id
            binary = executable_path(row['pid'])
            after = identity(row['pid'])
            if after is None: continue
            observed_coalition = coalition(row['pid'])
            assert after['birth'] == row['birth'] and observed_coalition[0] == self.job.coalition_id
            command = commands.get(row['pid'])
            kind = re.search(r'(?:^|\s)--type=([^\s]+)', command) if command else None
            role = ('apple-video-encoder-xpc' if binary == VTENCODER else
                    'browser' if launch and row['pid'] == launch['pid'] else kind[1] if kind else
                    'owned-launch-helper' if command else 'unclassified-owned-executable')
            record = {'kernel': after, 'coalition': observed_coalition, 'binary': binary,
                      'role': role, 'command_observed': command is not None, 'admitted': False}
            self.processes[(row['pid'], tuple(row['birth']))] = record
            write(self.job.out / 'observed_execution.json', self.receipt())
            assert binary in self.ready['process_binary_sha256'], f'Unbound owned executable: {binary}'
            record.update(admitted=True, prelaunch_sha256=self.ready['process_binary_sha256'][binary])
            write(self.job.out / 'observed_execution.json', self.receipt())
        write(self.job.out / 'observed_execution.json', self.receipt())

    def receipt(self):
        return {'utc': utc(), 'scope': 'OBSERVED_STATION_CHROMIUM_COHORT', 'launch': self.launch,
                'processes': list(self.processes.values()),
                'all_ever_lived_processes_observed': False, 'external_native_XPC_ownership': 'UNQUALIFIED'}

    def require_browser(self):
        assert self.launch and self.launch['angle_metal_requested'], 'Missing actual browser/profile/Metal-request receipt'
        roles = {r['role'] for r in self.processes.values()}
        assert {'browser', 'gpu-process', 'renderer', 'utility'} <= roles, f'Missing observed browser roles: {roles}'


def terminal_audit(job, private_tmp, profiles):
    """Read-only audit; an unresolved exact review-copy path is retained, never globally deleted."""
    assert job.state['drained'] and job.state['clean']
    assert kernel_tasks(job.coalition_id)['live'] == 0 and not job.members()
    for pid, old in job.known.items():
        current = identity(int(pid))
        assert current is None or current['birth'] != old['birth'], f'Owned process remains: {pid}'
    assert not job.scratch.exists() and not Path(private_tmp).exists()
    assert all(not Path(p).exists() for p in profiles)
    check = subprocess.run(['/bin/launchctl', 'print', job.target], capture_output=True, text=True, timeout=3)
    assert check.returncode != 0, 'Owned registration remains'
    temp = [str(ROOT / 'packages/client/public/models/stations' / f'_review_{pid}.glb')
            for pid in job.known if (ROOT / 'packages/client/public/models/stations' / f'_review_{pid}.glb').exists()]
    assert not temp, f'Exact owned review copy retained; direct recovery required: {temp}'
    assertions = subprocess.check_output(['/usr/bin/pmset', '-g', 'assertions'], text=True, timeout=3)
    owned_assertions = []
    for line in assertions.splitlines():
        match = re.search(r'\bpid\s+(\d+)\(', line)
        if match and match[1] in job.known:
            now = identity(int(match[1]))
            if now and now['birth'] == job.known[match[1]]['birth']: owned_assertions.append(line)
    assert not owned_assertions
    # A listener belongs to a live task. Atomic cohort live0 plus exact known-birth
    # absence establishes no owned listeners without enumerating unrelated ports.
    return {'utc': utc(), 'kernel_terminal': kernel_tasks(job.coalition_id), 'known_births_absent': job.known,
            'registration_absent': True, 'scratch_absent': True, 'namespace_absent': True,
            'profiles_absent': profiles, 'exact_owned_review_copies': temp, 'owned_idle_assertions': [],
            'owned_listeners_absent_via_no_live_owned_task': True, 'global_port_scan': False}


def inspect_output(stage, ready, out):
    argv = [ready['decoder_python'], ready['inspector'], json.dumps(stage)]
    result = subprocess.run(argv, cwd=ROOT, env={'PATH': ready['launch_path'], 'PYTHONPATH': ready['decoder_site']},
                            capture_output=True, text=True, timeout=45)
    write(out / 'artifact_inspection_command.json', {'argv': argv,
        'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    assert result.returncode == 0, f'Artifact inspection failed: {result.stderr}'
    inspected = json.loads(result.stdout)
    assert inspected['valid'] is True
    return inspected


def run_stage(stage, out, ready, *, job_factory=StationJob):
    # Called only by run_plan after atomic grant consumption. No per-stage CLI.
    out = Path(out); out.mkdir(exist_ok=False)
    result = {'stage': stage['id'], 'accepted': False, 'primary_failure': None, 'teardown_status': 'UNPROVED',
              'capture_exit': 'UNKNOWN', 'caffeinate_exit': 'UNKNOWN', 'argv': stage['argv'],
              'prepared_output': stage['out_path'], 'performance_qualification': 'UNQUALIFIED_E14_T13',
              'requested_actual_camera_equivalence_claimed': False}
    job = observer = private_tmp = admission = None
    initialised = False
    try:
        require_stage_admission(stage, out, ready)
        assert not (BASE / 'PARENT_HOLD_GPU').exists(), 'Parent hold prevents next stage'
        assert not (ROOT / stage['out_path']).exists(), 'Prepared output already exists; no retry'
        # Rehash source/helper/binary bindings before every stage, not merely once per plan.
        for path, expected in ready['input_sha256'].items(): assert sha(path) == expected, path
        with deadline(CAPTURE_SECONDS):
            started = time.monotonic()
            private_tmp, admission = create_private_tmp(out / 'private_tmp_admission.json')
            job = job_factory.__new__(job_factory)
            job_factory.__init__(job, out / 'owned_job', stage['argv'], ROOT, capture_seconds=CAPTURE_SECONDS,
                env={'PATH': ready['launch_path'], 'DEBUG': 'pw:browser', 'SMOKE_GL': 'metal', 'TMPDIR': str(private_tmp) + os.sep})
            initialised = True
            job.state.update(scope='SEPARATELY_GRANTED_STATION_ROUND4_REMAINING_EIGHT', stage=stage['id'])
            job.save(); job.start()
            observer = StageReceipts(job, ready, private_tmp)
            outcome = job.wait(max(.001, CAPTURE_SECONDS - (time.monotonic() - started)), observer.observe)
            result.update(capture_outcome=outcome, capture_exit=job.state['exits'].get('capture', 'UNKNOWN'),
                          caffeinate_exit=job.state['exits'].get('caffeinate', 'UNKNOWN'))
            assert outcome == 'completed' and result['capture_exit'] == 0, f'Capture failed: {outcome}, exit={result["capture_exit"]}'
            observer.require_browser()
    except BaseException as error:
        result['primary_failure'] = failure(error)
        if getattr(error, 'private_tmp_allocation', None): result['private_tmp_allocation_failure'] = error.private_tmp_allocation
    finally:
        try:
            with deadline(CLEANUP_SECONDS):
                cleanup_started = time.monotonic()
                if job is not None and getattr(job, 'coalition_id', None):
                    drained = job.drain(max(.001, CLEANUP_SECONDS - (time.monotonic() - cleanup_started)))
                    result.update(lifecycle=json.loads(json.dumps(drained)),
                                  capture_exit=drained['exits'].get('capture', 'UNKNOWN'),
                                  caffeinate_exit=drained['exits'].get('caffeinate', 'UNKNOWN'))
                    assert drained['drained'], 'Owned coalition release unproved'
                    job.archive(profile_namespace=private_tmp, profile_prefixes=('playwright_chromiumdev_profile-',))
                    profiles = json.loads((job.out / 'profile_release.json').read_text())
                    assert profiles['all_absent']
                    result['profile_release'] = profiles
                    result['private_tmp_release'] = preserve_private_tmp(private_tmp, admission, out / 'preserved_private_tmp', job=job)
                    result['terminal_audit'] = terminal_audit(job, private_tmp, profiles['all_owned_profiles'])
                    result['teardown_status'] = 'DRAINED_AND_ARCHIVED'
                elif job is not None and initialised:
                    stopped = subprocess.run(['/bin/launchctl', 'bootout', job.target], capture_output=True, text=True, timeout=3)
                    result['prelaunch_teardown'] = {'target': job.target, 'bootout_exit': stopped.returncode,
                                                  'stderr': stopped.stderr, 'retained_scratch': str(job.scratch)}
                    raise RuntimeError('Prelaunch boundary incomplete; release requires direct audit')
                elif job is not None:
                    scratch = getattr(job, 'scratch', None)
                    if scratch and Path(scratch).exists():
                        assert Path(scratch).name.startswith('stations-round4-owned-') and not Path(scratch).is_symlink()
                        shutil.copytree(scratch, out / 'partial_constructor_scratch'); shutil.rmtree(scratch)
                    if private_tmp:
                        result['private_tmp_release'] = preserve_private_tmp(private_tmp, admission, out / 'preserved_private_tmp', no_process_launched=True)
                    result['teardown_status'] = 'NO_PROCESS_LAUNCH_CONSTRUCTOR_SCRATCH_PRESERVED'
                else:
                    allocation = result.get('private_tmp_allocation_failure')
                    assert not allocation or allocation['released'], 'Allocator retained exact namespace; direct recovery required'
                    if private_tmp:
                        result['private_tmp_release'] = preserve_private_tmp(private_tmp, admission, out / 'preserved_private_tmp', no_process_launched=True)
                    result['teardown_status'] = 'NO_JOB_CREATED'
        except BaseException as error:
            result['teardown_failure'] = failure(error)
            result['teardown_status'] = 'UNPROVED'
        if result['primary_failure'] is None and result['teardown_status'] == 'DRAINED_AND_ARCHIVED':
            try:
                assert result['capture_exit'] == 0 and result['caffeinate_exit'] == 0 and result['lifecycle']['clean']
                result['artifacts'] = inspect_output(stage, ready, out)
                result['accepted'] = True
            except BaseException as error:
                result['primary_failure'] = failure(error)
        write(out / 'result.json', result)
    return result


def execute():
    from capture_round4_stage import run_plan
    grant, ready = preflight()
    return run_plan(ready, FREEZE / 'consumed_grants', grant['authorization_id'],
                    lambda stage, out: run_stage(stage, out, ready))
