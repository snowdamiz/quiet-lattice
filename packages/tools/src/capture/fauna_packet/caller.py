"""Disabled, one-screen caller. StationJob alone owns capture processes and cleanup."""
import sys
import os
if not __debug__ or sys.flags.optimize != 0 or os.environ.get('PYTHONOPTIMIZE', '') not in ('', '0'):
    raise SystemExit('Optimized Python is refused before imports/allocation')
sys.dont_write_bytecode = True

import argparse
import datetime
import hashlib
import importlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
if str(HERE) in sys.path:
    sys.path.remove(str(HERE))
READY = HERE / 'readiness.json'
_receipt_bytes = 0


class Refused(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def optimization_guard():
    require(__debug__ and sys.flags.optimize == 0 and os.environ.get('PYTHONOPTIMIZE', '') in ('', '0'),
            'Optimized Python is refused before grant reads, helper imports or allocation')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read_json(path, maximum=2 * 1024 * 1024):
    p = Path(path)
    require(p.is_file() and not p.is_symlink() and p.stat().st_size <= maximum, 'Unsafe/oversized JSON: ' + str(p))
    with p.open('rb') as stream:
        return json.loads(stream.read(maximum + 1))


def persist(path, value):
    global _receipt_bytes
    data = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    require(len(data) <= 1024 * 1024, 'Controlled receipt exceeds 1 MiB')
    require(_receipt_bytes + len(data) <= 32 * 1024 * 1024, 'Python controlled receipts exceed aggregate 32 MiB cap')
    with Path(path).open('xb') as stream:
        stream.write(data)
    _receipt_bytes += len(data)


def failure(error):
    return {'type': type(error).__name__, 'message': str(error)}


def inventory(root):
    root = Path(root)
    rows = []
    for p in sorted(root.rglob('*')):
        s = p.lstat()
        require(not p.is_symlink() and (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)), 'Unsafe tree entry: ' + str(p))
        if p.is_file():
            rows.append({'path': str(p.relative_to(root)), 'bytes': s.st_size, 'sha256': sha(p)})
    return rows


def tree_binding(root, workspace_links=()):
    """Hash all dependency bytes and symlink routes, without following directory links."""
    base = Path(root).resolve()
    h = hashlib.sha256()
    files = total = links = 0
    for directory, names, leaves in os.walk(base, followlinks=False):
        names.sort()
        for name in sorted(names + leaves):
            p = Path(directory) / name
            rel = str(p.relative_to(base))
            if p.is_symlink():
                target = p.resolve(strict=True)
                require(target.is_relative_to(base) or str(target) in workspace_links, 'Dependency symlink escapes pinned routes: ' + str(p))
                row = [rel, 'link', os.readlink(p), str(target)]
                links += 1
            elif p.is_file():
                size = p.stat().st_size
                row = [rel, size, sha(p)]
                files += 1
                total += size
            else:
                continue
            h.update(json.dumps(row, separators=(',', ':')).encode() + b'\n')
    return {'path': str(base), 'sha256': h.hexdigest(), 'files': files, 'bytes': total, 'links': links,
            'workspaceLinks': list(workspace_links)}


def cache_owners(ready):
    """Read only: refuse a task-local Vite/capture owner, leaving all caches untouched."""
    for root in ready['generatedCaches']:
        p = Path(root)
        require(str(p.resolve(strict=True)) == str(p) and p.is_dir() and p.is_relative_to(Path(ready['root'])), 'Generated cache is not task-local')
        probe = subprocess.run(['/usr/sbin/lsof', '-F', 'p', '+D', root], capture_output=True, text=True, timeout=10)
        require(probe.returncode in (0, 1) and not probe.stderr.strip(), 'Cache-owner probe failed')
        require(not probe.stdout.strip(), 'Generated cache has an active open-file owner')
    cwd = subprocess.run(['/usr/sbin/lsof', '-a', '-d', 'cwd', '-u', str(ready['uid']), '-F', 'pn'], capture_output=True, text=True, timeout=10)
    require(cwd.returncode == 0 and not cwd.stderr.strip(), 'Task cwd-owner probe failed')
    pid, candidates = None, []
    for line in cwd.stdout.splitlines():
        if line.startswith('p'):
            pid = line[1:]
        elif line.startswith('n') and line[1:] == ready['root'] and pid:
            candidates.append(pid)
    if candidates:
        commands = subprocess.check_output(['/bin/ps', '-p', ','.join(candidates), '-o', 'command='], text=True, timeout=5)
        require(not any(re.search(r'^(?:\S*/)?(?:node|tsx|pnpm)\s.*(?:vite|capture\.ts|fauna_packet/entry\.mjs)', line) for line in commands.splitlines()), 'Task-local Vite/capture owner is active')
    return {'taskLocalRealpaths': ready['generatedCaches'], 'openCacheOwners': [], 'conflictingTaskLocalViteOwners': []}


def verify_bindings(ready):
    require(str(Path(sys.executable).resolve()) == ready['python'], 'Python route changed')
    require(os.environ.get('PATH') == ready['path'], 'Launcher PATH changed')
    require(os.environ.get('NODE_OPTIONS', '') == '', 'Inherited NODE_OPTIONS refused')
    launch_optimization = subprocess.check_output(['/bin/launchctl', 'getenv', 'PYTHONOPTIMIZE'], text=True, timeout=5).strip()
    require(launch_optimization in ('', '0'), 'Launchd worker Python optimization is refused')
    require(os.getuid() == ready['uid'], 'UID changed')
    for row in ready['bindings']:
        p = Path(row['path'])
        require(str(p.resolve(strict=True)) == row['realpath'] and sha(p) == row['sha256'], 'Binding drift: ' + str(p))
    require(str(Path.cwd().resolve()) == ready['root'], 'Task cwd changed')
    for key in ('dependencies', 'decoderDependencies'):
        pin = ready[key]
        require(tree_binding(pin['path'], pin['workspaceLinks']) == pin, key + ' bytes/routes changed')
    require(inventory(Path(ready['root']) / 'assets/renders/ui/fauna-combat') + inventory(Path(ready['root']) / 'assets/renders/ui/fauna-combat-night') == ready['legacyFiles'], 'Legacy 440 artifacts changed')
    caches = cache_owners(ready)
    free = shutil.disk_usage(ready['root']).free
    require(free >= ready['budget']['oneUnitAdmissionBytes'], 'Fresh disk below one-unit accounting')
    return {'status': 'CPU_BINDINGS_ONLY_RUNTIME_DISABLED', 'freeBytesObserved': free,
            'oneUnitAdmissionBytes': ready['budget']['oneUnitAdmissionBytes'], 'fourUnitsQualified': False, 'caches': caches}


def grant_gate(ready, unit, grant, readiness_sha, current_head, env_authorization):
    optimization_guard()
    require(ready['runtimeEnabled'] is True, 'Readiness is disabled; no runtime grant is implied')
    require(grant.get('purpose') == 'FAUNA_ONE_SCREEN_VISUAL_REPLAY_ONLY' and grant.get('oneUse') is True, 'Wrong-purpose/non-one-use grant')
    require(bool(env_authorization) and grant.get('authorizationId') == env_authorization, 'Explicit root grant identity missing')
    require(grant.get('readinessSha256') == readiness_sha and grant.get('authorizedHead') == current_head, 'Grant/source freeze mismatch')
    require(grant.get('unit') == unit and unit in ready['units'], 'Grant must admit exactly one declared screen')
    require(grant.get('nativeReservesAccepted') is True, 'Native reserves are not hard bounds and need explicit admission')
    review = grant.get('callerReview', {})
    require(review.get('verdict') == 'PASS' and Path(review.get('path', '')).is_file() and sha(review['path']) == review.get('sha256'), 'Independent caller review missing/drifted')
    require(grant.get('previousUnitsAccepted') == list(ready['units'])[:list(ready['units']).index(unit)], 'Units must be admitted sequentially; no retry or continuation after failure')
    for previous in grant['previousUnitsAccepted']:
        require(read_json(Path(ready['units'][previous]['evidence']) / 'result.json')['accepted'] is True, 'Previous unit was not accepted')
    expiry = datetime.datetime.fromisoformat(grant['expiresUtc'])
    require(expiry.tzinfo is not None and expiry > datetime.datetime.now(datetime.timezone.utc), 'Grant expired')
    return ready['units'][unit]


def consume(ready, unit, grant_path):
    optimization_guard()
    # The disabled candidate is rejected before reading a grant or importing any ownership helper.
    require(ready['runtimeEnabled'] is True, 'Readiness is disabled; no helper import/allocation permitted')
    grant = read_json(grant_path, 16384)
    head = subprocess.check_output([ready['git'], 'rev-parse', 'HEAD'], cwd=ready['root'], text=True, timeout=5).strip()
    spec = grant_gate(ready, unit, grant, sha(READY), head, os.environ.get('FAUNA_CAPTURE_GRANT'))
    require(not subprocess.check_output([ready['git'], 'status', '--porcelain'], cwd=ready['root'], text=True, timeout=5).strip(), 'Worktree is not clean')
    verify_bindings(ready)
    for key in ('output', 'evidence', 'consumption'):
        p = Path(spec[key])
        require(p.is_absolute() and p.resolve() == p and not p.exists() and not p.is_symlink(), 'Fresh identity already used: ' + str(p))
    record = {'authorizationId': grant['authorizationId'], 'unit': unit, 'head': head, 'readinessSha256': sha(READY),
              'grantSha256': sha(grant_path), 'spec': spec, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    persist(spec['consumption'], record)  # O_EXCL remains consumed even if a later allocation fails.
    Path(spec['evidence']).mkdir(mode=0o700)
    Path(spec['output']).mkdir(mode=0o700)
    persist(Path(spec['evidence']) / 'admission.json', record)
    return spec, record


def snapshot_caches(ready, evidence):
    maximum = ready['budget']['cacheSnapshotCapBytes']
    consumed = 0
    rows = []
    for i, root in enumerate(ready['generatedCaches']):
        source = Path(root)
        before = inventory(source)
        destination = evidence / ('cache-before-' + str(i))
        destination.mkdir(mode=0o700)
        for row in before:
            consumed += row['bytes']
            require(consumed <= maximum, 'Pre-existing generated cache snapshot exceeds controlled cap')
            target = destination / row['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            with (source / row['path']).open('rb') as src, target.open('xb') as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
        require(inventory(source) == before == inventory(destination), 'Generated cache changed during snapshot')
        rows.append({'source': root, 'snapshot': str(destination), 'files': before})
    persist(evidence / 'cache-before.json', rows)
    return rows


def observed_bytes(root):
    """Conservative observed usage. Native writers can overshoot between observations."""
    if root is None or not Path(root).exists():
        return 0
    total = 0
    for directory, _, files in os.walk(root, followlinks=False):
        for name in files:
            try:
                p = Path(directory) / name
                if not p.is_symlink():
                    total += p.stat().st_size
            except FileNotFoundError:
                pass  # A concurrent native writer removed its own transient file.
    return total


def observed_thresholds(ready, job, private):
    reserves = ready['budget']['nativeReservesAndObservedThresholds']
    profiles = [p for p in Path(private).glob('playwright_chromiumdev_profile-*')] if private and Path(private).exists() else []
    profile_bytes = sum(observed_bytes(p) for p in profiles)
    values = {'nativeProfileWorkingAndArchivePeak': profile_bytes,
              'privateTmpWorkingAndArchivePeak': observed_bytes(private) - profile_bytes,
              'helperLogWorkingAndArchivePeak': observed_bytes(job.scratch) + observed_bytes(job.out),
              'generatedCacheGrowth': sum(observed_bytes(p) for p in ready['generatedCaches'])}
    # Before copying, source thresholds leave the matching copy/archive reserve free.
    limits = {**reserves, 'nativeProfileWorkingAndArchivePeak': reserves['nativeProfileWorkingAndArchivePeak'] // 2,
              'privateTmpWorkingAndArchivePeak': reserves['privateTmpWorkingAndArchivePeak'] // 2,
              'helperLogWorkingAndArchivePeak': reserves['helperLogWorkingAndArchivePeak'] // 2,
              'generatedCacheGrowth': ready['initialCacheBytes'] + reserves['generatedCacheGrowth']}
    for key, value in values.items():
        require(value <= limits[key], 'Observed native stop threshold reached: ' + key)
    require(shutil.disk_usage(ready['root']).free >= ready['budget']['safetyReserveBytes'], 'Disk safety reserve reached')
    return {'observedBytes': values, 'stopThresholds': limits, 'hardQuota': False}


def accept_outcome(raw):
    require(isinstance(raw, dict), 'Malformed outcome')
    require(raw.get('outcome') == 'completed' and raw.get('exits', {}).get('capture') == 0, 'Capture returned failure')
    require(raw.get('drained') is True and raw.get('clean') is True and raw.get('exits', {}).get('caffeinate') == 0, 'Terminal drain failed')
    require(raw.get('profilesAbsent') is True and raw.get('tmpAbsent') is True and raw.get('terminalAudit') is True, 'Incomplete terminal resource release')
    require(raw.get('inspection', {}).get('accepted') is True and not raw.get('persistenceFailures'), 'Artifact/persistence acceptance failed')


def run_unit(ready, spec, record):
    evidence = Path(spec['evidence'])
    result = {'accepted': False, 'primaryFailure': None, 'cleanupFailures': [], 'persistenceFailures': [], 'raw': {}}
    job = private = admission = None
    try:
        snapshot_caches(ready, evidence)
        sys.path.insert(0, ready['stationDirectory'])
        core = importlib.import_module('round4_job_boundary')
        temp = importlib.import_module('run_round4_browser_proof')
        support = importlib.import_module('run_round4_remaining8')
        controller = core.identity(os.getpid())
        require(controller and controller['uid'] == ready['uid'], 'Actual controller identity missing')
        persist(evidence / 'controller-before-exec.json', {'identity': controller, 'coalition': core.coalition(os.getpid()), 'executable': temp.executable_path(os.getpid())})
        with core.deadline(600):
            private, admission = temp.create_private_tmp(evidence / 'private-tmp-admission.json')
            argv = [ready['node'], str(HERE / 'entry.mjs'), str(READY), record['unit'], spec['consumption']]
            env = {'PATH': ready['path'], 'TMPDIR': str(private) + '/', 'HOME': str(private), 'SMOKE_GL': 'metal',
                   'PLAYWRIGHT_BROWSERS_PATH': ready['browserCache'], 'DEBUG': 'pw:browser', 'NODE_OPTIONS': '',
                   'PYTHONOPTIMIZE': '0', 'PYTHONDONTWRITEBYTECODE': '1'}
            job = core.StationJob.__new__(core.StationJob)
            core.StationJob.__init__(job, evidence / 'owned-job', argv, ready['root'], capture_seconds=600, env=env)
            job.start()
            observer = support.StageReceipts(job, ready, private)  # Unchanged ordinary-launch path.
            started = time.monotonic()
            def observe():
                observer.observe()
                observed_thresholds(ready, job, private)
            outcome = job.wait(max(0.001, 600 - (time.monotonic() - started)), observe)
            result['raw'].update(outcome=outcome, exits=dict(job.state['exits']))
            persist(evidence / 'returned-capture-outcome.json', result['raw'])
            require(outcome == 'completed' and job.state['exits'].get('capture') == 0, 'Capture returned failure')
            observer.require_browser()
    except BaseException as error:
        result['primaryFailure'] = failure(error)
    finally:
        if job is not None:
            try:
                with core.deadline(60):
                    require(bool(job.coalition_id), 'No durable cohort; retain allocations for recovery')
                    drained = job.drain(60)
                    result['raw'].update(drained=drained['drained'], clean=drained['clean'], exits=dict(drained['exits']))
                    persist(evidence / 'returned-drain.json', drained)
                    require(drained['drained'] and core.kernel_tasks(job.coalition_id)['live'] == 0 and not job.members(), 'Live owned tasks remain')
                    persist(evidence / 'native-before-archive.json', observed_thresholds(ready, job, private))
                    job.archive(profile_namespace=private, profile_prefixes=('playwright_chromiumdev_profile-',))
                    profiles = read_json(job.out / 'profile_release.json')
                    result['raw']['profilesAbsent'] = profiles['all_absent']
                    release = temp.preserve_private_tmp(private, admission, job.out / 'preserved-private-tmp', job=job)
                    result['raw']['tmpAbsent'] = release['namespace_removed'] and release['all_bytes_preserved']
                    persist(evidence / 'returned-tmp-release.json', release)
                    terminal = support.terminal_audit(job, private, profiles['all_owned_profiles'])
                    result['raw']['terminalAudit'] = True
                    persist(evidence / 'terminal-audit.json', terminal)
            except BaseException as error:
                result['cleanupFailures'].append(failure(error))
        elif private is not None:
            result['cleanupFailures'].append({'type': 'RetainedAllocation', 'message': 'No durable job; private TMP retained'})
        try:
            persist(evidence / 'cache-after.json', [{'source': p, 'files': inventory(p)} for p in ready['generatedCaches']])
        except BaseException as error:
            result['persistenceFailures'].append(failure(error))
    try:
        persist(evidence / 'raw-before-acceptance.json', result)
        if result['primaryFailure'] or result['cleanupFailures'] or result['persistenceFailures']:
            raise Refused('Capture/cleanup failed; raw outcome retained')
        command = [ready['decoderPython'], '-I', '-B', str(HERE / 'inspect.py'), str(READY), record['unit']]
        decoded = subprocess.run(command, capture_output=True, text=True, timeout=45,
                                 env={'PATH': ready['path'], 'PYTHONOPTIMIZE': '0', 'PYTHONDONTWRITEBYTECODE': '1'})
        persist(evidence / 'inspection-command.json', {'argv': command, 'exit': decoded.returncode, 'stdout': decoded.stdout, 'stderr': decoded.stderr})
        require(decoded.returncode == 0, 'Independent artifact inspector refused output')
        result['raw']['inspection'] = json.loads(decoded.stdout)
        result['raw']['persistenceFailures'] = result['persistenceFailures']
        accept_outcome(result['raw'])
        require(inventory(Path(ready['root']) / 'assets/renders/ui/fauna-combat') + inventory(Path(ready['root']) / 'assets/renders/ui/fauna-combat-night') == ready['legacyFiles'], 'Legacy artifacts changed during capture')
        persist(evidence / 'accepted-evidence.json', result['raw'])
        result['accepted'] = True
    except BaseException as error:
        if result['primaryFailure'] is None:
            result['primaryFailure'] = failure(error)
    try:
        persist(evidence / 'result.json', result)
    except BaseException as error:
        result['accepted'] = False
        result['persistenceFailures'].append(failure(error))
        print(json.dumps(result), file=sys.stderr)
    return result


def main():
    optimization_guard()
    p = argparse.ArgumentParser()
    p.add_argument('--check', action='store_true')
    p.add_argument('--execute', choices=['fauna-hit-turn-' + light + '-' + aspect for light in ('day', 'night') for aspect in ('16x9', '21x9')])
    p.add_argument('--grant')
    args = p.parse_args()
    ready = read_json(READY)
    if not args.execute:
        print(json.dumps(verify_bindings(ready), indent=2))
        return 0
    require(args.grant is not None and not args.check, 'Separate one-use root grant required')
    spec, record = consume(ready, args.execute, args.grant)
    result = run_unit(ready, spec, record)
    print(json.dumps(result, indent=2))
    return 0 if result['accepted'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Refused as error:
        print(json.dumps({'accepted': False, 'failure': failure(error)}), file=sys.stderr)
        raise SystemExit(2)
