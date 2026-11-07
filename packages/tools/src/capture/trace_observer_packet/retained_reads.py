"""Task-local read ports for unchanged StationJob/StageReceipts helper bodies."""
import base64
from contextlib import contextmanager
import io
import os
from pathlib import Path
from metadata import Refused, content_descriptor, digest, encode, failure, read_bytes, file_hash


@contextmanager
def retained_reads(helpers, facts, limits):
    # Module bindings only: no global os/pathlib mutation and no helper source edits.
    boundary, proof, stages = helpers
    original_paths = [(module, module.Path) for module in helpers]
    original_os, original_sha = stages.os, stages.sha
    opened = {}
    charged = 0

    def keep(value):
        nonlocal charged
        size = len(encode(value))
        if len(facts) >= 1200 or charged + size > limits['metadataBytes']:
            raise Refused('Retained read facts ceiling', {'records': len(facts), 'bytes': charged, 'last': value})
        facts.append(value)
        charged += size

    class ReadPath(type(Path())):
        def read_bytes(self):
            return read_bytes(self, limits['metadataBytes'])['raw']
        def read_text(self, encoding=None, errors=None, newline=None):
            cap = limits['logBytes'] if self.name == 'capture_stdout.txt' else limits['metadataBytes']
            raw = read_bytes(self, cap)['raw']
            return io.StringIO(raw.decode(encoding or 'utf-8', errors or 'strict'), newline=newline).read()

    class Stream:
        def __init__(self, path):
            self.path, self.raw, self.closed, self.read_once = str(path), bytearray(), False, False
            self.owner = content_descriptor(path, 65536)
            try:
                self.fd, self.size, self.observed = self.owner.__enter__()
            except BaseException as error:
                keep({'path': self.path, 'failure': failure(error)})
                raise
        def __enter__(self):
            return self
        def fileno(self):
            return self.fd
        def read(self, count):
            if self.read_once or count != 65537:
                raise Refused('Unexpected retained structured-read contract')
            self.read_once = True
            remaining = self.size
            while remaining:
                raw = os.read(self.fd, min(65536, remaining))
                if not raw:
                    raise Refused('Retained structured receipt shortened')
                self.raw.extend(raw)
                self.observed['bytes_read'] += len(raw)
                remaining -= len(raw)
            return bytes(self.raw)
        def __exit__(self, kind, error, trace):
            if self.closed:
                return
            self.closed = True
            opened.pop(self.fd, None)
            record = {'path': self.path, 'raw_base64': base64.b64encode(self.raw).decode(), 'sha256': digest(self.raw)}
            primary = error
            if primary is None and not self.read_once:
                primary = Refused('Retained descriptor abandoned before read')
            try:
                self.owner.__exit__(type(primary) if primary else kind, primary, trace)
            except BaseException as closing:
                record['boundaryFailure'] = failure(closing)
                primary = closing
            record['descriptor'] = self.observed.copy()
            if error is not None:
                record['failure'] = failure(error)
            try:
                keep(record)
            except BaseException as retaining:
                if primary is not None:
                    primary.boundary_secondary = [*getattr(primary, 'boundary_secondary', []), retaining]
                    raise primary from retaining
                raise
            if primary is not None and primary is not error:
                raise primary

    class ReadOS:
        def __getattr__(self, name):
            return getattr(original_os, name)
        def open(self, path, flags):
            if flags != os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK or Path(path).name != 'browser-launch.json':
                raise Refused('Unexpected retained descriptor open')
            stream = Stream(path)
            opened[stream.fd] = stream
            return stream.fd
        def fdopen(self, fd, mode):
            if mode != 'rb' or fd not in opened:
                raise Refused('Unexpected retained descriptor stream')
            return opened[fd]

    def close_pending(primary=None):
        errors = []
        for stream in list(opened.values()):
            try:
                stream.__exit__(type(primary) if primary else None, primary, None)
            except BaseException as closing:
                errors.append(closing)
        if errors:
            if primary is not None:
                primary.boundary_secondary = [*getattr(primary, 'boundary_secondary', []), *errors]
            else:
                raise Refused('Retained descriptor cleanup failed', [failure(error) for error in errors])

    for module, _ in original_paths:
        module.Path = ReadPath
    stages.os = ReadOS()
    stages.sha = lambda path: file_hash(path, 512 * 1024**2, owners=(os.getuid(), 0))
    try:
        yield close_pending
    finally:
        stages.os, stages.sha = original_os, original_sha
        for module, original in original_paths:
            module.Path = original
        close_pending()
