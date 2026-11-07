"""One disabled effects pilot. No native imports, output allocation or launch while disabled."""
import sys
import os
if not __debug__ or sys.flags.optimize or os.environ.get('PYTHONOPTIMIZE', '') not in ('', '0'):
    raise SystemExit('Optimized Python refused')
sys.dont_write_bytecode = True

from pathlib import Path
import shutil
import time
from contract import CAPTURE_SECONDS, CLEANUP_SECONDS, DECODE_SECONDS, HERE, require, snapshot
from bindings import admit, verify
from evidence import Receipts, failure, publish, raw, ownership, reject_unconsumed

RUNTIME_ENABLED = False


def native(ready, result):
    from native_ports import NativePorts
    return NativePorts(ready, result)


def execute(ready_path=HERE / 'readiness.json', *, enabled=RUNTIME_ENABLED, authorization=None,
            verify_source=verify, ports_factory=native, sink=None, stderr=None, cache_guard=None):
    if not enabled:
        return {'accepted': False, 'state': 'DISABLED', 'nativeImports': 0, 'launches': 0, 'allocations': 0}
    require(__debug__ and not sys.flags.optimize, 'Optimized Python refused')
    result = {'accepted': False, 'checksPassed': False, 'errors': [], 'raw': {}, 'jobs': [], 'release': None}
    sink = sink or Receipts()
    stderr = stderr or (lambda data: sys.stderr.buffer.write(data))
    ready_snap = snapshot(ready_path)
    r = ready_snap['value']
    require(r.get('runtimeEnabled') is True, 'Readiness disabled before native imports')
    p = r['pilot']
    grant_snap = snapshot(p['grant'])
    current = verify_source(r)
    result['admission'] = admit(ready_snap, grant_snap, current, authorization or os.environ.get('EFFECTS_AUTHORIZATION'))
    if cache_guard is None:
        from cache_owners import check_cache_owners
        cache_guard = check_cache_owners
    result['raw']['cacheOwnerChecks'] = []
    try:
        cache_guard(r, result['raw']['cacheOwnerChecks'], 'before-consumption-and-snapshot')
    except BaseException as error:
        result['errors'].append({'phase': 'cache-owner-admission', **failure(error)})
        return reject_unconsumed(result, sink, stderr)
    # Source/bindings, fresh paths and exact grant all pass before the one-use identity is consumed.
    require(shutil.disk_usage(Path(p['output']).parent).free >= r['budget']['admissionBytes'], 'Insufficient admission reserve')
    consumption = {'state': 'CONSUMED', 'accepted': False, 'authorizationId': p['authorizationId'],
                   'grantSha256': grant_snap['sha256'], 'readinessSha256': ready_snap['sha256'], 'source': current,
                   'pilot': p, 'pid': os.getpid(), 'uid': os.getuid()}
    # A failure (including late close failure) remains consumed; it is not retried.
    evidence, output = Path(p['evidence']), Path(p['output'])
    try:
        sink.write(p['consumption'], consumption)
    except BaseException as error:
        result['errors'].append({'phase': 'consume', **failure(error)})
        return publish(result, evidence, output, sink, stderr)
    ports, job, observer = None, None, None
    try:
        evidence.mkdir(exist_ok=False)
        output.mkdir(exist_ok=False)
        sink.write(evidence / 'admission.json', result['admission'])
        ports = ports_factory(r, result)
        result['raw']['cacheSnapshot'] = []
        ports.cache_snapshot(r, evidence / 'cache-before', result['raw']['cacheSnapshot'])
        with ports.phase(CAPTURE_SECONDS) as capture_end:
            tmp, admission = ports.allocate_tmp(evidence)
            result['raw']['tmpAdmission'] = raw(admission)
            job = ports.job_object()
            attempted = {'kind': 'StationJob', 'attempted': True, 'initialized': False, 'started': False,
                         'startAttempted': False, 'ownershipAtAttempt': ownership(job)}
            result['jobs'].append(attempted)  # Register BEFORE constructor or start can fail.
            ports.initialize(job, evidence, ready_path)
            attempted['initialized'] = True
            # Exact clean HEAD captured again just before first launch; no unused-grant successor exemption.
            require(verify_source(r) == current, 'Source changed before launch')
            sink.write(evidence / 'prelaunch-source.json', current)
            observer = ports.observer(job)
            cache_guard(r, result['raw']['cacheOwnerChecks'], 'immediately-before-launch')
            require(capture_end - time.monotonic() >= 9, 'Insufficient time for bounded StationJob bootstrap and handshake')
            attempted['startAttempted'] = True
            ports.start(job)
            attempted['started'] = True
            def observe():
                observer.observe()
                ports.budgets(job)
            status = job.wait(max(.001, capture_end - time.monotonic()), observer=observe)
            result['raw']['wait'] = raw(status)
            result['raw']['execution'] = raw(observer.receipt())
            require(status == 'completed', 'Capture did not complete normally')
            require(job.state.get('exits', {}).get('capture') == 0, 'Capture OS exit was not zero')
            observer.require_browser()
    except BaseException as error:
        result['errors'].append({'phase': 'admission-allocation-capture', **failure(error)})
    finally:
        if job is not None:
            result['jobs'][-1]['stateBeforeCleanup'] = raw(getattr(job, 'state', {}))
            result['jobs'][-1]['ownershipBeforeCleanup'] = ownership(job)
            if observer is not None:
                try:
                    result['raw']['executionPartial'] = raw(observer.receipt())
                except BaseException as error:
                    result['errors'].append({'phase': 'partial-execution-receipt', **failure(error)})
        if ports is not None:
            try:
                with ports.phase(CLEANUP_SECONDS):
                    if job is not None:
                        result['release'] = ports.cleanup(job, observer)
                    else:
                        result['raw']['noJobCleanup'] = raw(ports.no_job_cleanup(evidence))
            except BaseException as error:
                result['errors'].append({'phase': 'cleanup', **failure(error)})
        if job is not None:
            result['jobs'][-1]['stateAfterCleanup'] = raw(getattr(job, 'state', {}))
            result['jobs'][-1]['ownershipAfterCleanup'] = ownership(job)
    # No image decoder before positive native cohort, profile, namespace and registration release.
    if not result['errors'] and result['release'] and result['release'].get('released') is True:
        try:
            with ports.phase(DECODE_SECONDS):
                entry = snapshot(evidence / 'entry.json')
                v = entry['value']
                require(v.get('checksPassed') is True and v.get('accepted') is False and v.get('errors') == [] and
                        v.get('readinessSha256') == ready_snap['sha256'] and v.get('consumption') == consumption and
                        v.get('source') == current, 'Entry terminal receipt binding/semantics')
                result['raw']['entrySnapshot'] = entry
                from inspect_packet import inspect_packet
                result['inspection'] = inspect_packet(r, v['writes'])
                require(result['inspection']['valid'] is True, 'CPU validation failed')
                sink.write(evidence / 'inspection.json', result['inspection'])
        except BaseException as error:
            result['errors'].append({'phase': 'released-cpu-decode', **failure(error)})
    else:
        result['raw']['decodeSkipped'] = 'No complete error-free capture with positive release'
    try:
        sink.write(evidence / 'terminal.json', {'release': result['release'], 'jobs': result['jobs'], 'raw': result['raw'], 'errors': result['errors']})
    except BaseException as error:
        result['errors'].append({'phase': 'terminal-write', **failure(error)})
    result['checksPassed'] = not result['errors'] and result.get('inspection', {}).get('valid') is True
    return publish(result, evidence, output, sink, stderr)


def parent_acceptance(result_path, consumption_path, *, observed_os_exit, result_sha256, consumption_sha256):
    """Parent supplies its OS exit observation and exact hashes; a file alone never accepts."""
    require(type(observed_os_exit) is int and observed_os_exit == 0, 'Parent-observed OS exit zero required')
    result, consumed = snapshot(result_path), snapshot(consumption_path)
    require(result['sha256'] == result_sha256 and consumed['sha256'] == consumption_sha256, 'Parent receipt hashes changed')
    r, c = result['value'], consumed['value']
    require(r.get('checksPassed') is True and r.get('accepted') is False and r.get('errors') == [] and r.get('publication') == 'AWAITING_PARENT_OS_EXIT_AND_HASHES', 'No successful terminal checks')
    a = r['admission']
    require(c.get('state') == 'CONSUMED' and c.get('accepted') is False and c.get('grantSha256') == a['grant']['sha256'] and c.get('readinessSha256') == a['ready']['sha256'] and c.get('source') == a['source'] and c.get('pilot') == a['ready']['value']['pilot'], 'Consumed identity differs')
    require(r.get('release', {}).get('released') is True and r.get('inspection', {}).get('valid') is True, 'Release/inspection missing')
    require(not (Path(c['pilot']['output']) / 'failed-result.json').exists(), 'Packet contains failed terminal result')
    return {'accepted': True, 'result': result, 'consumption': consumed, 'observedOsExit': observed_os_exit}


if __name__ == '__main__':
    try:
        outcome = execute()
        # No writes after successful terminal publication. Parent observes this process exit.
        raise SystemExit(0 if outcome.get('accepted') else 78 if outcome.get('state') == 'DISABLED' else 1)
    except Exception as error:
        sys.stderr.write(type(error).__name__ + ': ' + str(error) + '\n')
        raise SystemExit(1)
