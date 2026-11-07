"""Bounded metadata samples of the cache while its admitted Vite writer is active.

A completed traversal is an estimate, not an atomic snapshot or an OS quota.
Immutable acquisition/copy verification and post-drain checks do not use retries.
"""
import os
from pathlib import Path
import stat
import time

from cache_io import ENTRY_CAP, acquire, identity, stamp
from contract import require
from evidence import failure

ATTEMPTS = 3
SECONDS = 2


class PublicationChanged(Exception):
    pass


def measure(path, cap, record):
    root, until = Path(path), time.monotonic() + SECONDS
    record.update(mode='live-cache-metadata-estimate', atomicSnapshot=False,
                  complete=False, bytes=None, attempts=[])
    def within_time():
        require(time.monotonic() < until, 'Live cache measurement deadline')
    for number in range(ATTEMPTS):
        attempt = {'complete': False, 'bytes': 0, 'entries': [], 'directories': []}
        record['attempts'].append(attempt)
        def visit(path, expected=None, ancestors=None):
            within_time()
            observed = {}
            attempt['directories'].append(observed)
            require(len(attempt['directories']) + len(attempt['entries']) <= ENTRY_CAP, 'Live cache entry cap')
            with acquire(path, observed, directory=True, ancestors=ancestors) as fd:
                if expected is not None:
                    require(identity(os.fstat(fd)) == expected, 'Live cache directory replaced')
                def names(key):
                    values = []
                    observed[key] = values
                    with os.scandir(fd) as listing:
                        for entry in listing:
                            within_time()
                            require(len(values) + len(attempt['entries']) + len(attempt['directories']) < ENTRY_CAP,
                                    'Live cache entry cap')
                            values.append(entry.name)
                    values.sort()
                    return values
                names('namesBefore')
                for name in observed['namesBefore']:
                    within_time()
                    item = {'path': str(path / name), 'before': None}
                    attempt['entries'].append(item)
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    item['before'] = stamp(info)
                    require(info.st_uid == os.getuid(), 'Live cache entry owner')
                    require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), 'Live cache special file/link')
                    if stat.S_ISDIR(info.st_mode):
                        visit(path / name, identity(info), observed['route'])
                    else:
                        attempt['bytes'] += info.st_size
                        require(0 <= attempt['bytes'] <= cap, 'Cache growth/free-space stop threshold')
                names('namesAfter')
                if observed['namesBefore'] != observed['namesAfter']:
                    raise PublicationChanged('Live cache directory names changed: ' + str(path))
        try:
            visit(root)
            within_time()
        except BaseException as error:
            attempt['failure'] = failure(error)
            dirs = attempt['directories']
            # Only the initially absent leaf under admitted ancestors is an empty sample.
            absent = (isinstance(error, FileNotFoundError) and error.errno == 2 and len(dirs) == 1
                      and dirs[0].get('before') is None and error.filename == root.name
                      and len(dirs[0]['route']) == len(root.parts) - 1)
            close_failed = any(d.get('closeFailures') for d in dirs)
            if absent and number == 0 and not close_failed:
                # Reconcile the parent's route while observing absence, not after closing it.
                verification = attempt['absenceVerification'] = {}
                with acquire(root.parent, verification, directory=True, ancestors=dirs[0]['route']) as fd:
                    try:
                        os.stat(root.name, dir_fd=fd, follow_symlinks=False)
                    except FileNotFoundError as missing:
                        if missing.errno != 2:
                            raise
                        verification['absence'] = failure(missing)
                    else:
                        raise PublicationChanged('Live cache root appeared during absence verification')
                within_time()
                attempt.update(complete=True, exists=False)
                record.update(complete=True, bytes=0)
                return 0
            # Unknown errors, close failures, deadlines and replaced roots never become empty.
            transient = ((isinstance(error, FileNotFoundError) and error.errno == 2 and not absent)
                         or isinstance(error, PublicationChanged))
            if not transient or close_failed or number + 1 == ATTEMPTS:
                raise
            within_time()
            continue
        attempt.update(complete=True, exists=True)
        record.update(complete=True, bytes=attempt['bytes'])
        return attempt['bytes']
