"""Admission and immutable snapshots for the seven viewmodel capture units."""
import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
from contextlib import contextmanager

MIB = 1024 * 1024
META_CAP = 2 * MIB


class DeadlineExpired(BaseException):
    pass


@contextmanager
def deadline(seconds):
    previous = signal.getsignal(signal.SIGALRM)
    timer = signal.getitimer(signal.ITIMER_REAL)
    import time
    started = time.monotonic()
    def expired(_signal, _frame):
        raise DeadlineExpired(f'Deadline expired after {seconds}s')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, min(seconds, timer[0]) if timer[0] else seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.000001, timer[0] - (time.monotonic() - started)), timer[1])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(path, *, absent=False):
    path = Path(path)
    require(path.is_absolute(), f'Not absolute: {path}')
    require(path == path.resolve(), f'Symlink or noncanonical path: {path}')
    for part in (path, *path.parents):
        require(not part.is_symlink(), f'Symlink: {part}')
    if absent:
        require(not path.exists(), f'Already allocated: {path}')
    return path


def snapshot(path, cap, expected=None, *, identity=None):
    path = canonical(path)
    require(type(cap) is int and cap >= 0, 'Invalid cap')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= cap, f'Not a capped regular file: {path}')
    if identity is not None:
        require([before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns] == identity, 'Admitted file identity changed')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        require(stat.S_ISREG(opened.st_mode) and opened.st_size <= cap, 'Opened descriptor is not a capped regular file')
        require((opened.st_dev, opened.st_ino, opened.st_size) == (before.st_dev, before.st_ino, before.st_size), 'File replaced before open')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(cap + 1)
        after = os.fstat(fd)
    finally:
        os.close(fd)
    require(len(data) <= cap and len(data) == opened.st_size, 'File grew or was truncated')
    require((opened.st_size, opened.st_mtime_ns) == (after.st_size, after.st_mtime_ns), 'File changed during read')
    digest = hashlib.sha256(data).hexdigest()
    require(expected is None or digest == expected, 'Snapshot hash mismatch')
    return data, digest


def json_snapshot(path, cap=META_CAP, expected=None):
    data, digest = snapshot(path, cap, expected)
    def pairs(items):
        out = {}
        for key, value in items:
            require(key not in out, f'Duplicate JSON key: {key}')
            out[key] = value
        return out
    def invalid(value):
        raise ValueError(f'Nonfinite JSON: {value}')
    value = json.loads(data, object_pairs_hook=pairs, parse_constant=invalid)
    require(type(value) is dict, 'Metadata must be an object')
    return value, digest


def raw(value):
    if isinstance(value, bytes):
        return {'base64': base64.b64encode(value).decode(), 'bytes': len(value)}
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, BaseException):
        return {'type': type(value).__name__, 'message': str(value), 'attributes': raw(vars(value))}
    if isinstance(value, dict):
        return {str(k): raw(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [raw(v) for v in value]
    if value is None or type(value) in (str, int, float, bool):
        return value
    return {'type': type(value).__name__, 'repr': repr(value)}


def encoded(value):
    return (json.dumps(raw(value), allow_nan=False, separators=(',', ':')) + '\n').encode()


def exclusive_json(path, value, cap=META_CAP):
    data = encoded(value)
    require(len(data) <= cap, 'Metadata cap exceeded')
    canonical(path, absent=True)
    with open(path, 'xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    return hashlib.sha256(data).hexdigest()


def persist(record, paths, *, write=exclusive_json, emit=None):
    """Each sink is attempted once; interruptions escape with the in-memory record."""
    record.setdefault('persistenceErrors', [])
    for path in paths:
        try:
            write(path, record)
            return {'durable': True, 'path': str(path), 'record': record}
        except Exception as error:
            record['persistenceErrors'].append({'path': str(path), 'error': raw(error)})
        except BaseException as error:
            error.evidence = record
            raise
    if emit:
        try:
            emit(encoded(record))
        except Exception as error:
            record['persistenceErrors'].append({'sink': 'stderr', 'error': raw(error)})
        except BaseException as error:
            error.evidence = record
            raise
    return {'durable': False, 'path': None, 'record': record}


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], timeout=15)


def validate_inventory(plan):
    require(plan['version'] == 1 and plan['copyCount'] == 3, 'Inventory version/copies')
    require(plan['pngCap'] == 16 * MIB and plan['readoutCap'] == 16384, 'File caps')
    require(plan['seconds'] == {'capture': 600, 'cleanup': 60, 'decoder': 45, 'cacheCopy': 30}, 'Deadlines')
    require(len(plan['units']) == 7, 'Seven units required')
    require(sum(len(s['files']) for s in plan['units']) == 101, '101 files required')
    require(sum(s['pngCount'] for s in plan['units']) == 94, '94 PNGs required')
    require(all(type(n) is int and n > 0 for n in plan['reserves'].values()), 'Reserve types')
    for spec in plan['units']:
        files = spec['files']
        require(len(files) == len(set(files)), 'Duplicate output')
        require(all(Path(p).name == p and p.endswith(('.png', '.json')) for p in files), 'Output names')
        require(spec['readoutCap'] == (32768 if spec['kind'] == 'view' else 16384), 'Readout cap')
        pngs = sum(p.endswith('.png') for p in files)
        cap = pngs * plan['pngCap'] + (len(files) - pngs) * spec['readoutCap']
        require(pngs == spec['pngCount'] and cap == spec['outputCap'], 'Output arithmetic')
        require(spec['admission'] == cap * 3 + sum(plan['reserves'].values()), 'Admission arithmetic')
    return plan


def output_manifest(spec, output, expected=None):
    root = canonical(output)
    require(root.is_dir(), 'Output root missing')
    actual = sorted(p.name for p in root.iterdir())
    require(actual == sorted(spec['files']), 'Output inventory differs')
    if expected is not None:
        require(type(expected) is list and len(expected) == len(actual), 'Manifest count')
        require(all(type(row) is dict and set(row) == {'path', 'bytes', 'sha256'} for row in expected), 'Manifest schema')
        require(sorted(r['path'] for r in expected) == actual, 'Manifest names')
    indexed = {r['path']: r for r in expected or []}
    rows = []
    for name in actual:
        cap = 16 * MIB if name.endswith('.png') else spec['readoutCap']
        row = indexed.get(name)
        if row:
            require(type(row['bytes']) is int and 0 < row['bytes'] <= cap, 'Manifest size')
            cap = row['bytes']
        data, digest = snapshot(root / name, cap, row['sha256'] if row else None)
        require(row is None or len(data) == row['bytes'], 'Manifest length')
        rows.append({'path': name, 'bytes': len(data), 'sha256': digest})
    return rows


def verify_worktree(root, head, previous, ignored_digest):
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == head, 'Source HEAD changed')
    require(not git(root, 'diff', '--name-only') and not git(root, 'diff', '--cached', '--name-only'), 'Tracked/staged changes')
    allowed = set()
    for spec, result in previous:
        # This is the same object whose hash and success were admitted, never reopened.
        output = canonical(result['output'])
        output_manifest(spec, output, result['outputManifest'])
        allowed.update(str((output / name).relative_to(root)) for name in spec['files'])
    others = {os.fsdecode(p) for p in git(root, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0') if p}
    require(others == allowed, f'Untracked files differ: {sorted(others ^ allowed)[:8]}')
    from bindings import ignored_inventory
    ignored = ignored_inventory(root)
    require(hashlib.sha256(ignored).hexdigest() == ignored_digest, 'Ignored inventory changed')
