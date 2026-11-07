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


def raw(value, *, cap=20 * MIB, max_nodes=100000, max_depth=128):
    """JSON facts; shared/cyclic values use a reversible, encounter-ordered graph.

    Graph edges are either {ref: node index} or {value: JSON scalar}. Nodes
    retain container kinds and ordered dictionary entries, so user keys cannot
    collide with reference tags. Ordinary trees keep the original receipt shape.
    """
    nodes, seen = [], {}
    remaining = cap
    shared = False
    def charge(amount):
        nonlocal remaining
        remaining -= amount
        require(remaining >= 0, 'Raw observation byte ceiling')
    def scalar(item):
        require(not isinstance(item, str) or len(item) <= remaining, 'Raw observation string ceiling')
        charge(len(json.dumps(item, allow_nan=False).encode()) + 16)
        return {'value': item}
    def visit(item, depth=0):
        nonlocal shared
        require(depth <= max_depth, 'Raw observation depth ceiling')
        if item is None or type(item) in (str, int, bool):
            return scalar(item)
        if type(item) is float:
            import math
            if math.isfinite(item): return scalar(item)
        identity = id(item)
        if identity in seen:
            shared = True
            charge(32)
            return {'ref': seen[identity]}
        require(len(nodes) < max_nodes, 'Raw observation node ceiling')
        charge(128)
        index = len(nodes); seen[identity] = index
        node = {}; nodes.append(node)
        edge = lambda x: visit(x, depth + 1)
        if isinstance(item, bytes):
            charge(4 * ((len(item) + 2) // 3))
            node.update(kind='bytes', base64=base64.b64encode(item).decode(), bytes=len(item))
        elif isinstance(item, Path):
            node.update(kind='path', value=edge(str(item)))
        elif isinstance(item, BaseException):
            node.update(kind='exception', type=type(item).__name__, message=edge(str(item)), attributes=edge(vars(item)))
        elif isinstance(item, dict):
            node.update(kind='dict', entries=[])
            for key, item_value in item.items():
                charge(16)
                node['entries'].append([edge(key), edge(item_value)])
                if type(key) is not str: shared = True
        elif isinstance(item, (tuple, list)):
            node.update(kind='tuple' if isinstance(item, tuple) else 'list', items=[])
            for part in item:
                charge(8); node['items'].append(edge(part))
        elif type(item) is float:
            node.update(kind='float', value=str(item))
        elif hasattr(item, '__dict__'):
            node.update(kind='object', type=type(item).__name__, attributes=edge(vars(item)))
        else:
            node.update(kind='opaque', type=type(item).__name__, representation=edge(repr(item)))
        return {'ref': index}
    root = visit(value)
    if shared:
        result = {'rawGraph': 1, 'root': root, 'nodes': nodes}
    else:
        def tree(edge):
            if 'value' in edge: return edge['value']
            node = nodes[edge['ref']]; kind = node['kind']
            if kind == 'dict': return {tree(k): tree(v) for k, v in node['entries']}
            if kind in ('tuple', 'list'): return [tree(x) for x in node['items']]
            if kind == 'bytes': return {'base64': node['base64'], 'bytes': node['bytes']}
            if kind == 'path': return tree(node['value'])
            if kind == 'float': return {'nonfinite': node['value']}
            if kind == 'exception': return {'type': node['type'], 'message': tree(node['message']), 'attributes': tree(node['attributes'])}
            if kind == 'object': return {'type': node['type'], 'attributes': tree(node['attributes'])}
            return {'type': node['type'], 'repr': tree(node['representation'])}
        result = tree(root)
    require(len(json.dumps(result, allow_nan=False).encode()) <= cap, 'Raw observation encoded ceiling')
    return result


def retain(evidence, destination, key, value, *, encoder=raw):
    """Keep an unencodable original in memory without blocking owned draining."""
    try:
        destination[key] = encoder(value)
        return True
    except Exception as error:
        destination[key] = {'encodingFailed': True}
        evidence.setdefault('unencodedFacts', []).append({'key': key, 'original': value, 'encodingError': error})
        return False


CONSUMPTION_SCHEMA = 'viewmodel-consumption/1'
RESULT_SCHEMA = 'viewmodel-result/1'
CONSUMPTION_FIELDS = frozenset(('schema', 'authorizationId', 'unit', 'sourceHead', 'readySha256',
    'grantSha256', 'grantPath', 'entryToken', 'freeBytesAtAdmission', 'admission', 'previousOutputs'))
RESULT_FIELDS = CONSUMPTION_FIELDS | frozenset(('consumptionSha256', 'accepted', 'checksPassed', 'status',
    'released', 'output', 'outputManifest'))
FAILURE_FIELDS = frozenset(('primaryFailure', 'secondaryFailures', 'persistenceErrors'))


def protocol_document(record):
    """Protocol fields stay JSON; only observations have graph semantics.

    Shared references in manifests/identities have ordinary JSON value semantics.
    Every other (including future unknown) field belongs to one observation graph,
    retaining aliases/cycles across those fields without changing the envelope.
    """
    schema = record['schema']
    require(schema in (CONSUMPTION_SCHEMA, RESULT_SCHEMA), 'Unknown receipt schema')
    fields = RESULT_FIELDS if schema == RESULT_SCHEMA else CONSUMPTION_FIELDS
    document = {key: record[key] for key in record if key in fields}
    # Fail closed for invalid/cyclic protocol data instead of changing its type.
    json.dumps(document, allow_nan=False, separators=(',', ':'))
    if schema == RESULT_SCHEMA:
        require(type(record['accepted']) is bool and record['accepted'] is False, 'Result cannot accept itself')
        require(type(record['checksPassed']) is bool and type(record['released']) is bool, 'Result boolean contract')
        document['primaryFailure'] = raw(record['primaryFailure'])
        for key in ('secondaryFailures', 'persistenceErrors'):
            require(type(record.get(key, [])) is list, 'Failure list contract')
            document[key] = [raw(error) for error in record.get(key, [])]
    failure_fields = FAILURE_FIELDS if schema == RESULT_SCHEMA else frozenset()
    extras = {key: value for key, value in record.items() if key not in fields | failure_fields}
    document['observationEncoding'] = 'raw-graph-or-tree/1'
    document['observations'] = raw(extras)
    return document


def encoded(value):
    if type(value) is dict and value.get('schema') in (CONSUMPTION_SCHEMA, RESULT_SCHEMA):
        document = protocol_document(value)
    else:
        document = raw(value)
    return (json.dumps(document, allow_nan=False, separators=(',', ':')) + '\n').encode()


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
