"""Disabled, one-screen caller. StationJob alone owns capture processes and cleanup."""
import sys
import os
if not __debug__ or sys.flags.optimize != 0 or os.environ.get('PYTHONOPTIMIZE', '') not in ('', '0'):
    raise SystemExit('Optimized Python is refused before imports/allocation')
sys.dont_write_bytecode = True

import argparse
import base64
import copy
from contextlib import contextmanager
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
from typing import NamedTuple

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
if str(HERE) in sys.path:
    sys.path.remove(str(HERE))
READY = HERE / 'readiness.json'
_receipt_bytes = 0
CACHE_SNAPSHOT_SECONDS = 30
CACHE_ENTRY_CAP = 256
CACHE_ENTRY_METADATA_CAP = 1024


class Refused(RuntimeError):
    pass


class GrantAdmission(NamedTuple):
    spec: dict
    predecessor_outputs: tuple


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


def same_entry(a, b, directory=False):
    return (a.st_dev, a.st_ino, stat.S_IFMT(a.st_mode)) == (b.st_dev, b.st_ino, stat.S_IFMT(b.st_mode)) and (directory or a.st_size == b.st_size)


@contextmanager
def controlled_path(path, maximum=None, expected=None, directory=False):
    """Keep the supplied pathname and pin every no-follow ancestor through the read."""
    p = Path(path).absolute()
    require('..' not in p.parts, 'Unsafe controlled path: ' + str(p))
    expected = expected or {}
    descriptors, routes = [], []
    stream = primary = None
    try:
        parent = os.open(p.anchor, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_DIRECTORY)
        descriptors.append(parent)
        fd = parent
        opened = os.fstat(parent)
        current = Path(p.anchor)
        for i, name in enumerate(p.parts[1:]):
            current = current / name
            is_directory = i < len(p.parts) - 2 or directory
            before = os.stat(name, dir_fd=parent, follow_symlinks=False)
            require(stat.S_ISDIR(before.st_mode) if is_directory else stat.S_ISREG(before.st_mode), 'Unsafe controlled entry: ' + str(current))
            if str(current) in expected:
                require(same_entry(before, expected[str(current)], is_directory), 'Controlled entry changed before open: ' + str(current))
            if not is_directory:
                require(before.st_size <= maximum, 'Unsafe/oversized controlled file: ' + str(p))
            flags = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | (os.O_DIRECTORY if is_directory else 0)
            fd = os.open(name, flags, dir_fd=parent)
            descriptors.append(fd)
            opened = os.fstat(fd)
            require(same_entry(before, opened, is_directory), 'Controlled entry changed during open: ' + str(current))
            require(stat.S_ISDIR(opened.st_mode) if is_directory else stat.S_ISREG(opened.st_mode) and opened.st_size <= maximum, 'Unsafe opened entry: ' + str(current))
            routes.append((parent, name, opened, is_directory, str(current)))
            parent = fd
        def validate_route(ancestors_only=False):
            for parent_fd, name, observed, is_directory, label in routes:
                if ancestors_only and not is_directory:
                    continue
                require(same_entry(os.stat(name, dir_fd=parent_fd, follow_symlinks=False), observed, is_directory), 'Controlled pathname changed: ' + label)
        validate_route()
        if not directory:
            stream = os.fdopen(fd, 'rb', buffering=0, closefd=False)
        yield (fd if directory else stream), opened, {label: info for _, _, info, _, label in routes}
        # Leaf bytes already form the authenticated snapshot; keep the ancestor route pinned.
        validate_route(ancestors_only=True)
    except BaseException as error:
        primary = error
        raise
    finally:
        pending = primary
        closes = ([('stream.close', stream.close, descriptors[-1])] if stream is not None else [])
        closes += [('os.close', lambda fd=fd: os.close(fd), fd) for fd in reversed(descriptors)]
        for operation, close, fd in closes:
            try:
                close()
            except BaseException as error:
                fact = {'operation': operation, 'path': str(p), 'descriptor': fd, **failure(error)}
                if pending is None:
                    pending = error
                pending.metadata_close_failures = getattr(pending, 'metadata_close_failures', []) + [fact]
        if primary is None and pending is not None:
            raise pending


def bounded_read(path, maximum, expected=None, keep=False, sink=None, finish=None):
    """One descriptor snapshot supplies all bytes, the digest and optional bounded copy."""
    observation = {'path': str(path), 'maximum': maximum, 'readBytes': 0, 'copiedBytes': 0}
    try:
        with controlled_path(path, maximum, expected) as (stream, opened, _):
            observation.update(dev=opened.st_dev, inode=opened.st_ino, bytes=opened.st_size)
            digest, pieces = hashlib.sha256(), []
            while True:
                count = maximum + 1 if keep else min(1024 * 1024, opened.st_size - observation['readBytes'] + 1)
                data = stream.read(count)
                observation['readBytes'] += len(data)
                require(observation['readBytes'] <= opened.st_size, 'Controlled file grew during read: ' + str(path))
                if not data:
                    break
                digest.update(data)
                if keep:
                    pieces.append(data)
                if sink is not None:
                    written = sink.write(data)
                    observation['copiedBytes'] += written
                    require(written == len(data), 'Generated cache snapshot write incomplete; copied bytes retained')
                if keep:
                    break
            require(observation['readBytes'] == opened.st_size, 'Controlled file truncated during read: ' + str(path))
            value = (b''.join(pieces) if keep else None), digest.hexdigest()
            return finish(*value) if finish is not None else value
    except BaseException as error:
        error.controlled_read = observation
        raise


def read_json_snapshot(path, maximum=2 * 1024 * 1024, expected_sha256=None):
    def parsed(data, digest):
        require(expected_sha256 is None or digest == expected_sha256, 'JSON reference drifted: ' + str(path))
        return json.loads(data), digest
    return bounded_read(path, maximum, keep=True, finish=parsed)


def read_json(path, maximum=2 * 1024 * 1024, expected_sha256=None):
    return read_json_snapshot(path, maximum, expected_sha256)[0]


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


def tree_plan(root, maximum, entry_cap=CACHE_ENTRY_CAP, metadata_cap=CACHE_ENTRY_METADATA_CAP, observation=None):
    """Admit every entry and aggregate size before any payload read."""
    root = Path(root).absolute()
    observation = observation if observation is not None else {'entries': [], 'bytes': 0}
    files, directories, pins = [], set(), {}
    with controlled_path(root.parent, directory=True) as (parent, _, route):
        pins.update(route)
        try:
            info = os.stat(root.name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return {'root': root, 'files': [], 'directories': set(), 'pins': pins}
        require(stat.S_ISDIR(info.st_mode), 'Unsafe tree root: ' + str(root))
        pins[str(root)] = info
    pending = [root]
    while pending:
        directory = pending.pop()
        with controlled_path(directory, expected=pins, directory=True) as (fd, _, route):
            pins.update(route)
            with os.scandir(fd) as entries:
                for entry in entries:
                    path = directory / entry.name
                    info = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                    is_directory = stat.S_ISDIR(info.st_mode)
                    require(is_directory or stat.S_ISREG(info.st_mode), 'Unsafe tree entry: ' + str(path))
                    name = str(path.relative_to(root))
                    fact = {'path': name, 'source': str(path), 'bytes': info.st_size if not is_directory else 0, 'type': 'directory' if is_directory else 'file', 'dev': info.st_dev, 'inode': info.st_ino}
                    require(len(observation['entries']) < entry_cap and len(json.dumps(fact).encode()) <= metadata_cap, 'Controlled tree entry/evidence cap exceeded')
                    observation['entries'].append(fact)
                    if is_directory:
                        directories.add(name); pending.append(path)
                    else:
                        observation['bytes'] += info.st_size
                        require(observation['bytes'] <= maximum, 'Generated cache/artifact inventory exceeds controlled cap')
                        files.append({'path': name, 'bytes': info.st_size})
                    pins[str(path)] = info
    return {'root': root, 'files': sorted(files, key=lambda row: row['path']), 'directories': directories, 'pins': pins}


def hash_plan(plan, rows=None):
    rows = rows if rows is not None else []
    for row in plan['files']:
        _, digest = bounded_read(plan['root'] / row['path'], row['bytes'], plan['pins'])
        rows.append({**row, 'sha256': digest})
    return rows


def inventory(root):
    return hash_plan(tree_plan(root, 320 * 1024 * 1024, entry_cap=1024))


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
    require(review.get('verdict') == 'PASS' and bounded_read(review.get('path', ''), 2 * 1024 * 1024)[1] == review.get('sha256'), 'Independent caller review missing/drifted')
    require(grant.get('previousUnitsAccepted') == ready['unitOrder'][:ready['unitOrder'].index(unit)], 'Units must be admitted sequentially; no retry or continuation after failure')
    completions = grant.get('previousUnitReceipts', {})
    require(set(completions) == set(grant['previousUnitsAccepted']), 'Parent-observed caller completion receipts required for every predecessor')
    predecessor_outputs = []
    for previous in grant['previousUnitsAccepted']:
        prior = ready['units'][previous]
        completion = completions[previous]
        result_path = Path(prior['evidence']) / 'result.json'
        consumption_path = Path(prior['consumption'])
        require(completion.get('callerExitCode') == 0 and type(completion.get('callerExitCode')) is int,
                'Parent did not observe a successful predecessor caller exit')
        for key, path in (('result', result_path), ('consumption', consumption_path)):
            reference = completion.get(key, {})
            require(reference.get('path') == str(path) and isinstance(reference.get('sha256'), str), 'Predecessor receipt reference missing: ' + key)
        failed_path = result_path.parent / 'failed-result.json'
        require(not failed_path.exists() and not failed_path.is_symlink(), 'Predecessor has failed publication evidence')
        prior_result = read_json(result_path, expected_sha256=completion['result']['sha256'])
        consumed = read_json(consumption_path, expected_sha256=completion['consumption']['sha256'])
        require(consumed['unit'] == previous and consumed['head'] == current_head
                and consumed['readinessSha256'] == readiness_sha and consumed['spec'] == prior
                and consumed['authorizationId'] == prior['authorizationId'], 'Predecessor transaction binding changed')
        require(prior_result.get('admission') == consumed and prior_result.get('checksPassed') is True
                and prior_result.get('accepted') is False
                and prior_result.get('publication') == {'status': 'AWAITING_CALLER_COMPLETION', 'completeReceipt': None}
                and prior_result.get('primaryFailure') is None and prior_result.get('cleanupFailures') == []
                and prior_result.get('persistenceFailures') == [], 'Predecessor result is failed/indeterminate')
        predecessor_outputs.append((prior, prior_result['raw'].get('outputManifest')))
    expiry = datetime.datetime.fromisoformat(grant['expiresUtc'])
    require(expiry.tzinfo is not None and expiry > datetime.datetime.now(datetime.timezone.utc), 'Grant expired')
    return GrantAdmission(ready['units'][unit], tuple(predecessor_outputs))


def verified_output_paths(ready, spec, manifest):
    """Recheck the inspector's complete manifest before allowing its exact Git paths."""
    root, output = Path(ready['root']), Path(spec['output'])
    require(output.is_absolute() and output.is_relative_to(root) and output != root, 'Unsafe predecessor output root')
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
    plan = tree_plan(output, sum(row['bytes'] for row in expected.values()), entry_cap=len(expected) + len(directories))
    require({row['path'] for row in plan['files']} == set(expected) and plan['directories'] == directories, 'Missing/extra output artifact/directory')
    for row in plan['files']:
        name = row['path']
        require(row['bytes'] == expected[name]['bytes'], 'Output artifact size changed: ' + name)
        _, digest = bounded_read(output / name, row['bytes'], plan['pins'])
        require(digest == expected[name]['sha256'], 'Output artifact hash changed: ' + name)
    return {os.fsencode(str((output / name).relative_to(root))) for name in expected}


def verify_worktree(ready, predecessor_outputs):
    allowed = set()
    for prior, manifest in predecessor_outputs:
        allowed.update(verified_output_paths(ready, prior, manifest))
    status = subprocess.check_output([ready['git'], 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
                                     cwd=ready['root'], timeout=5)
    require(all(row[:3] == b'?? ' and row[3:] in allowed for row in status.split(b'\0') if row),
            'Worktree has changes outside verified predecessor artifacts')


def consume(ready, unit, grant_path):
    optimization_guard()
    # The disabled candidate is rejected before reading a grant or importing any ownership helper.
    require(ready['runtimeEnabled'] is True, 'Readiness is disabled; no helper import/allocation permitted')
    frozen, readiness_sha = read_json_snapshot(READY)
    require(frozen == ready, 'Readiness changed before admission')
    grant, grant_sha = read_json_snapshot(grant_path, 16384)
    head = subprocess.check_output([ready['git'], 'rev-parse', 'HEAD'], cwd=ready['root'], text=True, timeout=5).strip()
    admission = grant_gate(ready, unit, grant, readiness_sha, head, os.environ.get('FAUNA_CAPTURE_GRANT'))
    spec = admission.spec
    require(str(Path(grant_path).absolute()) == spec['grant'] and grant['authorizationId'] == spec['authorizationId'], 'Grant attempt identity changed')
    verify_worktree(ready, admission.predecessor_outputs)
    verify_bindings(ready, unit)
    for key in ('output', 'evidence', 'consumption'):
        p = Path(spec[key])
        require(p.is_absolute() and p.resolve() == p and not p.exists() and not p.is_symlink(), 'Fresh identity already used: ' + str(p))
    record = {'authorizationId': grant['authorizationId'], 'unit': unit, 'head': head, 'readinessSha256': readiness_sha,
              'grantSha256': grant_sha, 'spec': spec, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    persist(spec['consumption'], record)  # O_EXCL remains consumed even if a later allocation fails.
    Path(spec['evidence']).mkdir(mode=0o700)
    Path(spec['output']).mkdir(mode=0o700)
    persist(Path(spec['evidence']) / 'admission.json', record)
    return spec, record


class CacheDeadlineExpired(Refused):
    pass


@contextmanager
def cache_deadline():
    previous, timer = signal.getsignal(signal.SIGALRM), signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    def expired(*_):
        raise CacheDeadlineExpired('Generated cache snapshot deadline expired; copied bytes retained')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, min(CACHE_SNAPSHOT_SECONDS, timer[0]) if timer[0] else CACHE_SNAPSHOT_SECONDS)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.000001, timer[0] - (time.monotonic() - started)), timer[1])


def cache_plans(ready, maximum, observation):
    plans = []
    for root in ready['generatedCaches']:
        plans.append(tree_plan(root, maximum, observation=observation))
    return plans


def cache_size_admission(ready, maximum):
    observation = {'entries': [], 'bytes': 0}
    with cache_deadline():
        cache_plans(ready, maximum, observation)
    return observation


def snapshot_caches(ready, evidence):
    observation = {'entries': [], 'bytes': 0, 'copies': [], 'complete': False}
    try:
        with cache_deadline():
            plans = cache_plans(ready, ready['budget']['cacheSnapshotCapBytes'], observation)
            rows = []
            observation['snapshots'] = rows
            for i, plan in enumerate(plans):
                destination = evidence / ('cache-before-' + str(i))
                before = []
                rows.append({'source': str(plan['root']), 'snapshot': str(destination), 'files': before})
                hash_plan(plan, before)
                destination.mkdir(mode=0o700)
                copied_rows = []
                for row in before:
                    target = destination / row['path']
                    target.parent.mkdir(parents=True, exist_ok=True)
                    copy_fact = {'source': str(plan['root'] / row['path']), 'destination': str(target), 'admittedBytes': row['bytes'], 'complete': False}
                    require(len(json.dumps(copy_fact).encode()) <= CACHE_ENTRY_METADATA_CAP, 'Cache copy evidence cap exceeded')
                    observation['copies'].append(copy_fact)
                    # Output is exclusive; the source is read through the same guarded descriptor.
                    primary = None
                    dst = target.open('xb', buffering=0)
                    try:
                        _, digest = bounded_read(plan['root'] / row['path'], row['bytes'], plan['pins'], sink=dst)
                        require(digest == row['sha256'], 'Generated cache changed during snapshot')
                    except BaseException as error:
                        primary = error
                        raise
                    finally:
                        try:
                            dst.close()
                        except BaseException as error:
                            fact = {'path': str(target), **failure(error)}
                            if primary is None:
                                error.cache_copy_close = fact
                                raise
                            primary.cache_copy_close = fact
                    copy_fact['complete'] = True
                    copied_rows.append({**row, 'sha256': digest})
                admitted_bytes = sum(row['bytes'] for row in before)
                source_after = tree_plan(plan['root'], admitted_bytes, entry_cap=len(plan['files']) + len(plan['directories']))
                require(source_after['files'] == plan['files'] and source_after['directories'] == plan['directories']
                        and all(path in source_after['pins'] and same_entry(info, source_after['pins'][path], stat.S_ISDIR(info.st_mode))
                                for path, info in plan['pins'].items()), 'Generated cache changed during snapshot')
                require(hash_plan(source_after) == before, 'Generated cache changed during snapshot')
                expected_directories = {str(parent) for row in before for parent in Path(row['path']).parents if str(parent) != '.'}
                copied_plan = tree_plan(destination, admitted_bytes, entry_cap=len(before) + len(expected_directories))
                require(copied_plan['files'] == plan['files'] and copied_plan['directories'] == expected_directories,
                        'Generated cache snapshot verification shape changed')
                copied = hash_plan(copied_plan)
                require(copied == before == copied_rows, 'Generated cache changed during snapshot')
            persist(evidence / 'cache-before.json', rows)
            observation['complete'] = True
            return rows
    except BaseException as error:
        error.cacheObservation = observation
        raise


def cache_after(ready, observation):
    if not ready['generatedCaches']:
        observation['complete'] = True
        return []
    with cache_deadline():
        maximum = ready['initialCacheBytes'] + ready['budget']['nativeReservesAndObservedThresholds']['generatedCacheGrowth']
        plans = cache_plans(ready, maximum, observation)
        rows = []
        for plan in plans:
            files = []
            row = {'source': str(plan['root']), 'files': files}
            rows.append(row)
            observation['inventories'] = rows
            for item in plan['files']:
                _, digest = bounded_read(plan['root'] / item['path'], item['bytes'], plan['pins'])
                files.append({**item, 'sha256': digest})
        observation['complete'] = True
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
              'generatedCacheGrowth': cache_size_admission(ready, ready['initialCacheBytes'] + reserves['generatedCacheGrowth'])['bytes']}
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
    caches_snapshotted = interrupted = False
    try:
        snapshot_caches(ready, evidence)
        caches_snapshotted = True
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
        interrupted = not isinstance(error, Exception) or isinstance(error, CacheDeadlineExpired)
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
                interrupted = interrupted or not isinstance(error, Exception) or isinstance(error, CacheDeadlineExpired)
                result['cleanupFailures'].append(failure(error))
        elif private is not None:
            result['cleanupFailures'].append({'type': 'RetainedAllocation', 'message': 'No durable job; private TMP retained'})
        observation = {'entries': [], 'bytes': 0, 'complete': False}
        result['raw']['cacheAfter'] = observation
        if not caches_snapshotted or interrupted:
            observation['skipped'] = 'interrupted' if interrupted else 'snapshot failed; source and partial copies retained'
        else:
            try:
                with cache_deadline():
                    rows = cache_after(ready, observation)
                    persist(evidence / 'cache-after.json', rows)
            except BaseException as error:
                observation['failure'] = failure(error)
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
