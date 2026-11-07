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
import tempfile
sys.dont_write_bytecode = True
from metadata import Evidence, Refused, atomic, digest, encode, failure, file_hash, ledger, snapshot, raw_facts, Directory, mkdir, copy_tree, io_deadline
from freeze import BOUNDS, LIMITS, PURPOSE, capacity, verify_freeze
from retained_reads import retained_reads


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
    mkdir(path)  # Anchored atomic one-use claim; a partial claim stays spent.
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
        if args or any(value for key, value in kwargs.items() if key not in ('symlinks',)):
            raise Refused('Unexpected archive-copy options')
        return copy_tree(source, destination, count=LIMITS['profileFiles'], cap=LIMITS['profileBytes'])
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


@contextmanager
def producer_commands():
    """Observe the retained helpers' actual producer returns before writes or assertions."""
    state = {'records': [], 'bytes': 0, 'complete': True, 'bootstrap': None}
    exceptions = []
    original_run, original_output = subprocess.run, subprocess.check_output
    def wrap(name, operation):
        def observed(*args, **kwargs):
            argv = args[0] if args else kwargs.get('args')
            bootstrap = isinstance(argv, (list, tuple)) and list(argv[:2]) == ['/bin/launchctl', 'bootstrap']
            if bootstrap:
                # Crossing this producer is an attempted dispatch. An exception cannot prove nonregistration.
                state['bootstrap'] = {'attempted': True, 'completion': 'unknown', 'returncode': None, 'registeredMayExist': True}
            try:
                value = operation(*args, **kwargs)
            except BaseException as error:
                exceptions.append(error)
                record = {'operation': name, 'argv': raw_facts(argv), 'failure': failure(error)}
                keep(record)
                raise
            # Detached before control returns to immutable helper write/assertion code.
            record = {'operation': name, 'argv': raw_facts(argv), 'returned': raw_facts(value)}
            if bootstrap:
                code = getattr(value, 'returncode', None)
                state['bootstrap'].update(completion='returned', returncode=code, registeredMayExist=code == 0 or type(code) is not int)
            keep(record)
            return value
        return observed
    def keep(record):
        raw = encode(record)
        if len(state['records']) >= 6000 or state['bytes'] + len(raw) > 16 * 1024**2:
            state['complete'] = False
            raise Refused('Native producer facts ceiling', {'records': len(state['records']), 'bytes': state['bytes']})
        state['records'].append(record)
        state['bytes'] += len(raw)
        if record.get('returned', {}).get('complete') is False or record.get('failure', {}).get('rawComplete') is False:
            state['complete'] = False
            raise Refused('Native producer facts incomplete')
    subprocess.run, subprocess.check_output = wrap('run', original_run), wrap('check_output', original_output)
    try:
        yield state, exceptions
    finally:
        subprocess.run, subprocess.check_output = original_run, original_output


def run_owned(ready, grant_snapshot, admission_facts, helpers, *, job_factory=None):
    read_facts = []
    with producer_commands() as producers, retained_reads(helpers, read_facts, LIMITS) as close_reads:
        return _run_owned(ready, grant_snapshot, admission_facts, helpers, producers, read_facts, close_reads, job_factory=job_factory)


def _run_owned(ready, grant_snapshot, admission_facts, helpers, producers, read_facts, close_reads, *, job_factory=None):
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
    terminal_at = time.monotonic() + BOUNDS['terminalMs'] / 1000
    result['terminalDeadlineMonotonic'] = terminal_at
    result['retainedReadFacts'] = read_facts  # Owned journal survives even a pre-drain snapshot timeout.
    command_facts, command_exceptions = producers
    first_observer = None
    first_observer_facts = None
    job = observer = private_tmp = private_admission = None
    factory = job_factory or boundary.StationJob
    def retain(name, value):
        try:
            evidence.put(name, value)
        except BaseException as error:
            result['secondary'].append(failure(error))
            raise
    def observe_body():
        ledger(ready['frozenRoot'], count=LIMITS['frozenFiles'], cap=LIMITS['frozenBytes'], hash_files=False, live=True)
        for location in [job.scratch, out, private_tmp]:
            ledger(location, count=LIMITS['outputFiles'], cap=LIMITS['outputBytes'], hash_files=False, live=location == private_tmp)
        log = job.scratch / 'capture_stdout.txt'
        if log.exists() and log.lstat().st_size > LIMITS['logBytes']:
            raise Refused('Native log cap exceeded')
        read_failure = None
        try:
            observer.observe()
        except BaseException as error:
            read_failure = error
            raise
        finally:
            close_reads(read_failure)
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
    def observe():
        nonlocal first_observer, first_observer_facts
        offset = len(command_exceptions)
        try:
            observe_body()
        except BaseException as error:
            original = command_exceptions[offset] if len(command_exceptions) > offset else error
            if first_observer is None:
                first_observer, first_observer_facts = original, failure(original)
            if error is not original:
                result['secondary'].append(failure(error))
            raise
    try:
        # Claim is already spent. Only directories allocated here are evidence sinks.
        for path in (out, fallback):
            mkdir(path)
            info = path.lstat()
            allocated.append({'path': str(path), 'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid})
            evidence.roots.append(path)
        mkdir(out / 'capture')
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
            # Canonical owned scratch prevents platform /var aliases in retained helper paths.
            previous_tempdir = tempfile.tempdir
            tempfile.tempdir = str(private_tmp)
            try:
                factory.__init__(job, out / 'owned_job', argv, ready['frozenRoot'], capture_seconds=BOUNDS['captureMs'] / 1000,
                                 env={'PATH': binding['launchPath'], 'TMPDIR': str(private_tmp) + '/', 'SMOKE_GL': 'metal', 'DEBUG': 'pw:browser', 'PYTHONDONTWRITEBYTECODE': '1'})
            finally:
                tempfile.tempdir = previous_tempdir
            job.start()
            observer = stages.StageReceipts(job, {'prefix': binding['prefix'],
                'resolver': {'selectedExecutable': {'path': binding['browser']}},
                'process_binary_sha256': {**{r['path']: r['sha256'] for r in binding['binaries']}, **{str(Path(ready['frozenRoot']) / Path(r['path']).relative_to(ready['root'])): r['sha256'] for r in binding['binaries'] if Path(r['path']).is_relative_to(ready['root'])}}}, private_tmp,
                structured_launch_receipt=out / 'capture/browser-launch.json')
            outcome = job.wait(max(.001, BOUNDS['captureMs'] / 1000 - (time.monotonic() - started)), observe)
            if first_observer is not None:
                raise first_observer
            result['captureExit'] = job.state['exits'].get('capture', 'UNKNOWN')
            result['outcome'] = outcome
            if outcome != 'completed' or result['captureExit'] != 0:
                raise Refused('Capture did not exit normally', copy.deepcopy(job.state))
            observer.require_browser()
            packet = snapshot(out / 'capture/packet.json')
            retain('child-packet-snapshot.json', {'value': packet['value'], 'facts': packet['facts']})
            validate_packet(packet['value'])
    except BaseException as error:
        result['failure'] = first_observer_facts if first_observer is not None else failure(error)
        if first_observer is not None and error is not first_observer:
            result['secondary'].append(failure(error))
    finally:
        # Preserve returned raw/unknown controller facts before drain changes any state.
        result['beforeDrain'] = {'complete': False}
        try:
            with io_deadline(max(.001, min(2, terminal_at - time.monotonic() - 32))):
                for key, value in [('allocated', allocated), ('job', getattr(job, 'state', None)),
                                   ('scratch', str(getattr(job, 'scratch', 'UNKNOWN'))),
                                   ('privateTmp', str(private_tmp) if private_tmp else None)]:
                    result['beforeDrain'][key] = copy.deepcopy(value)
                result['beforeDrain']['observer'] = copy.deepcopy(observer.receipt() if observer else None)
                result['beforeDrain']['retainedReads'] = copy.deepcopy(read_facts)
                result['beforeDrain']['complete'] = True
                retain('before-physical-drain.json', result['beforeDrain'])
        except BaseException as error:
            result['secondary'].append(failure(error))
            # The detached partial facts remain; independent mandatory drain always follows.
        try:
            drain_seconds = max(.001, min(BOUNDS['drainMs'] / 1000, terminal_at - time.monotonic() - 32))
            with boundary.deadline(drain_seconds):
                if job is not None and getattr(job, 'coalition_id', None):
                    drained = job.drain(drain_seconds)
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
                        'target': getattr(job, 'target', None), 'registered': getattr(job, 'registered', 'UNKNOWN'),
                        'bootstrapProducer': copy.deepcopy(command_facts['bootstrap'])}
                    if getattr(job, 'registered', False) or (command_facts['bootstrap'] or {}).get('registeredMayExist'):
                        p = subprocess.run(['/bin/launchctl', 'bootout', job.target], capture_output=True, timeout=3)
                        result['partialAllocation']['bootout'] = raw_facts(p)
                    raise Refused('Partial constructor/bootstrap needs exact retained-path audit; release unproved')
                elif private_tmp is not None:
                    with bounded_copies():
                        result['tmpRelease'] = proof.preserve_private_tmp(private_tmp, private_admission, out / 'preserved-private-tmp', no_process_launched=True)
                    result['physicalSettlement'] = 'NO_PROCESS_ALLOCATED'
        except BaseException as error:
            result['secondary'].append(failure(error))
        # Inventory failure must not skip the terminal snapshot. Each ledger is independent.
        result['terminalPublication'] = {'durable': False, 'provisional': True}
        try:
            with io_deadline(max(.001, min(28, terminal_at - time.monotonic() - 4))):
                for key, location, count, cap, live in [
                    ('frozenTerminalLedger', ready['frozenRoot'], LIMITS['frozenFiles'], LIMITS['frozenBytes'], True),
                    ('outputLedger', out, LIMITS['outputFiles'], LIMITS['outputBytes'], False)]:
                    try:
                        result[key] = ledger(location, count=count, cap=cap, live=live)
                    except BaseException as error:
                        result['secondary'].append(failure(error))
                        result[key] = {'complete': False, 'failure': failure(error)}
                        if not isinstance(error, Exception):
                            raise
                try:
                    retain('native-producer-facts.json', command_facts)
                except BaseException:
                    pass  # Complete in-memory producer facts still accompany failure publication.
        except BaseException as error:
            result['secondary'].append(failure(error))
        result['nativeProducerFacts'] = copy.deepcopy(command_facts)
        result['candidate'] = (result['failure'] is None and not result['secondary'] and not evidence.errors and command_facts['complete'] and
            result['physicalSettlement'] == 'DRAINED_ARCHIVED_AUDITED' and result['captureExit'] == 0 and
            result.get('lifecycle', {}).get('clean') is True and result.get('lifecycle', {}).get('exits', {}).get('caffeinate') == 0)
        result['evidence'] = evidence.receipt()
        # Even if the inventory phase exhausted its timer, publication gets a finite bounded attempt.
        # Reserve this small interval inside the existing terminal envelope by limiting inventories above.
        try:
            with io_deadline(max(.001, min(2, terminal_at - time.monotonic() - 2))):
                receipt = evidence.put('result.json', result)
                result['terminalPublication'] = {'durable': True, 'receipt': receipt, 'provisional': True}
        except BaseException as error:
            result['secondary'].append(failure(error))
            result['candidate'] = False
        if evidence.errors:
            result['candidate'] = False
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
    if not result['candidate'] or not result['terminalPublication']['durable'] or result['evidence']['undurable']:
        try:
            with io_deadline(max(.001, min(2, result['terminalDeadlineMonotonic'] - time.monotonic()))):
                print(json.dumps({'kind': 'T13_UNDURABLE_CONTROLLER_EVIDENCE', 'accepted': False, 'result': result}), file=sys.stderr, flush=True)
        except BaseException as error:
            result['candidate'] = False
            result['secondary'].append(failure(error))
            result['terminalEmission'] = {'durable': False, 'failure': failure(error)}
    # A disk flag never authorizes a successor. Parent must observe this actual exit and hash receipts.
    return 0 if result['candidate'] else 1


if __name__ == '__main__':
    try:
        exit_code = main(sys.argv[1:])
    except BaseException as error:
        print(json.dumps({'accepted': False, 'candidate': False, 'failure': failure(error)}), file=sys.stderr)
        exit_code = 2
    sys.exit(exit_code)
