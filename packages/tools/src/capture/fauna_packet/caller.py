"""Disabled, one-screen caller. StationJob alone owns capture processes and cleanup."""
import sys
import os
if not __debug__ or sys.flags.optimize != 0 or os.environ.get('PYTHONOPTIMIZE', '') not in ('', '0'):
    raise SystemExit('Optimized Python is refused before imports/allocation')
sys.dont_write_bytecode = True

import argparse
import base64
import copy
import datetime
import hashlib
import importlib
import json
import linecache
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import time
from types import SimpleNamespace

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
if str(HERE) in sys.path:
    sys.path.remove(str(HERE))
READY = HERE / 'readiness.json'
_receipt_bytes = 0
CACHE_SNAPSHOT_SECONDS = 30


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


def read_json(path, maximum=2 * 1024 * 1024, expected_sha256=None):
    p = Path(path)
    require(p.is_file() and not p.is_symlink() and p.stat().st_size <= maximum, 'Unsafe/oversized JSON: ' + str(p))
    with p.open('rb') as stream:
        data = stream.read(maximum + 1)
    require(len(data) <= maximum, 'JSON grew beyond cap: ' + str(p))
    require(expected_sha256 is None or hashlib.sha256(data).hexdigest() == expected_sha256, 'JSON reference drifted: ' + str(p))
    return json.loads(data)


def persist(path, value):
    global _receipt_bytes
    data = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    require(len(data) <= 1024 * 1024, 'Controlled receipt exceeds 1 MiB')
    require(_receipt_bytes + len(data) <= 32 * 1024 * 1024, 'Python controlled receipts exceed aggregate 32 MiB cap')
    _receipt_bytes += len(data)  # Reserve even if close reports failure after bytes were written.
    with Path(path).open('xb') as stream:
        stream.write(data)


def failure(error):
    facts = dict(vars(error))
    # TimeoutExpired.stdout aliases output; retain both public observations.
    if isinstance(error, subprocess.TimeoutExpired):
        facts['stdout'] = error.stdout
        facts['stderr'] = error.stderr
    return {'type': type(error).__name__, 'message': str(error),
            'args': raw_value(error.args), 'attributes': raw_value(facts)}


def raw_value(value):
    """Keep every field of helper observations, including future/unknown fields."""
    if isinstance(value, dict):
        return {str(k): raw_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [raw_value(v) for v in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        data = bytes(value)
        return {'type': type(value).__name__, 'base64': base64.b64encode(data).decode('ascii'),
                'preview': data[:512].decode('utf-8', errors='backslashreplace')}
    if hasattr(value, '__dict__'):
        return raw_value(vars(value))
    return copy.deepcopy(value)


def observed_release(result, evidence, name, function, job, *args, **kwargs):
    """Record boundaries of the unchanged helper before its assertions can discard them."""
    attempt = {'observations': [], 'returned': None, 'failure': None,
               'jobState': raw_value(job.state), 'known': raw_value(getattr(job, 'known', {}))}
    result['raw'].setdefault('releaseAttempts', {})[name] = attempt
    def record(label, value, write=True):
        row = {'probe': label, 'raw': raw_value(value)}
        attempt['observations'].append(row)
        if not write:
            return
        try:
            persist(evidence / ('release-%s-%02d.json' % (name, len(attempt['observations']))), row)
        except BaseException as error:
            result['persistenceFailures'].append({'receipt': name + '/' + label, **failure(error)})
            if not isinstance(error, Exception):
                raise
    def observed(label, call):
        def invoke(*a, **kw):
            try:
                value = call(*a, **kw)
            except BaseException as error:
                record(label, {'args': a, 'kwargs': kw, 'failure': failure(error)}, write=isinstance(error, Exception))
                raise
            record(label, {'args': a, 'kwargs': kw, 'returned': value})
            return value
        return invoke
    namespace = function.__globals__
    replaced = {}
    original_members = job.__dict__.get('members')
    had_members = 'members' in job.__dict__
    record('initial-state', attempt['jobState'])
    paths = [job.scratch, *([args[0], *args[1]] if name == 'terminal' else [kwargs['profile_namespace']])]
    record('paths', [{'path': str(p), 'exists': Path(p).exists(), 'symlink': Path(p).is_symlink()} for p in paths])
    interrupted = False
    try:
        for key in ('kernel_tasks', 'identity', '_archive_profile_paths'):
            if key in namespace:
                replaced[key] = namespace[key]
                namespace[key] = observed(key, namespace[key])
        if 'subprocess' in namespace:
            process = namespace['subprocess']
            replaced['subprocess'] = process
            namespace['subprocess'] = SimpleNamespace(**{key: observed('subprocess.' + key, getattr(process, key))
                                                        for key in ('run', 'check_output') if hasattr(process, key)})
        job.members = observed('members', job.members)
        returned = function(job, *args, **kwargs) if name == 'terminal' else function(*args, **kwargs)
        attempt['returned'] = raw_value(returned)
        return returned
    except BaseException as error:
        interrupted = not isinstance(error, Exception)
        trace = error.__traceback__
        while trace.tb_next:
            trace = trace.tb_next
        attempt['failure'] = {**failure(error), 'source': trace.tb_frame.f_code.co_filename, 'line': trace.tb_lineno,
                              'predicate': linecache.getline(trace.tb_frame.f_code.co_filename, trace.tb_lineno).strip()}
        raise
    finally:
        namespace.update(replaced)
        if had_members:
            job.members = original_members
        else:
            del job.members
        if not interrupted:
            try:
                persist(evidence / ('release-' + name + '-result.json'), attempt)
            except BaseException as error:
                result['persistenceFailures'].append({'receipt': name + '/result', **failure(error)})
                if not isinstance(error, Exception):
                    raise


def inventory(root):
    root = Path(root)
    rows = []
    for p in sorted(root.rglob('*')):
        s = p.lstat()
        require(not p.is_symlink() and (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)), 'Unsafe tree entry: ' + str(p))
        if p.is_file():
            rows.append({'path': str(p.relative_to(root)), 'bytes': s.st_size, 'sha256': sha(p)})
    return rows


def legacy_binding(root, git, commit):
    """Bind retained artifact trees without hydrating or copying historical LFS payloads."""
    require(re.fullmatch(r'[0-9a-f]{40}', commit) is not None, 'Legacy revision must be an immutable commit')
    data = subprocess.check_output([git, 'ls-tree', '-r', '-z', '--full-tree', commit, '--',
                                    'assets/renders/ui/fauna-combat', 'assets/renders/ui/fauna-combat-night'],
                                   cwd=root, timeout=10)
    return {'commit': commit, 'treeListingSha256': hashlib.sha256(data).hexdigest(),
            'files': len([row for row in data.split(b'\0') if row])}


def verify_legacy(ready):
    pin = ready['legacyArchive']
    require(legacy_binding(ready['root'], ready['git'], pin['commit']) == pin, 'Legacy artifact Git identities changed')


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


def verify_bindings(ready, unit=None):
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
    verify_legacy(ready)
    caches = cache_owners(ready)
    free = shutil.disk_usage(ready['root']).free
    admissions = {name: ready['units'][name]['budget']['oneUnitAdmissionBytes'] for name in ready['unitOrder']}
    required = admissions[unit] if unit is not None else max(admissions.values())
    require(free >= required, 'Fresh disk below one-unit accounting')
    return {'status': 'CPU_BINDINGS_ONLY', 'runtimeEnabled': ready['runtimeEnabled'], 'freeBytesObserved': free,
            'perUnitAdmissionBytes': admissions, 'checkedUnit': unit, 'allSixQualified': False, 'caches': caches}


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
    require(grant.get('previousUnitsAccepted') == ready['unitOrder'][:ready['unitOrder'].index(unit)], 'Units must be admitted sequentially; no retry or continuation after failure')
    completions = grant.get('previousUnitReceipts', {})
    require(set(completions) == set(grant['previousUnitsAccepted']), 'Parent-observed caller completion receipts required for every predecessor')
    for previous in grant['previousUnitsAccepted']:
        prior = ready['units'][previous]
        completion = completions[previous]
        result_path = Path(prior['evidence']) / 'result.json'
        consumption_path = Path(prior['consumption'])
        require(completion.get('callerExitCode') == 0 and type(completion.get('callerExitCode')) is int,
                'Parent did not observe a successful predecessor caller exit')
        for key, path in (('result', result_path), ('consumption', consumption_path)):
            reference = completion.get(key, {})
            require(reference.get('path') == str(path) and path.is_file() and not path.is_symlink()
                    and reference.get('sha256') == sha(path), 'Predecessor receipt missing/drifted: ' + key)
        failed_path = result_path.parent / 'failed-result.json'
        require(not failed_path.exists() and not failed_path.is_symlink(), 'Predecessor has failed publication evidence')
        prior_result = read_json(result_path)
        consumed = read_json(consumption_path)
        require(consumed['unit'] == previous and consumed['head'] == current_head
                and consumed['readinessSha256'] == readiness_sha and consumed['spec'] == prior
                and consumed['authorizationId'] == prior['authorizationId'], 'Predecessor transaction binding changed')
        require(prior_result.get('admission') == consumed and prior_result.get('checksPassed') is True
                and prior_result.get('accepted') is False
                and prior_result.get('publication') == {'status': 'AWAITING_CALLER_COMPLETION', 'completeReceipt': None}
                and prior_result.get('primaryFailure') is None and prior_result.get('cleanupFailures') == []
                and prior_result.get('persistenceFailures') == [], 'Predecessor result is failed/indeterminate')
    expiry = datetime.datetime.fromisoformat(grant['expiresUtc'])
    require(expiry.tzinfo is not None and expiry > datetime.datetime.now(datetime.timezone.utc), 'Grant expired')
    return ready['units'][unit]


def verified_output_paths(ready, spec, manifest):
    """Recheck the inspector's complete manifest before allowing its exact Git paths."""
    root, output = Path(ready['root']), Path(spec['output'])
    require(output.is_absolute() and output.resolve() == output and output.is_dir()
            and output.is_relative_to(root) and output != root, 'Unsafe predecessor output root')
    require(isinstance(manifest, list) and len(manifest) == spec['budget']['fileCount'], 'Incomplete output manifest')
    expected, directories = {}, set()
    for row in manifest:
        require(isinstance(row, dict) and set(row) == {'path', 'bytes', 'sha256'}, 'Malformed output manifest row')
        name = row['path']
        require(isinstance(name, str) and name and str(Path(name)) == name and not Path(name).is_absolute()
                and '..' not in Path(name).parts and name != '.' and name not in expected, 'Unsafe/duplicate manifest path')
        require(type(row['bytes']) is int and 0 < row['bytes'] <= (16384 if name == 'readout.txt' else 16 * 1024 * 1024), 'Manifest file cap exceeded')
        expected[name] = row
        directories.update(str(p) for p in Path(name).parents if str(p) != '.')
    files, found_directories = set(), set()
    for path in output.rglob('*'):
        name, info = str(path.relative_to(output)), path.lstat()
        if stat.S_ISDIR(info.st_mode):
            require(name in directories, 'Unexpected output directory: ' + name)
            found_directories.add(name)
        else:
            require(stat.S_ISREG(info.st_mode) and name in expected, 'Unsafe/extra output artifact: ' + name)
            require(info.st_size == expected[name]['bytes'], 'Output artifact size changed: ' + name)
            files.add(name)
    require(files == set(expected) and found_directories == directories, 'Missing output artifact/directory')
    for name, row in expected.items():
        with (output / name).open('rb') as stream:
            data = stream.read(row['bytes'] + 1)
        require(len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], 'Output artifact hash changed: ' + name)
    return {os.fsencode(str((output / name).relative_to(root))) for name in expected}


def verify_worktree(ready, grant):
    allowed = set()
    for previous in grant['previousUnitsAccepted']:
        prior = ready['units'][previous]
        result = read_json(Path(prior['evidence']) / 'result.json',
                           expected_sha256=grant['previousUnitReceipts'][previous]['result']['sha256'])
        allowed.update(verified_output_paths(ready, prior, result['raw'].get('outputManifest')))
    status = subprocess.check_output([ready['git'], 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
                                     cwd=ready['root'], timeout=5)
    require(all(row[:3] == b'?? ' and row[3:] in allowed for row in status.split(b'\0') if row),
            'Worktree has changes outside verified predecessor artifacts')


def consume(ready, unit, grant_path):
    optimization_guard()
    # The disabled candidate is rejected before reading a grant or importing any ownership helper.
    require(ready['runtimeEnabled'] is True, 'Readiness is disabled; no helper import/allocation permitted')
    grant = read_json(grant_path, 16384)
    head = subprocess.check_output([ready['git'], 'rev-parse', 'HEAD'], cwd=ready['root'], text=True, timeout=5).strip()
    spec = grant_gate(ready, unit, grant, sha(READY), head, os.environ.get('FAUNA_CAPTURE_GRANT'))
    require(str(Path(grant_path).resolve()) == spec['grant'] and grant['authorizationId'] == spec['authorizationId'], 'Grant attempt identity changed')
    verify_worktree(ready, grant)
    verify_bindings(ready, unit)
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
    previous = signal.getsignal(signal.SIGALRM)
    timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    def expired(*_):
        raise Refused('Generated cache snapshot deadline expired; copied bytes retained')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, CACHE_SNAPSHOT_SECONDS)
    try:
        for i, root in enumerate(ready['generatedCaches']):
            source = Path(root)
            before = inventory(source)
            destination = evidence / ('cache-before-' + str(i))
            destination.mkdir(mode=0o700)
            for row in before:
                require(row['bytes'] <= maximum - consumed, 'Pre-existing generated cache snapshot exceeds controlled cap')
                target = destination / row['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                with (source / row['path']).open('rb') as src, target.open('xb') as dst:
                    copied = 0
                    while copied < row['bytes']:
                        remaining = min(row['bytes'] - copied, maximum - consumed, 1024 * 1024)
                        require(remaining > 0, 'Generated cache snapshot exhausted controlled cap')
                        chunk = src.read(remaining)
                        require(0 < len(chunk) <= remaining, 'Generated cache changed during snapshot')
                        written = dst.write(chunk)
                        copied += written
                        consumed += written
                        require(written == len(chunk), 'Generated cache snapshot write incomplete; copied bytes retained')
                    require(src.read(1) == b'', 'Generated cache changed during snapshot')
            require(inventory(source) == before == inventory(destination), 'Generated cache changed during snapshot')
            rows.append({'source': root, 'snapshot': str(destination), 'files': before})
        persist(evidence / 'cache-before.json', rows)
        return rows
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.000001, timer[0] - (time.monotonic() - started)), timer[1])


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
    result = {'accepted': False, 'checksPassed': False, 'admission': raw_value(record),
              'primaryFailure': None, 'cleanupFailures': [], 'persistenceFailures': [], 'raw': {}}
    def receipt(name, value):
        try:
            persist(evidence / name, value)
        except BaseException as error:
            result['persistenceFailures'].append({'receipt': name, **failure(error)})
            if not isinstance(error, Exception):
                raise
    job = private = admission = None
    try:
        snapshot_caches(ready, evidence)
        sys.path.insert(0, ready['stationDirectory'])
        core = importlib.import_module('round4_job_boundary')
        temp = importlib.import_module('run_round4_browser_proof')
        support = importlib.import_module('run_round4_remaining8')
        controller = core.identity(os.getpid())
        require(controller and controller['uid'] == ready['uid'], 'Actual controller identity missing')
        result['raw']['controllerBeforeExec'] = {'identity': controller, 'coalition': core.coalition(os.getpid()), 'executable': temp.executable_path(os.getpid())}
        receipt('controller-before-exec.json', result['raw']['controllerBeforeExec'])
        require(not result['persistenceFailures'], 'Controller receipt failed before launch')
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
            result['raw']['jobStateAfterCapture'] = raw_value(job.state)
            receipt('returned-capture-outcome.json', result['raw'])
            require(outcome == 'completed' and job.state['exits'].get('capture') == 0, 'Capture returned failure')
            observer.require_browser()
    except BaseException as error:
        result['primaryFailure'] = failure(error)
        allocation = getattr(error, 'private_tmp_allocation', None)
        if allocation is not None:
            result['raw']['privateTmpAllocation'] = raw_value(allocation)
            if allocation.get('released') is not True:
                result['cleanupFailures'].append({'type': 'RetainedAllocation',
                    'message': 'Allocation failed before returning; helper recovery ownership retained',
                    'allocation': raw_value(allocation)})
    finally:
        if job is not None:
            try:
                with core.deadline(60):
                    require(bool(job.coalition_id), 'No durable cohort; retain allocations for recovery')
                    drained = job.drain(60)
                    result['raw']['drain'] = raw_value(drained)
                    result['raw'].update(drained=drained['drained'], clean=drained['clean'], exits=dict(drained['exits']))
                    receipt('returned-drain.json', drained)
                    result['raw']['kernelBeforeArchive'] = core.kernel_tasks(job.coalition_id)
                    result['raw']['membersBeforeArchive'] = job.members()
                    receipt('before-archive-predicates.json', {'kernel': result['raw']['kernelBeforeArchive'], 'members': result['raw']['membersBeforeArchive']})
                    require(drained['drained'] and result['raw']['kernelBeforeArchive']['live'] == 0 and not result['raw']['membersBeforeArchive'], 'Release predicate failed: drained && kernel.live == 0 && members empty')
                    result['raw']['nativeBeforeArchive'] = observed_thresholds(ready, job, private)
                    receipt('native-before-archive.json', result['raw']['nativeBeforeArchive'])
                    observed_release(result, evidence, 'archive', job.archive, job, profile_namespace=private, profile_prefixes=('playwright_chromiumdev_profile-',))
                    profiles = read_json(job.out / 'profile_release.json')
                    result['raw']['profiles'] = profiles
                    result['raw']['profilesAbsent'] = profiles['all_absent']
                    release = temp.preserve_private_tmp(private, admission, job.out / 'preserved-private-tmp', job=job)
                    result['raw']['tmpRelease'] = raw_value(release)
                    result['raw']['tmpAbsent'] = release['namespace_removed'] and release['all_bytes_preserved']
                    receipt('returned-tmp-release.json', release)
                    terminal = observed_release(result, evidence, 'terminal', support.terminal_audit, job, private, profiles['all_owned_profiles'])
                    result['raw']['terminalAuditRecord'] = raw_value(terminal)
                    result['raw']['terminalAudit'] = True
                    receipt('terminal-audit.json', terminal)
            except BaseException as error:
                result['cleanupFailures'].append(failure(error))
        elif private is not None:
            result['cleanupFailures'].append({'type': 'RetainedAllocation', 'message': 'No durable job; private TMP retained'})
        try:
            persist(evidence / 'cache-after.json', [{'source': p, 'files': inventory(p)} for p in ready['generatedCaches']])
        except BaseException as error:
            result['persistenceFailures'].append(failure(error))
    try:
        receipt('raw-before-acceptance.json', result)
        if result['primaryFailure'] or result['cleanupFailures'] or result['persistenceFailures']:
            raise Refused('Capture/cleanup failed; raw outcome retained')
        result['raw']['outputManifest'] = read_json(evidence / 'entry-result.json')['writes']
        command = [ready['decoderPython'], '-I', '-B', str(HERE / 'inspect.py'), str(READY), record['unit']]
        decoded = subprocess.run(command, capture_output=True, text=True, timeout=45,
                                 env={'PATH': ready['path'], 'PYTHONOPTIMIZE': '0', 'PYTHONDONTWRITEBYTECODE': '1'})
        result['raw']['inspectionCommand'] = {'argv': command, 'result': raw_value(decoded)}
        receipt('inspection-command.json', result['raw']['inspectionCommand'])
        require(decoded.returncode == 0, 'Independent artifact inspector refused output')
        result['raw']['inspection'] = json.loads(decoded.stdout)
        result['raw']['persistenceFailures'] = result['persistenceFailures']
        accept_outcome(result['raw'])
        require(read_json(evidence / 'entry-result.json')['writes'] == result['raw']['outputManifest'], 'Inspected output manifest changed')
        verified_output_paths(ready, spec, result['raw']['outputManifest'])
        verify_legacy(ready)
        receipt('accepted-evidence.json', result['raw'])
        require(not result['persistenceFailures'], 'Evidence persistence failed')
        result['checksPassed'] = True
    except BaseException as error:
        if result['primaryFailure'] is None:
            result['primaryFailure'] = failure(error)
    # Even a complete write can raise after closing. Disk bytes never assert caller
    # success: the parent must bind the observed CLI exit to these exact receipts.
    result['publication'] = {'status': 'AWAITING_CALLER_COMPLETION', 'completeReceipt': None}
    for name in ('result.json', 'failed-result.json'):
        try:
            persist(evidence / name, result)
            result['publication'].update(status='COMPLETE_RESULT_WRITTEN', completeReceipt=name)
            result['accepted'] = result['checksPassed'] and not result['persistenceFailures']
            break
        except BaseException as error:
            result['accepted'] = False
            result['persistenceFailures'].append({'receipt': name, **failure(error)})
    if result['publication']['completeReceipt'] is None:
        result['publication']['status'] = 'UNABLE_TO_PERSIST_COMPLETE_RESULT'
    if not result['accepted']:
        try:
            fallback = json.dumps(result)
            require(len(fallback.encode()) <= 1024 * 1024, 'Stderr result exceeds 1 MiB; complete result retained in memory')
            print(fallback, file=sys.stderr)
        except BaseException as fallback_error:
            result['persistenceFailures'].append({'receipt': 'stderr', **failure(fallback_error)})
    return result


def main():
    optimization_guard()
    p = argparse.ArgumentParser()
    p.add_argument('--check', action='store_true')
    p.add_argument('--execute', choices=['fauna-hit-turn-' + light + '-' + aspect for light in ('day', 'night') for aspect in ('16x9', '21x9')] + ['fauna-combat', 'fauna-combat-night'])
    p.add_argument('--grant')
    args = p.parse_args()
    ready = read_json(READY)
    if not args.execute:
        print(json.dumps(verify_bindings(ready), indent=2))
        return 0
    require(args.grant is not None and not args.check, 'Separate one-use root grant required')
    spec, record = consume(ready, args.execute, args.grant)
    result = run_unit(ready, spec, record)
    return 0 if result['accepted'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Refused as error:
        print(json.dumps({'accepted': False, 'failure': failure(error)}), file=sys.stderr)
        raise SystemExit(2)
