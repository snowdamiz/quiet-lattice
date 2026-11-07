"""Bounded metadata samples of admitted writers, including normal shutdown deletion.

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

ATTEMPTS = 16
SECONDS = 2
RETRY_SECONDS = .01


class PublicationChanged(Exception):
    pass


def measure(path, cap, record, *, allow_special=False, allow_absent=True, classify=None, until=None, settled=False):
    root = Path(path)
    until = min(until, time.monotonic() + SECONDS) if until is not None else time.monotonic() + SECONDS
    limits = cap if isinstance(cap, dict) else {'bytes': cap}
    attempts = 1 if settled else ATTEMPTS
    record.update(mode='settled-writer-metadata' if settled else 'live-writer-metadata-estimate', atomicSnapshot=False,
                  complete=False, bytes=None, attempts=[], metadataEvents=0)
    def charge():
        record['metadataEvents'] += 1
        require(record['metadataEvents'] <= ENTRY_CAP, 'Writer metadata observation cap')
    def within_time():
        require(time.monotonic() < until, 'Live cache measurement deadline')
    for number in range(attempts):
        attempt = {'complete': False, 'bytes': 0, 'totals': {key: 0 for key in limits}, 'entries': [], 'directories': []}
        record['attempts'].append(attempt)
        def visit(path, expected=None, ancestors=None):
            within_time()
            charge()
            observed = {}
            attempt['directories'].append(observed)
            with acquire(path, observed, directory=True, ancestors=ancestors) as fd:
                if expected is not None:
                    require(identity(os.fstat(fd)) == expected, 'Live cache directory replaced')
                def names(key):
                    values = []
                    observed[key] = values
                    with os.scandir(fd) as listing:
                        for entry in listing:
                            within_time()
                            charge()
                            values.append(entry.name)
                    values.sort()
                    return values
                names('namesBefore')
                for name in observed['namesBefore']:
                    within_time()
                    charge()
                    item = {'path': str(path / name), 'before': None}
                    attempt['entries'].append(item)
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    item['before'] = stamp(info)
                    require(info.st_uid == os.getuid(), 'Live cache entry owner')
                    special = allow_special and any(kind(info.st_mode) for kind in (stat.S_ISLNK, stat.S_ISSOCK, stat.S_ISFIFO))
                    require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode) or special, 'Live writer special file/link')
                    if stat.S_ISDIR(info.st_mode):
                        visit(path / name, identity(info), observed['route'])
                    else:
                        # Existing Chromium singleton links/sockets/FIFOs are metadata, never followed/opened.
                        size = info.st_size if stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) else 0
                        key = classify((path / name).relative_to(root).parts[0]) if classify else 'bytes'
                        attempt['bytes'] += size
                        attempt['totals'][key] += size
                        require(0 <= attempt['totals'][key] <= limits[key], 'Native writer observed stop threshold')
                    if settled:
                        item['after'] = stamp(os.stat(name, dir_fd=fd, follow_symlinks=False))
                        require(item['after'] == item['before'], 'Settled writer entry changed')
                names('namesAfter')
                if observed['namesBefore'] != observed['namesAfter']:
                    raise PublicationChanged('Live cache directory names changed: ' + str(path))
                if settled:
                    observed['after'] = stamp(os.fstat(fd))
                    require(observed['after'] == observed['before'], 'Settled writer directory changed')
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
            if absent and allow_absent and number == 0 and not close_failed:
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
                record.update(complete=True, bytes=0, totals=attempt['totals'])
                return 0
            # Unknown errors, close failures, deadlines and replaced roots never become empty.
            transient = ((isinstance(error, FileNotFoundError) and error.errno == 2 and not absent)
                         or isinstance(error, PublicationChanged))
            if not transient or close_failed or number + 1 == attempts:
                raise
            within_time()
            attempt['retryDelaySeconds'] = min(RETRY_SECONDS, max(0, until - time.monotonic()))
            time.sleep(attempt['retryDelaySeconds'])
            within_time()
            continue
        attempt.update(complete=True, exists=True)
        record.update(complete=True, bytes=attempt['bytes'], totals=attempt['totals'])
        return attempt['bytes']
