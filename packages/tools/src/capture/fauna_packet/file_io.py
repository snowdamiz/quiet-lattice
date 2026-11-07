"""Task-local file descriptors and raw facts; no caller, process ownership or launch APIs."""
import base64
import copy
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

CACHE_ENTRY_CAP = 256
CACHE_ENTRY_METADATA_CAP = 1024


class Refused(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


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
                count = min(opened.st_size + 1, maximum + 1) if keep else min(1024 * 1024, opened.st_size - observation['readBytes'] + 1)
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


def live_tree_usage(roots, maximum, observation):
    """Sample mutable cache metadata through owned descriptors, without reading payloads.

    Enumeration can lose a name during publication. Such a sample is explicitly
    incomplete; it is never an immutable inventory or proof of a hard disk quota.
    """
    observation.update(scope='LIVE_CACHE_USAGE', atomic=False, complete=False,
                       enumerationComplete=True, entries=[], bytes=0, payloadBytesRead=0)

    def fact_size(fact):
        require(len(json.dumps(fact).encode()) <= CACHE_ENTRY_METADATA_CAP, 'Live cache entry evidence cap exceeded')

    def changed(fact, reason):
        observation['enumerationComplete'] = False
        fact.setdefault('changes', []).append(reason)
        fact_size(fact)

    def account(fact, info):
        size = info.st_size if stat.S_ISREG(info.st_mode) else 0
        previous = fact.get('bytes') or 0
        fact['bytes'] = max(previous, size)
        observation['bytes'] += fact['bytes'] - previous
        require(observation['bytes'] <= maximum, 'Live cache observed usage exceeds controlled cap')
        fact_size(fact)

    def visit(parent, name, path, root=False):
        require(len(observation['entries']) < CACHE_ENTRY_CAP, 'Live cache entry/evidence cap exceeded')
        fact = {'path': str(path), 'bytes': None}
        fact_size(fact)
        observation['entries'].append(fact)
        try:
            before = os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError as error:
            fact['lookupFailure'] = failure(error)
            if root:
                fact['absentAtLookup'] = True
                fact_size(fact)
            else:
                changed(fact, 'enumerated-name-vanished-before-stat')
            return
        is_directory = stat.S_ISDIR(before.st_mode)
        require(is_directory or (not root and stat.S_ISREG(before.st_mode)), 'Unsafe live cache entry: ' + str(path))
        fact.update(dev=before.st_dev, inode=before.st_ino, type='directory' if is_directory else 'file')
        account(fact, before)
        flags = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | (os.O_DIRECTORY if is_directory else 0)
        try:
            fd = os.open(name, flags, dir_fd=parent)
        except FileNotFoundError as error:
            fact['openFailure'] = failure(error)
            changed(fact, 'observed-name-vanished-before-open')
            return
        primary = None
        try:
            opened = os.fstat(fd)
            require(stat.S_ISDIR(opened.st_mode) if is_directory else stat.S_ISREG(opened.st_mode), 'Unsafe opened live cache entry: ' + str(path))
            account(fact, opened)
            # A different safe object is not traversed as though it were the old one.
            if not same_entry(before, opened, directory=True):
                fact['openedReplacement'] = {'dev': opened.st_dev, 'inode': opened.st_ino, 'bytes': opened.st_size}
                changed(fact, 'identity-changed-during-open')
                return
            if is_directory:
                with os.scandir(fd) as entries:
                    for entry in entries:
                        visit(fd, entry.name, path / entry.name)
            after = os.fstat(fd)
            account(fact, after)
            if is_directory and (opened.st_mtime_ns, opened.st_ctime_ns) != (after.st_mtime_ns, after.st_ctime_ns):
                fact['directoryTimes'] = {'before': [opened.st_mtime_ns, opened.st_ctime_ns], 'after': [after.st_mtime_ns, after.st_ctime_ns]}
                changed(fact, 'directory-mutated-during-enumeration')
            try:
                current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError as error:
                fact['afterLookupFailure'] = failure(error)
                changed(fact, 'observed-name-vanished-after-sample')
            else:
                require(stat.S_ISDIR(current.st_mode) if is_directory else stat.S_ISREG(current.st_mode), 'Unsafe live cache replacement: ' + str(path))
                account(fact, current)
                if not same_entry(opened, current, directory=True):
                    fact['pathnameReplacement'] = {'dev': current.st_dev, 'inode': current.st_ino, 'bytes': current.st_size}
                    changed(fact, 'pathname-now-names-another-object')
        except BaseException as error:
            primary = error
            raise
        finally:
            try:
                os.close(fd)
            except BaseException as error:
                pending = primary if primary is not None else error
                pending.metadata_close_failures = getattr(pending, 'metadata_close_failures', []) + [
                    {'operation': 'os.close', 'path': str(path), 'descriptor': fd, **failure(error)}]
                if primary is None:
                    raise

    for root in roots:
        root = Path(root).absolute()
        # Ancestors outside the mutable root retain the strict pathname contract.
        with controlled_path(root.parent, directory=True) as (parent, _, _):
            visit(parent, root.name, root, root=True)
    return observation


def make_directory(path, expected=None, exist_ok=False):
    """Create only relative to an admitted parent descriptor; never follow a replaced ancestor."""
    p = Path(path).absolute()
    attempt = {'path': str(p), 'created': False}
    try:
        with controlled_path(p.parent, expected=expected, directory=True) as (parent, parent_info, pins):
            attempt.update(parentDev=parent_info.st_dev, parentInode=parent_info.st_ino)
            try:
                os.mkdir(p.name, mode=0o700, dir_fd=parent)
                attempt['created'] = True
            except FileExistsError:
                require(exist_ok, 'Controlled destination already exists: ' + str(p))
            observed = os.stat(p.name, dir_fd=parent, follow_symlinks=False)
            attempt.update(dev=observed.st_dev, inode=observed.st_ino, uid=observed.st_uid, mode=observed.st_mode)
            require(stat.S_ISDIR(observed.st_mode), 'Unsafe destination directory: ' + str(p))
            if expected and str(p) in expected:
                require(same_entry(observed, expected[str(p)], True), 'Destination directory changed: ' + str(p))
            pins[str(p)] = observed
            with controlled_path(p, expected=pins, directory=True):
                pass
            return pins
    except BaseException as error:
        error.controlled_directory = attempt
        raise


@contextmanager
def exclusive_writer(path, expected=None, observation=None):
    p = Path(path).absolute()
    fact = observation if observation is not None else {'path': str(p)}
    with controlled_path(p.parent, expected=expected, directory=True) as (parent, _, pins):
        fd = stream = primary = None
        try:
            fd = os.open(p.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NONBLOCK | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            opened = os.fstat(fd)
            fact.update(destinationDev=opened.st_dev, destinationInode=opened.st_ino, writtenBytes=opened.st_size)
            require(stat.S_ISREG(opened.st_mode) and opened.st_size == 0, 'Unsafe opened destination: ' + str(p))
            require(same_entry(opened, os.stat(p.name, dir_fd=parent, follow_symlinks=False)), 'Destination changed during open: ' + str(p))
            # Recheck the original route before any payload write, retaining the original fd.
            with controlled_path(p.parent, expected=pins, directory=True):
                pass
            stream = os.fdopen(fd, 'wb', buffering=0, closefd=False)
            yield stream
            observed = os.fstat(fd)
            fact['writtenBytes'] = observed.st_size
            require(same_entry(observed, os.stat(p.name, dir_fd=parent, follow_symlinks=False)), 'Destination changed during write: ' + str(p))
        except BaseException as error:
            primary = error
            error.controlled_write = fact
            raise
        finally:
            pending = primary
            if fd is not None:
                try:
                    fact['writtenBytes'] = os.fstat(fd).st_size
                except BaseException as error:
                    fact['finalStatFailure'] = failure(error)
                    if pending is None: pending = error
            closes = ([('stream.close', stream.close)] if stream is not None else [])
            if fd is not None: closes.append(('os.close', lambda: os.close(fd)))
            for operation, close in closes:
                try:
                    close()
                except BaseException as error:
                    detail = {'operation': operation, 'path': str(p), 'descriptor': fd, **failure(error)}
                    if pending is None: pending = error
                    pending.cache_copy_close = detail
                    pending.controlled_write_close_failures = getattr(pending, 'controlled_write_close_failures', []) + [detail]
            if pending is not None:
                pending.controlled_write = fact
                if primary is None: raise pending
