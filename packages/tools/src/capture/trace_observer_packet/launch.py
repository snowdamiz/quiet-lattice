"""One disabled-by-default T13 launch. No scheduler, retry, grant issuer, or successor."""
import argparse
from contextlib import contextmanager
import copy
import importlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
sys.dont_write_bytecode = True
from metadata import Evidence, Refused, atomic, digest, encode, failure, file_hash, ledger, snapshot
from freeze import BOUNDS, LIMITS, PURPOSE, capacity, verify_freeze


def admit(ready_path, ready_hash, grant_path, grant_hash, *, verify=verify_freeze, now=time.time):
    ready_snapshot = snapshot(ready_path, ready_hash)
    ready = ready_snapshot['value']
    if not isinstance(ready, dict) or ready.get('runtimeAuthorized') is not True:
        raise Refused('Trace observer readiness disabled')  # No grant read or native imports/allocations.
    if ready.get('kind') != 'T13_OBSERVER_LOCAL_BINDING_V1' or ready.get('purpose') != PURPOSE:
        raise Refused('Readiness identity refused')
    verify(ready)
    binding = ready['binding']
    if str(grant_path) != binding['grant']:
        raise Refused('Grant path differs')
    grant_snapshot = snapshot(grant_path, grant_hash)
    grant = grant_snapshot['value']
    expected = {'purpose': PURPOSE, 'head': ready['head'], 'tree': ready['tree'], 'readinessSha256': ready_hash,
                'planSha256': ready['planSha256'], 'output': binding['output'], 'consumption': binding['consumption']}
    if not isinstance(grant, dict) or any(grant.get(k) != v for k, v in expected.items()):
        raise Refused('Grant scope/head/readiness/output mismatch', grant_snapshot['facts'])
    expires = grant.get('expiresAtEpochSeconds')
    if type(expires) not in (int, float) or not now() < expires <= now() + 3600:
        raise Refused('Grant expired or invalid expiry', grant_snapshot['facts'])
    load = grant.get('controlledLoad')
    if not isinstance(load, dict) or load.get('ourHeavyCpuJobsQuiesced') is not True or not isinstance(load.get('gpuReservation'), str) or not load['gpuReservation']:
        raise Refused('Explicit reserved GPU/quiesced CPU contract required', grant_snapshot['facts'])
    if load.get('externalContenders') != 'unknown-not-excluded' or load.get('maxLoad') != binding['controlledLoad']['maxLoad']:
        raise Refused('Load contract mismatch')
    for key in ('output', 'fallback', 'consumption'):
        p = Path(binding[key])
        if p.exists() or p.is_symlink() or not p.is_absolute() or p.parent.resolve() != p.parent or p.is_relative_to(Path(ready['root'])):
            raise Refused('Attempt path occupied or unsafe: ' + key)
    available = capacity(Path(binding['output']).parent)
    if available['availableBytes'] < LIMITS['minimumFreeBytes']:
        raise Refused('Current admission capacity insufficient', available)
    return ready, grant_snapshot, {'readiness': ready_snapshot['facts'], 'grant': grant_snapshot['facts'], 'capacity': available}


def consume(ready, grant_snapshot):
    expires = grant_snapshot['value'].get('expiresAtEpochSeconds')
    if type(expires) not in (int, float) or expires <= time.time():
        raise Refused('Grant expired before atomic consumption')
    path = Path(ready['binding']['consumption'])
    path.mkdir(mode=0o700)  # Atomic one-use claim; a partial claim stays spent.
    atomic(path / 'grant.json', grant_snapshot['raw'])
    consumed = snapshot(path / 'grant.json', grant_snapshot['sha256'])
    if consumed['value'] != grant_snapshot['value']:
        raise Refused('Consumption snapshot differs')
    return consumed


def native_helpers(root):
    path = str(Path(root) / 'assets/blend/stations/_authoring')
    sys.path.insert(0, path)
    boundary = importlib.import_module('round4_job_boundary')
    proof = importlib.import_module('run_round4_browser_proof')
    stages = importlib.import_module('run_round4_remaining8')
    return boundary, proof, stages


def content(archive):
    return [{'path': r['path'], 'bytes': r['bytes'], 'sha256': r.get('sha256'), 'mode': r['stamp'][2] & 0o777}
            for r in archive['files']]


@contextmanager
def bounded_copies():
    original = shutil.copytree
    def checked(source, destination, *args, **kwargs):
        before = ledger(source, count=LIMITS['profileFiles'], cap=LIMITS['profileBytes'])
        result = original(source, destination, *args, **kwargs)
        after = ledger(destination, count=LIMITS['profileFiles'], cap=LIMITS['profileBytes'])
        if content(before) != content(after) or content(before) != content(ledger(source)):
            raise Refused('Archive copy differs; originals retained')
        return result
    shutil.copytree = checked
    try:
        yield
    finally:
        shutil.copytree = original


def validate_packet(value):
    if (not isinstance(value, dict) or value.get('kind') != 'T13_TRACE_OBSERVER_V1' or
        value.get('status') != 'observed' or value.get('failure') is not None or value.get('cleanupErrors') != [] or
        value.get('portSettlement', {}).get('kind') != 'ports-settled' or value.get('summary', {}).get('budgetQualified') is not False):
        raise Refused('Child packet incomplete/failed')
    totals = value.get('totals', {})
    for key in ('preparations', 'frames', 'dependentPasses', 'preflightFences', 'controlFences', 'png', 'queries', 'segments'):
        if type(totals.get(key)) is not int or totals[key] != BOUNDS[key]:
            raise Refused('Child completed inventory mismatch: ' + key)
    if type(totals.get('warmUpFrames')) is not int or not 12 <= totals['warmUpFrames'] <= 7200:
        raise Refused('Child warm-up bound mismatch')
    if len(value.get('steps', [])) != 12 or value.get('applicability', {}).get('missingControls') != 0:
        raise Refused('Child step inventory incomplete')
    for key, cap in [('bytes', BOUNDS['traceBytes']), ('reads', BOUNDS['reads']), ('events', BOUNDS['events'])]:
        if type(totals.get(key)) is not int or not 0 < totals[key] <= cap:
            raise Refused('Child trace aggregate mismatch')


def run_owned(ready, grant_snapshot, admission_facts, helpers, *, job_factory=None):
    boundary, proof, stages = helpers
    binding, out = ready['binding'], Path(ready['binding']['output'])
    fallback = Path(binding['fallback'])
    evidence = Evidence([])
    allocated = []
    result = {'kind': 'T13_OBSERVER_PHYSICAL_TERMINAL_V1', 'accepted': False, 'candidate': False,
              'requiresParentObservedOSExitAndHashes': True, 'failure': None, 'secondary': [],
              'captureExit': 'UNKNOWN', 'physicalSettlement': 'UNPROVED', 'portsSettlementIsPhysical': False,
              'readinessSha256': admission_facts['readiness']['sha256'], 'grantSha256': grant_snapshot['sha256'],
              'admission': admission_facts, 'historical': {'cloud03': 'FAILED', 'accepted': False}}
    job = observer = private_tmp = private_admission = None
    factory = job_factory or boundary.StationJob
    def retain(name, value):
        try:
            evidence.put(name, value)
        except BaseException as error:
            result['secondary'].append(failure(error))
            raise
    def observe():
        ledger(ready['frozenRoot'], count=LIMITS['frozenFiles'], cap=LIMITS['frozenBytes'], hash_files=False, live=True)
        for location in [job.scratch, out, private_tmp]:
            ledger(location, count=LIMITS['outputFiles'], cap=LIMITS['outputBytes'], hash_files=False, live=location == private_tmp)
        log = job.scratch / 'capture_stdout.txt'
        if log.exists() and log.lstat().st_size > LIMITS['logBytes']:
            raise Refused('Native log cap exceeded')
        observer.observe()
        request = out / 'capture/kernel-request.json'
        release = out / 'capture/kernel-release.json'
        if request.exists() and not release.exists():
            raw = snapshot(request, cap=65536)
            retain('kernel-request-received.json', {'value': raw['value'], 'facts': raw['facts']})
            value = raw['value']
            observer.require_browser()
            if value['prefix'] != binding['prefix'] or value['browserPid'] != observer.launch['pid']:
                raise Refused('Browser kernel request mismatch')
            renderer_pids = []
            for item in value['processes']:
                if item['type'].lower() != 'renderer':
                    continue
                current = boundary.identity(item['id'])
                records = [r for r in observer.processes.values() if r['kernel']['pid'] == item['id'] and r['role'] == 'renderer' and r['admitted']]
                if len(records) != 1 or any(current.get(k) != records[0]['kernel'].get(k) for k in ('pid', 'uid', 'birth')) or boundary.coalition(item['id'])[0] != job.coalition_id:
                    raise Refused('Renderer current birth/UID/coalition differs')
                renderer_pids.append(item['id'])
            if not renderer_pids:
                raise Refused('No actual current renderer')
            atomic(release, encode({'prefix': binding['prefix'], 'browserPid': observer.launch['pid'],
                                   'rendererPids': renderer_pids, 'requestSha256': raw['sha256']}))
    try:
        # Claim is already spent. Only directories allocated here are evidence sinks.
        for path in (out, fallback):
            path.mkdir(mode=0o700)
            info = path.lstat()
            allocated.append({'path': str(path), 'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid})
            evidence.roots.append(path)
        (out / 'capture').mkdir()
        retain('admitted-snapshots.json', admission_facts)
        with boundary.deadline(BOUNDS['captureMs'] / 1000):
            started = time.monotonic()
            private_tmp, private_admission = proof.create_private_tmp(out / 'private-tmp.json')
            child = {**ready, 'grant': grant_snapshot['value'], 'grantSha256': grant_snapshot['sha256'],
                     'admittedReadinessSha256': admission_facts['readiness']['sha256'],
                     'privateTmp': str(private_tmp), 'capture': str(out / 'capture'), 'fallback': str(fallback)}
            raw = encode(child)
            atomic(out / 'child-admission.json', raw)
            argv = [binding['node'], '--import', str(Path(ready['frozenRoot']) / Path(binding['tsx']).relative_to(ready['root'])), str(Path(ready['frozenRoot']) / 'packages/tools/src/capture/trace_observer_packet/worker.ts'),
                    '--owned', str(out / 'child-admission.json'), digest(raw)]
            job = factory.__new__(factory)
            factory.__init__(job, out / 'owned_job', argv, ready['frozenRoot'], capture_seconds=BOUNDS['captureMs'] / 1000,
                             env={'PATH': binding['launchPath'], 'TMPDIR': str(private_tmp) + '/', 'SMOKE_GL': 'metal', 'DEBUG': 'pw:browser', 'PYTHONDONTWRITEBYTECODE': '1'})
            job.start()
            observer = stages.StageReceipts(job, {'prefix': binding['prefix'],
                'resolver': {'selectedExecutable': {'path': binding['browser']}},
                'process_binary_sha256': {**{r['path']: r['sha256'] for r in binding['binaries']}, **{str(Path(ready['frozenRoot']) / Path(r['path']).relative_to(ready['root'])): r['sha256'] for r in binding['binaries'] if Path(r['path']).is_relative_to(ready['root'])}}}, private_tmp,
                structured_launch_receipt=out / 'capture/browser-launch.json')
            outcome = job.wait(max(.001, BOUNDS['captureMs'] / 1000 - (time.monotonic() - started)), observe)
            result['captureExit'] = job.state['exits'].get('capture', 'UNKNOWN')
            result['outcome'] = outcome
            if outcome != 'completed' or result['captureExit'] != 0:
                raise Refused('Capture did not exit normally', copy.deepcopy(job.state))
            observer.require_browser()
            packet = snapshot(out / 'capture/packet.json')
            retain('child-packet-snapshot.json', {'value': packet['value'], 'facts': packet['facts']})
            validate_packet(packet['value'])
    except BaseException as error:
        result['failure'] = failure(error)
    finally:
        # Preserve returned raw/unknown controller facts before drain changes any state.
        result['beforeDrain'] = copy.deepcopy({'allocated': allocated, 'job': getattr(job, 'state', None),
            'observer': observer.receipt() if observer else None,
            'scratch': str(getattr(job, 'scratch', 'UNKNOWN')), 'privateTmp': str(private_tmp) if private_tmp else None})
        try:
            retain('before-physical-drain.json', result['beforeDrain'])
        except BaseException:
            pass  # Persistence failure does not prevent the independent owned-process drain.
        try:
            with boundary.deadline(BOUNDS['drainMs'] / 1000):
                if job is not None and getattr(job, 'coalition_id', None):
                    drained = job.drain(BOUNDS['drainMs'] / 1000)
                    result['lifecycle'] = copy.deepcopy(drained)
                    result['captureExit'] = drained['exits'].get('capture', 'UNKNOWN')
                    if not drained['drained'] or boundary.kernel_tasks(job.coalition_id)['live'] != 0:
                        raise Refused('Physical coalition remains; no archive/release')
                    with bounded_copies():
                        # Backup scratch bytes before the accepted archive body unlinks anything.
                        shutil.copytree(job.scratch, out / 'preserved-controller-scratch')
                        job.archive(profile_namespace=private_tmp, profile_prefixes=('playwright_chromiumdev_profile-',))
                        profiles = snapshot(job.out / 'profile_release.json')['value']
                        if profiles['all_absent'] is not True:
                            raise Refused('Profile release incomplete')
                        result['tmpRelease'] = proof.preserve_private_tmp(private_tmp, private_admission, out / 'preserved-private-tmp', job=job)
                    result['terminalAudit'] = stages.terminal_audit(job, private_tmp, profiles['all_owned_profiles'])
                    result['physicalSettlement'] = 'DRAINED_ARCHIVED_AUDITED'
                elif job is not None:
                    # A partial bootstrap has no proven coalition. Retain exact identities; never invent release.
                    result['partialAllocation'] = {'scratch': str(getattr(job, 'scratch', 'UNKNOWN')),
                        'target': getattr(job, 'target', None), 'registered': getattr(job, 'registered', 'UNKNOWN')}
                    if getattr(job, 'registered', False):
                        p = subprocess.run(['/bin/launchctl', 'bootout', job.target], capture_output=True, timeout=3)
                        result['partialAllocation']['bootout'] = {'exit': p.returncode, 'stdout': p.stdout.decode(errors='replace'), 'stderr': p.stderr.decode(errors='replace')}
                    raise Refused('Partial constructor/bootstrap needs exact retained-path audit; release unproved')
                elif private_tmp is not None:
                    with bounded_copies():
                        result['tmpRelease'] = proof.preserve_private_tmp(private_tmp, private_admission, out / 'preserved-private-tmp', no_process_launched=True)
                    result['physicalSettlement'] = 'NO_PROCESS_ALLOCATED'
        except BaseException as error:
            result['secondary'].append(failure(error))
        result['candidate'] = (result['failure'] is None and not result['secondary'] and not evidence.errors and
            result['physicalSettlement'] == 'DRAINED_ARCHIVED_AUDITED' and result['captureExit'] == 0 and
            result.get('lifecycle', {}).get('clean') is True and result.get('lifecycle', {}).get('exits', {}).get('caffeinate') == 0)
        result['evidence'] = evidence.receipt()
        try:
            result['frozenTerminalLedger'] = ledger(ready['frozenRoot'], count=LIMITS['frozenFiles'], cap=LIMITS['frozenBytes'], live=True)
            result['outputLedger'] = ledger(out, count=LIMITS['outputFiles'], cap=LIMITS['outputBytes'])
            retain('result.json', result)
            if evidence.errors:
                result['candidate'] = False
                result['evidence'] = evidence.receipt()
        except BaseException as error:
            result['candidate'] = False
            result['secondary'].append(failure(error))
            result['evidence'] = evidence.receipt()
    return result


def main(args, *, helpers=native_helpers):
    parser = argparse.ArgumentParser()
    parser.add_argument('--readiness', required=True)
    parser.add_argument('--readiness-sha256', required=True)
    parser.add_argument('--grant', required=True)
    parser.add_argument('--grant-sha256', required=True)
    parsed = parser.parse_args(args)
    ready, grant, facts = admit(parsed.readiness, parsed.readiness_sha256, parsed.grant, parsed.grant_sha256)
    consume(ready, grant)
    owned_helpers = helpers(ready['frozenRoot'])
    if (str(Path(sys.executable).resolve()) != ready['binding']['pythonLauncher'] or
        owned_helpers[1].executable_path(os.getpid()) != ready['binding']['pythonKernel']):
        raise Refused('Actual Python launcher/kernel executable differs')
    result = run_owned(ready, grant, facts, owned_helpers)
    if result['evidence']['undurable']:
        print(json.dumps({'kind': 'T13_UNDURABLE_CONTROLLER_EVIDENCE', 'accepted': False, 'result': result}), file=sys.stderr)
    # A disk flag never authorizes a successor. Parent must observe this actual exit and hash receipts.
    return 0 if result['candidate'] else 1


if __name__ == '__main__':
    try:
        exit_code = main(sys.argv[1:])
    except BaseException as error:
        print(json.dumps({'accepted': False, 'candidate': False, 'failure': failure(error)}), file=sys.stderr)
        exit_code = 2
    sys.exit(exit_code)
