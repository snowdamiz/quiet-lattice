"""Adapter to the four recovered helpers. Imported only after grant consumption."""
from contextlib import contextmanager
import copy
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

from boundary import MIB, deadline, encoded, raw, require, retain
from bindings import HELPERS


def size(path, *, skip_profiles=False):
    path = Path(path)
    if not path.exists():
        return 0
    total = 0
    for base, dirs, files in os.walk(path, followlinks=False):
        if skip_profiles:
            dirs[:] = [n for n in dirs if not n.startswith('playwright_chromiumdev_profile-')]
        for name in dirs + files:
            p = Path(base) / name
            require(not p.is_symlink(), f'Unexpected owned symlink: {p}')
        total += sum((Path(base) / n).stat().st_size for n in files)
    return total


LIVE_CAPS = {'helperScratch': 64 * MIB, 'job': 16 * MIB,
             'privateNonprofile': 512 * MIB, 'profiles': 1024 * MIB}
LIVE_ENTRIES = 100000
LIVE_LOSSES = 32
LIVE_PARTIALS = 128
LIVE_UNKNOWN_SECONDS = 2
LIVE_FACT_BYTES = 256 * 1024


def live_roots(job, private, admission):
    """Pin the three task-owned directory identities before starting the job."""
    roots = []
    for label, path in (('helperScratch', job.scratch), ('job', job.out), ('privateNonprofile', private)):
        info = os.stat(path, follow_symlinks=False)
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid(), 'Live root owner/type')
        stamp = [info.st_dev, info.st_ino]
        if label == 'privateNonprofile':
            require(stamp == admission['stamp'], 'Live private root differs from admission')
        roots.append({'label': label, 'path': str(path), 'stamp': stamp})
    return roots


def sample_usage(roots, evidence):
    """Non-atomic metadata samples, never immutable inventories or release proof."""
    state = evidence.setdefault('usageSampling', {'samples': 0, 'incomplete': [], 'partialBytes': 0,
                                                 'unknownSince': None, 'roots': roots})
    sample = {'observedBytes': dict.fromkeys(LIVE_CAPS, 0), 'entries': 0, 'losses': [],
              'specialEntries': {'socket': 0, 'fifo': 0}, 'coverage': 'interrupted',
              'atomic': False, 'settled': False, 'started': time.monotonic()}
    state['samples'] += 1
    state['last'] = sample  # Partial facts survive every exception/deadline.
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK
    def loss(path, operation, error):
        # Only ENOENT from a descendant race is tolerable. Root loss, access
        # failures, wrong types/owners, symlinks and unknown IO failures refuse.
        if not isinstance(error, FileNotFoundError):
            raise error
        sample['losses'].append({'path': str(path), 'operation': operation, 'error': error,
                                 'errno': error.errno, 'filename': error.filename, 'filename2': error.filename2})
        require(len(sample['losses']) <= LIVE_LOSSES, 'Live sampling loss ceiling')
    def walk(fd, path, label, depth=0):
        require(depth <= 64, 'Live sampling depth ceiling')
        with os.scandir(fd) as entries:
            for entry in entries:
                sample['entries'] += 1
                require(sample['entries'] <= LIVE_ENTRIES, 'Live sampling entry ceiling')
                child = path / entry.name
                try:
                    info = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                except FileNotFoundError as error:
                    loss(child, 'stat', error); continue
                require(not stat.S_ISLNK(info.st_mode), f'Unexpected owned symlink: {child}')
                require(info.st_uid == os.getuid(), f'Live entry owner differs: {child}')
                selected = 'profiles' if label == 'privateNonprofile' and depth == 0 and stat.S_ISDIR(info.st_mode) and entry.name.startswith('playwright_chromiumdev_profile-') else label
                if stat.S_ISDIR(info.st_mode):
                    try:
                        nested = os.open(entry.name, flags, dir_fd=fd)
                    except FileNotFoundError as error:
                        loss(child, 'open-directory', error); continue
                    try:
                        opened = os.fstat(nested)
                        require(stat.S_ISDIR(opened.st_mode) and opened.st_uid == os.getuid(), 'Live opened directory owner/type')
                        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                            sample['losses'].append({'path': str(child), 'operation': 'directory-replaced',
                                'enumerated': [info.st_dev, info.st_ino], 'opened': [opened.st_dev, opened.st_ino]})
                            require(len(sample['losses']) <= LIVE_LOSSES, 'Live sampling loss ceiling')
                        try:
                            walk(nested, child, selected, depth + 1)
                        except FileNotFoundError as error:
                            loss(child, 'enumerate-directory', error)
                        try:
                            current = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                        except FileNotFoundError as error:
                            loss(child, 'recheck-directory', error)
                        else:
                            require(not stat.S_ISLNK(current.st_mode), f'Unexpected owned symlink: {child}')
                            require(stat.S_ISDIR(current.st_mode) and current.st_uid == os.getuid(), 'Live directory route owner/type changed')
                            if (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
                                sample['losses'].append({'path': str(child), 'operation': 'directory-route-changed',
                                    'opened': [opened.st_dev, opened.st_ino], 'current': [current.st_dev, current.st_ino]})
                                require(len(sample['losses']) <= LIVE_LOSSES, 'Live sampling loss ceiling')
                    finally:
                        os.close(nested)
                else:
                    kind = 'socket' if stat.S_ISSOCK(info.st_mode) else 'fifo' if stat.S_ISFIFO(info.st_mode) else None
                    require(stat.S_ISREG(info.st_mode) or kind is not None, f'Unsupported live entry type: {child}')
                    if kind: sample['specialEntries'][kind] += 1
                    sample['observedBytes'][selected] += info.st_size
                    require(sample['observedBytes'][selected] <= LIVE_CAPS[selected], f'Live {selected} working ceiling')
    try:
        with deadline(2):
            for root in roots:
                path = Path(root['path'])
                fd = os.open(path, flags)
                try:
                    info = os.fstat(fd)
                    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and [info.st_dev, info.st_ino] == root['stamp'], 'Live root identity changed')
                    walk(fd, path, root['label'])
                    current = os.stat(path, follow_symlinks=False)
                    require(stat.S_ISDIR(current.st_mode) and current.st_uid == os.getuid() and [current.st_dev, current.st_ino] == root['stamp'], 'Live root changed during sample')
                finally:
                    os.close(fd)
        sample['finished'] = time.monotonic()
        if sample['losses']:
            sample['coverage'] = 'partial'
            state['incomplete'].append(sample)
            state['partialBytes'] += len(encoded(sample))
            if state['unknownSince'] is None: state['unknownSince'] = sample['started']
            require(len(state['incomplete']) <= LIVE_PARTIALS and state['partialBytes'] <= LIVE_FACT_BYTES, 'Live partial evidence ceiling')
            require(sample['finished'] - state['unknownSince'] <= LIVE_UNKNOWN_SECONDS, 'Live sampling instability deadline')
        else:
            sample['coverage'] = 'enumerated'
            state['unknownSince'] = None
        return sample['observedBytes']
    except BaseException as error:
        sample['failure'] = error
        raise


@contextmanager
def observed_helpers(modules, evidence, *, journal=None):
    """Retain return values before helper assertions, including unknown fields/bytes."""
    restored = []
    metadata_bytes = 0
    metadata_storage = {}
    evidence['helperMetadataStorage'] = metadata_storage
    observation_bytes = 0
    call_sequence = 0
    def wrap(owner, name, *, receipt=False):
        original = getattr(owner, name)
        def call(*args, **kwargs):
            nonlocal metadata_bytes, observation_bytes, call_sequence
            event = {'operation': name, 'callSequence': call_sequence}
            call_sequence += 1
            if journal is None: evidence['helperCalls'].append(event)
            observed = retain(evidence, event, 'args', args, encoder=raw)
            observed &= retain(evidence, event, 'kwargs', kwargs, encoder=raw)
            if evidence.get('phase') != 'cleanup' and not observed:
                failure = evidence['unencodedFacts'][-1]['encodingError']
                evidence.setdefault('collectionFailure', failure)
                raise failure
            try:
                if receipt:
                    try:
                        data = (json.dumps(args[1], indent=2) + '\n').encode()
                        event['writerBytesKnown'] = True
                    except Exception as error:
                        # The unchanged writer owns serialization failure. Keep
                        # injected/unknown non-JSON facts and let it report it.
                        event['writerEncodingUnavailable'] = raw(error)
                        data = encoded(args[1])
                        event['writerBytesKnown'] = False
                    metadata_bytes += len(data)  # All traffic, including failures/overwrites.
                    event['attemptedBytes'] = len(data)
                    key = str(args[0])
                    metadata_storage[key] = max(metadata_storage.get(key, 0), len(data))
                    # Every logical destination reserves its largest target AND
                    # its .writing temporary, including failed partial writes.
                    reserved = 2 * sum(metadata_storage.values())
                    event['storageReservedBytes'] = reserved
                    require(len(data) <= 2 * MIB and reserved <= 16 * MIB, 'Helper metadata ceiling')
                value = original(*args, **kwargs)
                if isinstance(value, subprocess.CompletedProcess):
                    observed = retain(evidence, event, 'value', vars(value), encoder=raw)
                else:
                    observed = retain(evidence, event, 'value', value, encoder=raw)
                if evidence.get('phase') != 'cleanup' and not observed:
                    raise evidence['unencodedFacts'][-1]['encodingError']
                return value
            except BaseException as error:
                if evidence.get('phase') != 'cleanup': evidence.setdefault('collectionFailure', error)
                retain(evidence, event, 'error', error, encoder=raw)
                if receipt and evidence.get('phase') == 'cleanup' and isinstance(error, Exception):
                    evidence.setdefault('cleanupReceiptFailures', []).append(event)
                    return None  # Retain the failure; mandatory owned drain must still run.
                raise
            finally:
                unwinding = sys.exc_info()[0] is not None
                try:
                    observation_bytes += journal.append(event) if journal is not None else len(encoded(event))
                except BaseException as error:
                    if journal is not None: journal.fail(event, error)
                    evidence.setdefault('unencodedFacts', []).append({'key': 'helper-event', 'original': event, 'encodingError': error})
                    if evidence.get('phase') != 'cleanup':
                        evidence.setdefault('collectionFailure', error)
                    else:
                        evidence.setdefault('secondaryFailures', []).append(error)
                    if not unwinding and (evidence.get('phase') != 'cleanup' or not isinstance(error, Exception)):
                        raise
                if journal is None and observation_bytes > 12 * MIB and evidence.get('phase') != 'cleanup' and sys.exc_info()[0] is None:
                    raise ValueError('Raw helper observation ceiling exceeded')
        restored.append((owner, name, original))
        setattr(owner, name, call)
    for module in modules:
        wrap(module, 'write', receipt=True)
    for name in ('run', 'check_output'):
        wrap(subprocess, name)
    wrap(modules[0], '_archive_profile_paths')
    for module in modules:
        for name in ('kernel_tasks', 'identity', 'coalition'):
            if hasattr(module, name):
                wrap(module, name)
    try:
        yield
    finally:
        for owner, name, original in reversed(restored):
            setattr(owner, name, original)
        evidence['helperMetadataAttemptedBytes'] = metadata_bytes
        evidence['helperMetadataReservedBytes'] = 2 * sum(metadata_storage.values())
        evidence['helperObservationBytes'] = observation_bytes
        if journal is not None:
            unwinding = sys.exc_info()[0] is not None
            try: journal.finish()
            except BaseException as error:
                evidence.setdefault('secondaryFailures', []).append(error)
                evidence['journalFinishFailure'] = error
                if not unwinding: raise


def capture(ready, spec, paths, record):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(HELPERS))
    import round4_job_boundary as boundary
    import run_round4_browser_proof as proof
    import run_round4_remaining8 as stages
    evidence = {'helperCalls': [], 'allocations': [], 'released': False}
    record['native'] = evidence
    job = observer = private = admission = None
    primary = callback_failure = secondary = cleanup_failure = None
    env = {'PATH': ready['bindings']['path'], 'SMOKE_GL': 'metal', 'DEBUG': 'pw:browser',
           'VIEWMODEL_READY': paths['ready'], 'VIEWMODEL_CONSUMPTION': paths['consumption'],
           'VIEWMODEL_UNIT': spec['id'], 'VIEWMODEL_ENTRY_TOKEN': record['entryToken'],
           'VIEWMODEL_SOURCE_HEAD': record['sourceHead'], 'VIEWMODEL_CONSUMPTION_SHA256': record['consumptionSha256'], 'PYTHONDONTWRITEBYTECODE': '1'}
    argv = [ready['bindings']['node'], str(Path(__file__).with_name('entry.mjs'))]
    from observations import Journal
    journal = Journal(Path(paths['evidence']) / 'helper-observations', evidence)
    record['helperEvidence'] = journal.manifest
    with observed_helpers((boundary, proof, stages), evidence, journal=journal):
        try:
            with deadline(600):
                evidence['allocations'].append({'operation': 'create_private_tmp', 'state': 'attempting'})
                private, admission = proof.create_private_tmp(Path(paths['evidence']) / 'private-admission.json')
                evidence['allocations'][-1].update(path=str(private), admission=admission)
                env['TMPDIR'] = str(private)
                job = boundary.StationJob.__new__(boundary.StationJob)
                evidence['allocations'].append({'operation': 'StationJob', 'path': str(Path(paths['evidence']) / 'job'), 'state': 'attempting'})
                job.__init__(Path(paths['evidence']) / 'job', argv, ready['bindings']['root'], capture_seconds=600, env=env)
                evidence['allocations'][-1].update(scratch=str(job.scratch), target=job.target)
                helper_ready = {'resolver': {'selectedExecutable': {'path': ready['bindings']['browserBinary']}},
                                'process_binary_sha256': ready['bindings']['process_binary_sha256']}
                observer = stages.StageReceipts(job, helper_ready, private)
                usage_roots = live_roots(job, private, admission)
                def observe():
                    nonlocal callback_failure
                    try:
                        # Retain producer exceptions before StationJob.wait normalizes them.
                        evidence['usage'] = sample_usage(usage_roots, evidence)
                        require(evidence['usage']['helperScratch'] <= 64 * MIB, 'Helper log working ceiling')
                        require(evidence['usage']['job'] <= 16 * MIB, 'Helper metadata working ceiling')
                        require(evidence['usage']['privateNonprofile'] <= 512 * MIB, 'Private TMP working ceiling')
                        require(evidence['usage']['profiles'] <= 1024 * MIB, 'Profile working ceiling')
                        observer.observe()
                    except BaseException as error:
                        if callback_failure is None:
                            callback_failure = error
                            retain(evidence, evidence, 'callbackFailure', error, encoder=raw)
                        raise
                job.start()
                outcome = job.wait(600, observer=observe)
                evidence['wait'] = outcome
                if callback_failure is None: callback_failure = evidence.get('collectionFailure')
                if callback_failure is not None:
                    evidence.setdefault('secondaryFailures', []).append({
                        'type': 'HelperWaitOutcome', 'outcome': outcome, 'errors': raw(job.state.get('errors', []))})
                    raise callback_failure
                evidence['observation'] = observer.receipt()
                require(outcome == 'completed', f'Capture did not complete: {outcome}')
                observer.require_browser()
                require(job.state['exits'].get('capture') == 0, 'Capture process did not exit 0')
        except BaseException as error:
            primary = callback_failure if callback_failure is not None else error
            # Serialization is deferred until mandatory owned cleanup is attempted.
            secondary = error if error is not primary else None
        # Cleanup gets one finite phase; any interruption stops archive/audit dispatch.
        evidence['phase'] = 'cleanup'
        try:
            with deadline(60):
                if job is not None and getattr(job, 'root', None) and getattr(job, 'coalition_id', None):
                    evidence['drain'] = copy.deepcopy(job.drain(60))
                    evidence['kernelAfterDrain'] = boundary.kernel_tasks(job.coalition_id)
                    evidence['membersAfterDrain'] = job.members()
                    require(job.state['drained'] and evidence['kernelAfterDrain']['live'] == 0 and not evidence['membersAfterDrain'], 'Capture release unproved')
                    require(size(private, skip_profiles=True) <= 512 * MIB, 'TMP archive ceiling')
                    require(sum(size(p) for p in private.glob('playwright_chromiumdev_profile-*')) <= 1024 * MIB, 'Profile archive ceiling')
                    require(size(job.scratch) <= 64 * MIB, 'Helper archive ceiling')
                    job.archive(profile_namespace=private, profile_prefixes=('playwright_chromiumdev_profile-',))
                    evidence['privateRelease'] = proof.preserve_private_tmp(private, admission, Path(paths['evidence']) / 'private-archive', job=job)
                    evidence['terminal'] = stages.terminal_audit(job, private, job.state.get('profiles', []))
                    require(job.state['clean'], 'Helper cleanup reported errors')
                    evidence['released'] = True
                    require(not evidence.get('cleanupReceiptFailures'), 'Cleanup receipt persistence failed; raw observations retained')
                elif job is None and private is not None:
                    evidence['privateRelease'] = proof.preserve_private_tmp(private, admission, Path(paths['evidence']) / 'private-archive', no_process_launched=True)
                    evidence['released'] = True
                else:
                    require(private is None and job is None, 'Partial helper allocation retained; manual ownership review required')
                    evidence['released'] = True
        except BaseException as error:
            cleanup_failure = error
            if primary is None:
                primary = error
        if primary is not None:
            retain(evidence, evidence, 'primaryFailure', primary, encoder=raw)
        for failure in (secondary, cleanup_failure):
            if failure is not None:
                row = {}
                retain(evidence, row, 'error', failure, encoder=raw)
                evidence.setdefault('secondaryFailures', []).append(row['error'])
        if observer:
            retain(evidence, evidence, 'lastObservation', vars(observer), encoder=raw)
        if job:
            retain(evidence, evidence, 'jobState', vars(job), encoder=raw)
        if primary is not None:
            primary.evidence = evidence
            raise primary
    if evidence.get('journalFailure') is not None:
        evidence['journalFailure'].evidence = evidence
        raise evidence['journalFailure']
    require(not evidence.get('unencodedFacts'), 'Observation encoding failed; originals retained in memory')
    require(evidence['released'], 'Release must precede decoder')
    return evidence
