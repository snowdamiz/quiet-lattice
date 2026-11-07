"""Task-local bounded metadata and evidence; never authenticates a second read."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import stat

METADATA_CAP = 16 * 1024 * 1024


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def failure(error):
    return {'type': type(error).__name__, 'message': str(error),
            'facts': getattr(error, 'facts', None),
            'allocation': getattr(error, 'private_tmp_allocation', None),
            'priorException': ({'type': type(error.__context__).__name__, 'message': str(error.__context__)} if error.__context__ is not None else None)}


class Refused(RuntimeError):
    def __init__(self, message, facts=None):
        super().__init__(message)
        self.facts = facts


def stamp(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def snapshot(path, expected=None, cap=METADATA_CAP, *, before_open=lambda: None):
    """Open is nonblocking even if a checked regular pathname is replaced by a FIFO."""
    path = Path(path)
    facts = {'path': str(path), 'raw_base64': None, 'complete': False}
    fd = None
    caught = None
    try:
        before = path.lstat()
        facts['before'] = stamp(before)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_size > cap:
            raise Refused('Metadata type/owner/size refused')
        before_open()
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        opened = os.fstat(fd)
        facts['opened'] = stamp(opened)
        if not stat.S_ISREG(opened.st_mode) or stamp(opened) != stamp(before):
            raise Refused('Metadata descriptor differs')
        raw = bytearray()
        while len(raw) <= cap:
            chunk = os.read(fd, min(65536, cap + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
            facts.update(raw_base64=base64.b64encode(raw).decode(), bytes_read=len(raw))
        raw = bytes(raw)
        facts.update(raw_base64=base64.b64encode(raw).decode(), bytes_read=len(raw), sha256=digest(raw))
        after = os.fstat(fd)
        if len(raw) > cap or stamp(after) != stamp(opened) or stamp(path.lstat()) != stamp(opened) or len(raw) != opened.st_size:
            raise Refused('Metadata changed or exceeded cap')
        facts['complete'] = True
        if expected is not None and digest(raw) != expected:
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
        return {'value': value, 'raw': raw, 'sha256': digest(raw), 'facts': facts}
    except BaseException as error:
        if not isinstance(error, Exception):
            caught = error
            error.facts = facts
            raise
        caught = Refused(str(error), facts)
        raise caught from error
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except BaseException as closing:
                facts['closeFailure'] = failure(closing)
                if caught is None:
                    raise Refused('Metadata descriptor close failed', facts) from closing


def atomic(path, raw):
    path = Path(path)
    temporary = path.with_name(path.name + '.writing')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)  # Exclusive publication, never replaces older evidence.
        temporary.unlink()
    except BaseException:
        # A partial or fully written temporary is evidence, not garbage to delete.
        raise


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
        self.raw[name] = raw  # Retain before any disk operation, including open/close/publication.
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


def ledger(root, *, count=20000, cap=512 * 1024 * 1024, hash_files=True, live=False):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise Refused('Ledger root refused')
    rows, total = [], 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            info = path.lstat()
            if info.st_uid != os.getuid() or (not live and (stat.S_ISLNK(info.st_mode) or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)))):
                raise Refused('Ledger entry type/owner refused', {'path': str(path)})
            total += info.st_size if not stat.S_ISDIR(info.st_mode) else 0
            if len(rows) >= count or total > cap:
                raise Refused('Ledger count/byte ceiling', {'count': len(rows), 'bytes': total})
            kind = ('file' if stat.S_ISREG(info.st_mode) else 'directory' if stat.S_ISDIR(info.st_mode) else
                    'symlink-not-followed' if stat.S_ISLNK(info.st_mode) else 'socket' if stat.S_ISSOCK(info.st_mode) else
                    'fifo' if stat.S_ISFIFO(info.st_mode) else 'unknown-type')
            row = {'path': str(path.relative_to(root)), 'stamp': stamp(info), 'kind': kind, 'bytes': info.st_size if not stat.S_ISDIR(info.st_mode) else 0}
            if stat.S_ISREG(info.st_mode) and hash_files:
                row['sha256'] = file_hash(path, cap)
            rows.append(row)
    return {'files': rows, 'count': len(rows), 'bytes': total, 'liveObservationOnly': live, 'quotaGuaranteed': False}


def file_hash(path, cap):
    path = Path(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > cap:
        raise Refused('Bound file type/size refused: ' + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        if stamp(opened) != stamp(before):
            raise Refused('Bound file replaced')
        h, size = hashlib.sha256(), 0
        while size <= cap:
            part = os.read(fd, min(1024 * 1024, cap + 1 - size))
            if not part:
                break
            size += len(part)
            h.update(part)
        if size != opened.st_size or stamp(os.fstat(fd)) != stamp(opened) or stamp(path.lstat()) != stamp(opened):
            raise Refused('Bound file changed')
        return h.hexdigest()
    finally:
        os.close(fd)
