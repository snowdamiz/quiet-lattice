"""Task-local descriptor boundaries for the fixed observer packet; no native launch."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import time
from contextlib import contextmanager

METADATA_CAP = 16 * 1024 * 1024


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def raw_facts(value, cap=METADATA_CAP):
    """Reversible producer facts within the receipt envelope; never invokes unknown repr/getters."""
    remaining, seen, complete = cap, set(), True
    def visit(v, depth=0):
        nonlocal remaining, complete
        if depth > 64:
            complete = False
            return {'omitted': type(v).__name__, 'reason': 'producer fact depth ceiling'}
        if v is None or type(v) in (bool, int, float):
            if type(v) is float and not __import__('math').isfinite(v):
                return {'type': 'nonfinite', 'value': str(v)}
            return v
        if isinstance(v, (str, bytes, bytearray)):
            raw = v.encode('utf8', errors='surrogatepass') if isinstance(v, str) else bytes(v)
            if len(raw) > remaining:
                complete = False
                return {'omitted': type(v).__name__, 'bytes': len(raw), 'reason': 'producer fact byte ceiling'}
            remaining -= len(raw)
            return v if isinstance(v, str) else {'type': 'bytes', 'base64': base64.b64encode(raw).decode(), 'bytes': len(raw)}
        if id(v) in seen:
            return {'reference': 'already observed', 'type': type(v).__name__}
        if len(seen) >= 20000:
            complete = False
            return {'omitted': type(v).__name__, 'reason': 'producer fact entry ceiling'}
        seen.add(id(v))
        if isinstance(v, (dict, list, tuple)) and len(v) > 20000:
            complete = False
            return {'omitted': type(v).__name__, 'entries': len(v), 'reason': 'producer fact entry ceiling'}
        if isinstance(v, dict):
            return {str(k): visit(item, depth + 1) for k, item in v.items()}
        if isinstance(v, (list, tuple)):
            return [visit(item, depth + 1) for item in v]
        if isinstance(v, BaseException):
            attrs = {k: item for k, item in vars(v).items() if k not in ('facts', 'private_tmp_allocation')}
            return {'type': type(v).__name__, 'message': visit(str(v), depth + 1), 'args': visit(v.args, depth + 1),
                    'attributes': visit(attrs, depth + 1), 'facts': visit(getattr(v, 'facts', None), depth + 1),
                    'allocation': visit(getattr(v, 'private_tmp_allocation', None), depth + 1),
                    'cause': visit(v.__cause__, depth + 1), 'context': visit(v.__context__, depth + 1)}
        if hasattr(v, '__dict__'):
            return {'type': type(v).__name__, 'attributes': visit(vars(v), depth + 1)}
        complete = False
        return {'unknownType': type(v).__name__}
    result = visit(value)
    return {'complete': complete, 'bytesCharged': cap - remaining, 'value': result}


def failure(error):
    receipt = raw_facts(error)
    result = receipt['value']
    return {**result, 'rawComplete': receipt['complete']} if isinstance(result, dict) else {'type': type(error).__name__, 'raw': receipt}


class Refused(RuntimeError):
    def __init__(self, message, facts=None):
        super().__init__(message)
        self.facts = facts


class IODeadline(BaseException):
    pass


@contextmanager
def io_deadline(seconds=120):
    """An actual phase timer, including descriptor acquisition and copy syscalls."""
    started = time.monotonic()
    handler = signal.getsignal(signal.SIGALRM)
    previous = signal.getitimer(signal.ITIMER_REAL)
    def expire(_signum, _frame):
        raise IODeadline('Bounded observer I/O deadline expired')
    signal.signal(signal.SIGALRM, expire)
    signal.setitimer(signal.ITIMER_REAL, min(seconds, previous[0]) if previous[0] else seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, handler)
        if previous[0]:
            signal.setitimer(signal.ITIMER_REAL, max(.000001, previous[0] - (time.monotonic() - started)), previous[1])


def stamp(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def directory_identity(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_uid]


def close_owned(fd, primary=None):
    try:
        os.close(fd)
    except BaseException as closing:
        if primary is None:
            raise
        primary.boundary_secondary = [*getattr(primary, 'boundary_secondary', []), closing]
        if isinstance(getattr(primary, 'facts', None), dict):
            primary.facts['closeFailure'] = failure(closing)


class Directory:
    """Every path component is acquired from a held, no-follow parent descriptor."""
    def __init__(self, path, *, create=False):
        self.path = Path(path)
        self.chain = []
        if not self.path.is_absolute() or '..' in self.path.parts or len(self.path.parts) > 128:
            raise Refused('Absolute bounded ancestor path required')
        try:
            fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK)
            self.chain.append((fd, None, directory_identity(os.fstat(fd))))
            for component in self.path.parts[1:]:
                parent = self.chain[-1][0]
                if create:
                    try:
                        os.mkdir(component, mode=0o700, dir_fd=parent)
                    except FileExistsError:
                        pass
                fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                self.chain.append((fd, component, directory_identity(os.fstat(fd))))
            self.verify()
        except BaseException as error:
            self.close(error)
            raise
    @property
    def fd(self):
        return self.chain[-1][0]
    def verify(self):
        for index, (fd, name, admitted) in enumerate(self.chain):
            current = os.fstat(fd)
            if not stat.S_ISDIR(current.st_mode) or directory_identity(current) != admitted:
                raise Refused('Held ancestor identity changed')
            if index and directory_identity(os.stat(name, dir_fd=self.chain[index-1][0], follow_symlinks=False)) != admitted:
                raise Refused('Ancestor path replaced or symbolic')
    def close(self, primary=None):
        error = primary
        while self.chain:
            fd = self.chain.pop()[0]
            try:
                close_owned(fd, error)
            except BaseException as closing:
                error = closing
        if primary is None and error is not None:
            raise error
    def __enter__(self):
        return self
    def __exit__(self, _type, error, _trace):
        self.close(error)


def mkdir(path, *, parents=False):
    path = Path(path)
    with Directory(path.parent, create=parents) as parent:
        parent.verify()
        os.mkdir(path.name, mode=0o700, dir_fd=parent.fd)
        parent.verify()


def admit(path, cap=METADATA_CAP, *, owners=None):
    path = Path(path)
    with Directory(path.parent) as parent:
        info = os.stat(path.name, dir_fd=parent.fd, follow_symlinks=False)
        if not stat.S_ISREG(info.st_mode) or info.st_uid not in (owners or (os.getuid(),)) or not 0 <= info.st_size <= cap:
            raise Refused('Metadata type/owner/size refused', {'path': str(path), 'stamp': stamp(info)})
        parent.verify()
        return {'stamp': stamp(info)}


class ReadBudget:
    def __init__(self, cap):
        self.remaining = cap
        self.read = 0
    def preflight(self, size):
        if size < 0 or size > self.remaining:
            raise Refused('Aggregate content read ceiling', {'remaining': self.remaining, 'bytes': size})
    def charge(self, size):
        self.preflight(size)
        self.remaining -= size
        self.read += size


@contextmanager
def content_descriptor(path, cap, *, expected_stamp=None, budget=None, before_open=lambda: None, owners=None):
    path = Path(path)
    budget = budget or ReadBudget(cap)
    facts = {'path': str(path), 'bytes_read': 0, 'complete': False}
    fd, primary = None, None
    try:
        with Directory(path.parent) as parent:
            before = os.stat(path.name, dir_fd=parent.fd, follow_symlinks=False)
            facts['before'] = stamp(before)
            admitted = expected_stamp if expected_stamp is not None else stamp(before)
            if not stat.S_ISREG(before.st_mode) or before.st_uid not in (owners or (os.getuid(),)) or stamp(before) != admitted or not 0 <= before.st_size <= cap:
                raise Refused('Bound file type/owner/size/admitted stamp differs')
            budget.preflight(before.st_size)
            before_open()
            fd = os.open(path.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=parent.fd)
            opened = os.fstat(fd)
            facts['opened'] = stamp(opened)
            if not stat.S_ISREG(opened.st_mode) or stamp(opened) != admitted:
                raise Refused('Metadata descriptor differs')
            parent.verify()
            yield fd, before.st_size, facts
            parent.verify()
            if stamp(os.fstat(fd)) != admitted or stamp(os.stat(path.name, dir_fd=parent.fd, follow_symlinks=False)) != admitted:
                raise Refused('Bound file changed after admitted read')
            facts['complete'] = True
    except BaseException as error:
        primary = error
        prior = getattr(error, 'facts', None)
        error.facts = {**facts, 'prior': prior}
        if isinstance(error, OSError):
            primary = Refused(str(error), error.facts)
            raise primary from error
        raise
    finally:
        if fd is not None:
            close_owned(fd, primary)



def read_content(path, cap, *, expected_stamp=None, budget=None, consume=lambda _chunk: None, before_open=lambda: None, owners=None):
    budget = budget or ReadBudget(cap)
    with content_descriptor(path, cap, expected_stamp=expected_stamp, budget=budget, before_open=before_open, owners=owners) as (fd, remaining, facts):
        h = hashlib.sha256()
        while remaining:
            chunk = os.read(fd, min(65536, remaining, budget.remaining))
            if not chunk:
                raise Refused('Bound file ended before admitted length')
            budget.charge(len(chunk))
            remaining -= len(chunk)
            facts['bytes_read'] += len(chunk)
            h.update(chunk)
            consume(chunk)
        facts['sha256'] = h.hexdigest()
    return facts


def read_bytes(path, cap=METADATA_CAP, expected_stamp=None, *, before_open=lambda: None):
    raw = bytearray()
    try:
        facts = read_content(path, cap, expected_stamp=expected_stamp, consume=raw.extend, before_open=before_open)
    except BaseException as error:
        error.facts = {**(getattr(error, 'facts', None) or {}), 'raw_base64': base64.b64encode(raw).decode()}
        raise
    return {'raw': bytes(raw), 'sha256': digest(raw), 'facts': {**facts, 'raw_base64': base64.b64encode(raw).decode()}}


def snapshot(path, expected=None, cap=METADATA_CAP, *, before_open=lambda: None, expected_stamp=None):
    observed = read_bytes(path, cap, expected_stamp, before_open=before_open)
    raw, facts = observed['raw'], observed['facts']
    try:
        if expected is not None and observed['sha256'] != expected:
            raise Refused('Metadata digest differs')
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise Refused('Duplicate metadata key')
                result[key] = value
            return result
        value = json.loads(raw.decode('utf8'), object_pairs_hook=unique,
                           parse_constant=lambda value: (_ for _ in ()).throw(Refused('Nonfinite JSON: ' + value)))
        return {**observed, 'value': value}
    except BaseException as error:
        error.facts = facts
        raise


def atomic(path, raw):
    path = Path(path)
    temporary = path.name + '.writing'
    with Directory(path.parent) as parent:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent.fd)
        primary = None
        try:
            try:
                with os.fdopen(fd, 'wb', closefd=False) as stream:
                    try:
                        stream.write(raw)
                        stream.flush()
                        os.fsync(stream.fileno())
                    except BaseException as error:
                        primary = error
                        raise
            except BaseException as closing:
                if primary is not None and closing is not primary:
                    primary.boundary_secondary = [*getattr(primary, 'boundary_secondary', []), closing]
                    raise primary from closing
                raise
            parent.verify()
            written = stamp(os.fstat(fd))
            if stamp(os.stat(temporary, dir_fd=parent.fd, follow_symlinks=False)) != written:
                raise Refused('Publication temporary changed')
            os.link(temporary, path.name, src_dir_fd=parent.fd, dst_dir_fd=parent.fd, follow_symlinks=False)
            os.unlink(temporary, dir_fd=parent.fd)
            parent.verify()
            if stamp(os.stat(path.name, dir_fd=parent.fd, follow_symlinks=False)) != stamp(os.fstat(fd)):
                raise Refused('Publication identity differs')
        except BaseException as error:
            primary = error
            raise
        finally:
            close_owned(fd, primary)


def encode(value):
    return (json.dumps(value, allow_nan=False, sort_keys=True, indent=2) + '\n').encode()


class Evidence:
    def __init__(self, roots, *, writer=atomic, cap=128 * 1024 * 1024, count=1200):
        self.roots, self.writer, self.cap, self.count = list(map(Path, roots)), writer, cap, count
        self.raw, self.errors, self.durable = {}, [], {}
        self.bytes = 0
    def put(self, name, value):
        raw = value if isinstance(value, bytes) else encode(value)
        if '/' in name or name in self.raw or len(self.raw) >= self.count or self.bytes + len(raw) > self.cap:
            raise Refused('Evidence ledger cap/name/reuse refused', {'name': name, 'bytes': len(raw)})
        self.raw[name] = raw
        self.bytes += len(raw)
        for root in self.roots:
            try:
                self.writer(root / name, raw)
                self.durable[name] = {'path': str(root / name), 'sha256': digest(raw), 'bytes': len(raw)}
                return self.durable[name]
            except BaseException as error:
                self.errors.append({'name': name, 'root': str(root), **failure(error)})
                if not isinstance(error, Exception):
                    error.facts = self.receipt()
                    raise
        raise Refused('All evidence sinks failed; retained in memory only', self.receipt())
    def receipt(self):
        return {'bytes': self.bytes, 'count': len(self.raw), 'durable': copy.deepcopy(self.durable),
                'errors': copy.deepcopy(self.errors), 'undurable': {k: base64.b64encode(v).decode() for k, v in self.raw.items() if k not in self.durable}}


def inventory(root, *, count=20000, cap=512 * 1024 * 1024, live=False):
    """Pre-admit the entire inventory without content reads. Any enumeration error is fatal."""
    root = Path(root)
    rows, total = [], 0
    directories = []
    def names_for(fd, remaining):
        names = []
        with os.scandir(fd) as entries:
            for entry in entries:
                if len(names) >= remaining:
                    raise Refused('Ledger count ceiling during enumeration')
                names.append(entry.name)
        return sorted(names)
    def visit(fd, relative):
        nonlocal total
        before = stamp(os.fstat(fd))
        names = names_for(fd, count - len(rows))
        for name in names:
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            rel = str(Path(relative) / name)
            kind = ('file' if stat.S_ISREG(info.st_mode) else 'directory' if stat.S_ISDIR(info.st_mode) else
                    'symlink-not-followed' if stat.S_ISLNK(info.st_mode) else 'socket' if stat.S_ISSOCK(info.st_mode) else
                    'fifo' if stat.S_ISFIFO(info.st_mode) else 'unknown-type')
            if info.st_uid != os.getuid() or (not live and kind not in ('file', 'directory')):
                raise Refused('Ledger entry type/owner refused', {'path': str(root / rel)})
            size = info.st_size if kind != 'directory' else 0
            total += size
            if len(rows) >= count or total > cap:
                raise Refused('Ledger count/byte ceiling')
            row = {'path': rel, 'stamp': stamp(info), 'kind': kind, 'bytes': size}
            if kind == 'symlink-not-followed':
                row['link'] = os.readlink(name, dir_fd=fd)
            rows.append(row)
            if kind == 'directory':
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                error = None
                try:
                    if stamp(os.fstat(child)) != row['stamp']:
                        raise Refused('Enumerated directory replaced')
                    visit(child, rel)
                except BaseException as caught:
                    error = caught
                    raise
                finally:
                    close_owned(child, error)
            if stamp(os.stat(name, dir_fd=fd, follow_symlinks=False)) != row['stamp']:
                raise Refused('Enumerated entry changed')
        if not live and (stamp(os.fstat(fd)) != before or names_for(fd, count) != names):
            raise Refused('Directory changed during inventory')
        directories.append({'path': relative, 'stamp': before, 'names': names})
    try:
        with Directory(root) as directory:
            visit(directory.fd, '')
            directory.verify()
        return {'files': sorted(rows, key=lambda r: r['path']), 'count': len(rows), 'bytes': total,
                'directories': directories, 'complete': True, 'liveObservationOnly': live, 'quotaGuaranteed': False}
    except BaseException as error:
        prior = failure(error)
        facts = {'root': str(root), 'files': rows, 'count': len(rows), 'bytes': total, 'complete': False, 'original': prior}
        if not isinstance(error, Exception):
            error.facts = facts
            raise
        raise Refused('Incomplete ledger: ' + str(error), facts) from error


def file_hash(path, cap, *, expected_stamp=None, budget=None, owners=None):
    return read_content(path, cap, expected_stamp=expected_stamp, budget=budget, owners=owners)['sha256']


def ledger(root, *, count=20000, cap=512 * 1024 * 1024, hash_files=True, live=False):
    admitted = inventory(root, count=count, cap=cap, live=live)
    budget = ReadBudget(cap)
    try:
        for row in admitted['files']:
            if row['kind'] == 'file' and hash_files:
                row['sha256'] = file_hash(Path(root) / row['path'], cap, expected_stamp=row['stamp'], budget=budget)
        if hash_files:
            after = inventory(root, count=count, cap=cap, live=live)
            before_rows = [{k: v for k, v in r.items() if k != 'sha256'} for r in admitted['files']]
            if before_rows != after['files'] or admitted['directories'] != after['directories']:
                raise Refused('Ledger changed after content reads')
        return {**admitted, 'contentBytesRead': budget.read}
    except BaseException as error:
        error.facts = {'partialLedger': {**admitted, 'complete': False}, 'contentBytesRead': budget.read, 'original': failure(error)}
        raise


def copy_file(source, destination, row, budget):
    """One admitted source descriptor; exclusive anchored destination, bounded read/write count."""
    destination = Path(destination)
    with Directory(destination.parent, create=True) as parent:
        fd = None
        primary = None
        def write(chunk):
            nonlocal fd
            if fd is None:
                fd = os.open(destination.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent.fd)
            view = memoryview(chunk)
            while view:
                n = os.write(fd, view)
                if not n:
                    raise Refused('Copy made no write progress')
                view = view[n:]
        try:
            copied = read_content(source, row['bytes'], expected_stamp=row['stamp'], budget=budget, consume=write)
            if fd is None:
                write(b'')
            os.fchmod(fd, stat.S_IMODE(row['stamp'][2]))
            os.fsync(fd)
            parent.verify()
            target_stamp = stamp(os.fstat(fd))
        except BaseException as error:
            primary = error
            raise
        finally:
            if fd is not None:
                close_owned(fd, primary)
        if file_hash(destination, row['bytes'], expected_stamp=target_stamp) != copied['sha256']:
            raise Refused('Copy destination hash differs')
        return copied['sha256']


def copy_tree(source, destination, *, count=20000, cap=512 * 1024 * 1024):
    """The accepted helpers call this task-owned copy port before deleting originals."""
    with io_deadline(120):
        admitted = inventory(source, count=count, cap=cap)
        destination = Path(destination)
        mkdir(destination)
        budget = ReadBudget(cap)
        expected = []
        for row in admitted['files']:
            target = destination / row['path']
            sha = None
            if row['kind'] == 'directory':
                with Directory(target, create=True):
                    pass
            else:
                sha = copy_file(Path(source) / row['path'], target, row, budget)
            expected.append({'path': row['path'], 'kind': row['kind'], 'bytes': row['bytes'], 'sha256': sha,
                             'mode': stat.S_IMODE(row['stamp'][2])})
        # Populate under private writable modes, then restore directories deepest first.
        # The retained namespace verifier compares empty directories and modes as well as bytes.
        for row in sorted(admitted['directories'], key=lambda r: len(Path(r['path']).parts), reverse=True):
            target = destination / row['path']
            with Directory(target) as directory:
                original = directory_identity(os.fstat(directory.fd))
                mode = stat.S_IMODE(row['stamp'][2])
                os.fchmod(directory.fd, mode)
                expected_identity = [original[0], original[1], stat.S_IFDIR | mode, original[3]]
                with Directory(target) as verified:
                    if directory_identity(os.fstat(directory.fd)) != expected_identity or directory_identity(os.fstat(verified.fd)) != expected_identity:
                        raise Refused('Archive directory identity or mode changed; originals retained')
        after = inventory(source, count=count, cap=cap)
        if admitted != after:
            raise Refused('Archive source changed; originals retained')
        copied = ledger(destination, count=count, cap=cap)
        actual = [{'path': row['path'], 'kind': row['kind'], 'bytes': row['bytes'], 'sha256': row.get('sha256'), 'mode': stat.S_IMODE(row['stamp'][2])}
                  for row in copied['files']]
        source_root = next(row for row in admitted['directories'] if row['path'] == '')
        copied_root = next(row for row in copied['directories'] if row['path'] == '')
        if actual != expected or stat.S_IMODE(source_root['stamp'][2]) != stat.S_IMODE(copied_root['stamp'][2]):
            raise Refused('Archive copy differs; originals retained')
        return str(destination)
