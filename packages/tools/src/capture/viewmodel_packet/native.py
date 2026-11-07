"""Adapter to the four recovered helpers. Imported only after grant consumption."""
from contextlib import contextmanager
import copy
import os
from pathlib import Path
import subprocess
import sys

from boundary import MIB, deadline, encoded, raw, require
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


@contextmanager
def observed_helpers(modules, evidence):
    """Retain return values before helper assertions, including unknown fields/bytes."""
    restored = []
    metadata_bytes = 0
    observation_bytes = 0
    def wrap(owner, name, *, receipt=False):
        original = getattr(owner, name)
        def call(*args, **kwargs):
            nonlocal metadata_bytes, observation_bytes
            event = {'operation': name, 'args': raw(args), 'kwargs': raw(kwargs)}
            evidence['helperCalls'].append(event)
            try:
                if receipt:
                    data = encoded(args[1])
                    metadata_bytes += len(data)  # Failed/repeated attempts count too.
                    event['attemptedBytes'] = len(data)
                    require(len(data) <= 2 * MIB and metadata_bytes <= 16 * MIB, 'Helper metadata ceiling')
                value = original(*args, **kwargs)
                if isinstance(value, subprocess.CompletedProcess):
                    event['value'] = raw(vars(value))
                else:
                    event['value'] = raw(copy.deepcopy(value))
                return value
            except BaseException as error:
                event['error'] = raw(error)
                if receipt and evidence.get('phase') == 'cleanup' and isinstance(error, Exception):
                    evidence.setdefault('cleanupReceiptFailures', []).append(event)
                    return None  # Retain the failure; mandatory owned drain must still run.
                raise
            finally:
                observation_bytes += len(encoded(event))
                if observation_bytes > 12 * MIB and evidence.get('phase') != 'cleanup' and sys.exc_info()[0] is None:
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
        evidence['helperObservationBytes'] = observation_bytes


def capture(ready, spec, paths, record):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(HELPERS))
    import round4_job_boundary as boundary
    import run_round4_browser_proof as proof
    import run_round4_remaining8 as stages
    evidence = {'helperCalls': [], 'allocations': [], 'released': False}
    record['native'] = evidence
    job = observer = private = admission = None
    primary = callback_failure = None
    env = {'PATH': ready['bindings']['path'], 'SMOKE_GL': 'metal', 'DEBUG': 'pw:browser',
           'VIEWMODEL_READY': paths['ready'], 'VIEWMODEL_CONSUMPTION': paths['consumption'],
           'VIEWMODEL_UNIT': spec['id'], 'VIEWMODEL_ENTRY_TOKEN': record['entryToken'],
           'VIEWMODEL_SOURCE_HEAD': record['sourceHead'], 'VIEWMODEL_CONSUMPTION_SHA256': record['consumptionSha256'], 'PYTHONDONTWRITEBYTECODE': '1'}
    argv = [ready['bindings']['node'], str(Path(__file__).with_name('entry.mjs'))]
    with observed_helpers((boundary, proof, stages), evidence):
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
                def observe():
                    nonlocal callback_failure
                    try:
                        # Retain producer exceptions before StationJob.wait normalizes them.
                        evidence['usage'] = {'helperScratch': size(job.scratch), 'job': size(job.out),
                                             'privateNonprofile': size(private, skip_profiles=True),
                                             'profiles': sum(size(p) for p in private.glob('playwright_chromiumdev_profile-*'))}
                        require(evidence['usage']['helperScratch'] <= 64 * MIB, 'Helper log working ceiling')
                        require(evidence['usage']['job'] <= 16 * MIB, 'Helper metadata working ceiling')
                        require(evidence['usage']['privateNonprofile'] <= 512 * MIB, 'Private TMP working ceiling')
                        require(evidence['usage']['profiles'] <= 1024 * MIB, 'Profile working ceiling')
                        observer.observe()
                    except BaseException as error:
                        if callback_failure is None:
                            callback_failure = error
                            evidence['callbackFailure'] = raw(error)
                        raise
                job.start()
                outcome = job.wait(600, observer=observe)
                evidence['wait'] = outcome
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
            evidence['primaryFailure'] = evidence['callbackFailure'] if callback_failure is not None else raw(error)
            if error is not primary:
                evidence.setdefault('secondaryFailures', []).append(raw(error))
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
            evidence.setdefault('secondaryFailures', []).append(raw(error))
            if primary is None:
                primary = error
            if not isinstance(error, Exception):
                primary.evidence = evidence
                raise primary
        if observer:
            evidence['lastObservation'] = raw(vars(observer))
        if job:
            evidence['jobState'] = raw(vars(job))
        if primary is not None:
            primary.evidence = evidence
            raise primary
    require(evidence['released'], 'Release must precede decoder')
    return evidence
