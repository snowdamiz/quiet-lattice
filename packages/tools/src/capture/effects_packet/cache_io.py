"""Descriptor-relative cache copy and verification; every ancestor is admitted without following links."""
import contextlib
import hashlib
import os
from pathlib import Path
import stat

from contract import MIB, require
from evidence import failure

ENTRY_CAP = 8192
ROUTE_KEYS = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid')


def stamp(info):
    return {key: getattr(info, key) for key in (*ROUTE_KEYS, 'st_size', 'st_mtime_ns', 'st_ctime_ns')}


def identity(info):
    return {key: getattr(info, key) for key in ROUTE_KEYS}


@contextlib.contextmanager
def acquire(path, record, *, directory=False, create=False, expected=None, ancestors=None, cap=0):
    """Retain all ancestor descriptors and reconcile their links on successful completion.

    No payload is read before regular type, owner, admitted size and identity pass.
    Failed copies stay in place; cleanup here closes only descriptors opened here.
    """
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts and path != Path('/'), 'Cache absolute route required')
    record.update(path=str(path), route=[], complete=False)
    descriptors, primary = [], None
    try:
        parts = path.parts
        for index, part in enumerate(parts):
            last = index == len(parts) - 1
            is_dir = not last or directory
            parent = descriptors[-1] if descriptors else None
            if last and create and directory:
                record['creationAttempted'] = True
                os.mkdir(part, mode=0o700, dir_fd=parent)
            flags = os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if is_dir else 0)
            flags |= os.O_WRONLY | os.O_CREAT | os.O_EXCL if last and create and not directory else os.O_RDONLY
            if last and create:
                record['creationAttempted'] = True
            fd = os.open(part, flags, 0o600, dir_fd=parent)
            descriptors.append(fd)
            info = os.fstat(fd)
            row = {'component': part, **identity(info)}
            record['route'].append(row)
            require(stat.S_ISDIR(info.st_mode) if is_dir else stat.S_ISREG(info.st_mode), 'Cache descriptor type')
            if ancestors is not None and index < len(ancestors):
                require(row == ancestors[index], 'Cache ancestor identity changed')
            if last:
                record.update(before=stamp(info), accessedBeforeNs=info.st_atime_ns)
                require(info.st_uid == os.getuid(), 'Cache descriptor owner')
                if expected is not None:
                    require(stamp(info) == expected, 'Cache opened identity/size changed')
                if not directory:
                    require(0 <= info.st_size <= cap, 'Cache descriptor size cap')
        yield descriptors[-1]
        # Path replacement must not turn a descriptor snapshot into a claim about another route.
        for index, (part, fd) in enumerate(zip(parts, descriptors)):
            linked = os.stat(part, dir_fd=descriptors[index - 1] if index else None, follow_symlinks=False)
            require(identity(linked) == identity(os.fstat(fd)), 'Cache route replaced while open')
    except BaseException as error:
        primary = error
        record['failure'] = failure(error)
        raise
    finally:
        errors = []
        for fd in reversed(descriptors):
            try:
                os.close(fd)
            except BaseException as error:
                errors.append(error)
        if errors:
            record['closeFailures'] = [failure(e) for e in errors]
            if primary is None:
                raise errors[0]
    record['complete'] = True


def inventory(root, cap, record):
    """Admit metadata through safe directory descriptors before any payload/hash read."""
    entries, total = [], 0
    record['directories'] = []
    def visit(path, expected=None, ancestors=None):
        nonlocal total
        observed = {}
        record['directories'].append(observed)
        require(len(record['directories']) + len(entries) <= ENTRY_CAP, 'Cache entry cap')
        with acquire(path, observed, directory=True, expected=expected, ancestors=ancestors) as fd:
            names = []
            with os.scandir(fd) as listing:
                for entry in listing:
                    require(len(names) + len(record['directories']) + len(entries) < ENTRY_CAP, 'Cache entry cap')
                    names.append(entry.name)
            for name in sorted(names):
                require(len(record['directories']) + len(entries) < ENTRY_CAP, 'Cache entry cap')
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                require(info.st_uid == os.getuid(), 'Cache entry owner')
                item = {'path': str(path / name), 'before': stamp(info), 'ancestors': observed['route']}
                if stat.S_ISDIR(info.st_mode):
                    entries.append({**item, 'directory': True})
                    visit(path / name, stamp(info), observed['route'])
                else:
                    require(stat.S_ISREG(info.st_mode), 'Cache inventory special file/link')
                    total += info.st_size
                    require(total <= cap, 'Cache snapshot admission cap')
                    entries.append({**item, 'directory': False})
    try:
        visit(Path(root))
    except FileNotFoundError:
        # Only an absent initial route is empty. Disappearing children are uncertain, not empty.
        if len(record['directories']) != 1 or record['directories'][0].get('before') is not None:
            raise
        record['exists'] = False
        return []
    record['exists'] = True
    record['admittedBytes'] = total
    return entries


def read_cache(path, cap, expected, ancestors, record, write=None):
    """Same admitted descriptor path for copy and both post-copy verification hashes."""
    record['bytesRead'] = 0
    digest = hashlib.sha256()
    with acquire(path, record, expected=expected, ancestors=ancestors, cap=cap) as fd:
        remaining = expected['st_size']
        while remaining:
            block = os.read(fd, min(MIB, remaining))
            record['bytesRead'] += len(block)
            require(block, 'Cache shrank during read')
            remaining -= len(block)
            digest.update(block)
            if write is not None:
                write(block)
        extra = os.read(fd, 1)
        record['bytesRead'] += len(extra)
        require(not extra, 'Cache grew during read')
        after = os.fstat(fd)
        record.update(after=stamp(after), accessedAfterNs=after.st_atime_ns)
        require(record['before'] == record['after'], 'Cache descriptor changed during read')
    record['sha256'] = digest.hexdigest()
    return record['sha256']


def create_directory(path, records):
    record = {}
    records.append(record)
    with acquire(path, record, directory=True, create=True):
        pass


def copy_file(source, destination, admitted, record):
    record.update(copyRead={}, destination={}, sourceVerification={}, copyVerification={}, writtenBytes=0)
    with acquire(destination, record['destination'], create=True) as fd:
        def write(block):
            while block:
                count = os.write(fd, block)
                require(count > 0, 'Cache copy made no progress')
                record['writtenBytes'] += count
                block = block[count:]
        copied = read_cache(source, admitted['before']['st_size'], admitted['before'], admitted['ancestors'], record['copyRead'], write)
        copied_stamp = stamp(os.fstat(fd))
        record['destination']['after'] = copied_stamp
    verified = read_cache(source, admitted['before']['st_size'], admitted['before'], admitted['ancestors'], record['sourceVerification'])
    written = read_cache(destination, admitted['before']['st_size'], copied_stamp, record['destination']['route'][:-1], record['copyVerification'])
    require(copied == verified == written, 'Cache copy hash mismatch')
    record.update(after=record['sourceVerification']['after'], accessedAfterNs=record['sourceVerification']['accessedAfterNs'], sha256=written, complete=True)
