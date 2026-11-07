"""Lazy adapter over the four unchanged Station helpers. Never imported while disabled."""
import contextlib
import importlib
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import time
from types import SimpleNamespace

from contract import CACHE_CAP, CACHE_SECONDS, MIB, ROOT, require, sha
from evidence import failure, raw, ownership


class PhaseExpired(BaseException):
    pass


@contextlib.contextmanager
def phase(seconds):
    previous, timer = signal.getsignal(signal.SIGALRM), signal.getitimer(signal.ITIMER_REAL)
    start, expired = time.monotonic(), False
    def alarm(*_):
        nonlocal expired
        expired = True
        raise PhaseExpired('Effects phase deadline expired')
    signal.signal(signal.SIGALRM, alarm)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield start + seconds
        require(not expired and time.monotonic() - start < seconds, 'Phase deadline was swallowed')
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(.000001, timer[0] - (time.monotonic() - start)), timer[1])


def tree_bytes(path):
    root = Path(path)
    if not root.exists():
        return 0
    total = 0
    for p in [root, *root.rglob('*')]:
        info = p.lstat()
        require(info.st_uid == os.getuid(), 'Native writer ownership changed')
        require(any(kind(info.st_mode) for kind in (stat.S_ISREG, stat.S_ISDIR, stat.S_ISLNK, stat.S_ISSOCK, stat.S_ISFIFO)), 'Unsupported native writer type')
        # Chromium's live profile has singleton links/sockets. Count links themselves, never follow them.
        if stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            total += info.st_size
    return total


def snapshot_caches(ready, destination, observations):
    from cache_io import inventory, create_directory, copy_file
    charged, created = 0, []
    with phase(CACHE_SECONDS):
        for index, name in enumerate(ready['generatedCaches']):
            root = Path(name)
            row = {'source': name, 'exists': None, 'files': [], 'complete': False, 'createdDirectories': []}
            observations.append(row)
            try:
                admitted = inventory(root, CACHE_CAP - charged, row)
                if row['exists']:
                    if not created:
                        create_directory(destination, row['createdDirectories'])
                        created.append(destination)
                    target = destination / str(index)
                    create_directory(target, row['createdDirectories'])
                    for source in admitted:
                        p = Path(source['path'])
                        q = target / p.relative_to(root)
                        if source['directory']:
                            create_directory(q, row['createdDirectories'])
                            continue
                        size = source['before']['st_size']
                        require(charged + size <= CACHE_CAP, 'Cache snapshot file cap')
                        charged += size  # Includes every attempted copy, even failed partials; no retry.
                        row['chargedBytes'] = charged
                        item = {'path': str(p), 'bytes': size, 'before': source['before'], 'complete': False}
                        row['files'].append(item)
                        copy_file(p, q, source, item)
                row['complete'] = True
            except BaseException as error:
                row['failure'] = failure(error)
                raise
    return charged


def observe_call(records, name, function, *args, owner=None, **kwargs):
    """Intercept existing read/ownership ports before assertions erase partial observations."""
    job = owner
    row = {'call': name, 'observations': [], 'returned': None, 'failure': None,
           'ownershipBefore': ownership(job) if job is not None else None}
    records.append(row)
    namespace, replaced = function.__globals__, {}
    def wrap(label, original):
        def observed(*a, **kw):
            item = {'probe': label, 'args': raw(a), 'kwargs': raw(kw)}
            row['observations'].append(item)
            try:
                result = original(*a, **kw)
                item['returned'] = raw(result)
                return result
            except BaseException as error:
                item['failure'] = failure(error)
                raise
        return observed
    old_members = job.__dict__.get('members') if job is not None else None
    had_members = job is not None and 'members' in job.__dict__
    wrapped_members = job is not None and hasattr(job, 'members')
    try:
        for key in ('kernel_tasks', 'identity', 'coalition', 'executable_path', 'current_commands', 'parse_launch', '_archive_profile_paths', '_tmp_tree', 'tmp_admission'):
            if key in namespace:
                replaced[key] = namespace[key]
                namespace[key] = wrap(key, namespace[key])
        if 'subprocess' in namespace:
            original = namespace['subprocess']
            replaced['subprocess'] = original
            namespace['subprocess'] = SimpleNamespace(**{**vars(original), **{k: wrap('subprocess.' + k, getattr(original, k)) for k in ('run', 'check_output') if hasattr(original, k)}})
        if wrapped_members:
            job.members = wrap('members', job.members)
        result = function(*args, **kwargs)
        row['returned'] = raw(result)
        return result
    except BaseException as error:
        row['failure'] = failure(error)
        raise
    finally:
        # No I/O in this finally: BaseException (including SIGALRM) immediately unwinds its phase.
        namespace.update(replaced)
        if wrapped_members:
            if had_members:
                job.members = old_members
            else:
                del job.members
        if job is not None:
            row['jobState'] = raw(getattr(job, 'state', {}))
            row['known'] = raw(getattr(job, 'known', {}))
            row['ownershipAfter'] = ownership(job)


class NativePorts:
    def __init__(self, ready, result):
        helpers = str(ROOT / 'assets/blend/stations/_authoring')
        sys.path.insert(0, helpers)
        try:
            self.boundary = importlib.import_module('round4_job_boundary')
            self.browser = importlib.import_module('run_round4_browser_proof')
            self.stages = importlib.import_module('run_round4_remaining8')
        finally:
            sys.path.remove(helpers)
        self.ready, self.result, self.tmp, self.admission = ready, result, None, None
        actual = self.browser.executable_path(os.getpid())
        require(actual == ready['pythonRuntime']['kernelExecutable']['path'] and sha(actual) == ready['process_binary_sha256'][actual], 'Actual kernel Python executable changed')

    phase = staticmethod(phase)
    cache_snapshot = staticmethod(snapshot_caches)

    def allocate_tmp(self, evidence):
        self.tmp, self.admission = self.browser.create_private_tmp(evidence / 'tmp-admission.json')
        return self.tmp, self.admission

    def job_object(self):
        return self.boundary.StationJob.__new__(self.boundary.StationJob)

    def initialize(self, job, evidence, ready_path):
        r, p = self.ready, self.ready['pilot']
        env = {'PATH': r['path'], 'TMPDIR': str(self.tmp), 'TMP': str(self.tmp), 'TEMP': str(self.tmp),
               'PYTHONOPTIMIZE': '0', 'PYTHONDONTWRITEBYTECODE': '1', 'SMOKE_GL': 'metal', 'DEBUG': 'pw:browser',
               'EFFECTS_AUTHORIZATION': p['authorizationId'], 'EFFECTS_READY_SHA256': self.result['admission']['ready']['sha256']}
        self.boundary.StationJob.__init__(job, evidence / 'job', [r['node'], str(ROOT / 'packages/tools/src/capture/effects_packet/entry.mjs'), str(ready_path)], ROOT, capture_seconds=600, env=env)

    def start(self, job):
        return observe_call(self.result['raw'].setdefault('start', []), 'start', job.start, owner=job)

    def observer(self, job):
        stage = self.stages.StageReceipts(job, self.ready, str(self.tmp))
        result = self.result
        class ObservedStage:
            def observe(self):
                records = []
                try:
                    observe_call(records, 'capture-observation', stage.observe, owner=job)
                except BaseException:
                    result['raw'].setdefault('captureObservationFailures', []).extend(records)
                    raise
                finally:
                    result['raw']['lastCaptureObservation'] = records
            def receipt(self):
                return stage.receipt()
            def require_browser(self):
                stage.require_browser()
        return ObservedStage()

    def budgets(self, job, *, for_archive=False):
        observed = {'profileBytes': 0, 'privateTmpNonprofileBytes': 0, 'helperBytes': 0,
                    'cacheBytes': 0, 'free': None, 'complete': False, 'probes': [], 'forArchive': for_archive}
        self.result['raw']['lastWriterObservation'] = observed  # Before any resource filesystem probe.
        def measure(key, path):
            probe = {'path': str(path), 'kind': key, 'bytes': None}
            observed['probes'].append(probe)
            try:
                if key == 'cacheBytes' and not for_archive:
                    from live_cache import measure as live_cache_bytes
                    try:
                        probe['bytes'] = live_cache_bytes(path, self.ready['initialCacheBytes'] + 256 * MIB - observed[key], probe)
                    finally:
                        if any(not a['complete'] for a in probe.get('attempts', [])):
                            # Keep interrupted samples even after a later observation succeeds.
                            self.result['raw'].setdefault('writerPublicationObservations', []).append(probe)
                else:
                    probe['bytes'] = tree_bytes(path)
                observed[key] += probe['bytes']
            except BaseException as error:
                probe['failure'] = failure(error)
                raise
        try:
            for path in self.tmp.iterdir():
                key = 'profileBytes' if path.name.startswith('playwright_chromiumdev_profile-') else 'privateTmpNonprofileBytes'
                measure(key, path)
            for path in (job.scratch, job.out):
                measure('helperBytes', path)
            for path in self.ready['generatedCaches']:
                measure('cacheBytes', path)
            observed['free'] = shutil.disk_usage(self.ready['pilot']['output']).free
            observed['complete'] = True
            require(observed['profileBytes'] <= 1024 ** 3 and observed['privateTmpNonprofileBytes'] <= 512 * MIB and observed['helperBytes'] <= 64 * MIB, 'Native writer observed stop threshold')
            require(observed['cacheBytes'] <= self.ready['initialCacheBytes'] + 256 * MIB and observed['free'] >= 1024 ** 3, 'Cache growth/free-space stop threshold')
            if for_archive:
                observed['archiveRequiredFree'] = observed['profileBytes'] + observed['privateTmpNonprofileBytes'] + observed['helperBytes'] + 1024 ** 3
                require(observed['free'] >= observed['archiveRequiredFree'], 'Insufficient actual copy-before-remove archive headroom')
        except BaseException as error:
            observed['failure'] = failure(error)
            self.result['raw'].setdefault('writerObservationFailures', []).append(observed)
            raise

    def cleanup(self, job, observer):
        records = self.result['raw'].setdefault('cleanup', [])
        # Constructor/start failure without a proved cohort is retained, never guessed away.
        require(getattr(job, 'root', None) and getattr(job, 'coalition_id', None), 'No proved cohort for attempted job; retain all partials')
        def cleanup_observation():
            if observer is not None:
                try:
                    observer.observe()
                except Exception as error:
                    # Work/observation refusal must not prevent ownership-checked termination.
                    # Retain it as failure; this path can release resources but never accept work.
                    self.result.setdefault('errors', []).append({'phase': 'cleanup-observer', **failure(error)})
        observe_call(records, 'drain', job.drain, seconds=45, observer=cleanup_observation, owner=job)
        if job.state.get('clean') is not True:
            self.result.setdefault('errors', []).append({'phase': 'cleanup-work-status', 'type': 'HelperWorkFailure',
                                          'message': 'Helper work/cleanup is not clean; resource release cannot accept capture',
                                          'attributes': {'clean': job.state.get('clean'), 'errors': raw(job.state.get('errors'))}})
        require(job.state.get('drained') is True and job.state.get('kernel_terminal', {}).get('live') == 0 and job.state.get('remaining') == [], 'Positive capture cohort release missing')
        self.budgets(job, for_archive=True)
        observe_call(records, 'archive', job.archive, profile_namespace=self.tmp, profile_prefixes=('playwright_chromiumdev_profile-',), owner=job)
        profile = __import__('contract').snapshot(job.out / 'profile_release.json')
        self.result['raw']['profileReleaseSnapshot'] = profile
        require(profile['value'].get('all_absent') is True, 'Profile release missing')
        tmp = observe_call(records, 'private-tmp', self.browser.preserve_private_tmp, self.tmp, self.admission, job.out / 'preserved_private_tmp', owner=job, job=job, **{'no_process_launched': False})
        require(tmp.get('namespace_removed') is True and tmp.get('all_bytes_preserved') is True, 'TMP release incomplete')
        audit = self.release_audit(job, profile['value']['all_owned_profiles'])
        require(audit.get('kernel_terminal', {}).get('live') == 0 and audit.get('registration_absent') is True and audit.get('namespace_absent') is True and audit.get('owned_listeners_absent_via_no_live_owned_task') is True, 'Terminal release facts missing')
        return {'released': True, 'captureClean': job.state.get('clean'), 'terminal': audit, 'tmp': tmp, 'profiles': profile}

    def release_audit(self, job, profiles):
        """Release is independent of work success; never rewrite the helper's clean/errors state."""
        audit = {'probes': [], 'captureClean': job.state.get('clean')}
        self.result['raw']['releaseAudit'] = audit
        def read(name, action):
            item = {'probe': name, 'returned': None}
            audit['probes'].append(item)
            try:
                value = action()
                item['returned'] = raw(value)
                return value
            except BaseException as error:
                item['failure'] = failure(error)
                raise
        require(job.state.get('drained') is True, 'Drain not proved')
        audit['kernel_terminal'] = read('kernel_tasks', lambda: self.boundary.kernel_tasks(job.coalition_id))
        require(audit['kernel_terminal'].get('live') == 0 and not read('members', job.members), 'Owned cohort still live')
        for pid, old in job.known.items():
            current = read('identity:' + str(pid), lambda pid=pid: self.boundary.identity(int(pid)))
            require(current is None or current['birth'] != old['birth'], 'Known owned birth remains')
        paths = [job.scratch, self.tmp, *profiles]
        for path in paths:
            require(not read('exists:' + str(path), lambda path=path: os.path.lexists(path)), 'Owned namespace remains')
        registration = read('registration', lambda: subprocess.run(['/bin/launchctl', 'print', job.target], capture_output=True, text=True, timeout=3))
        require(registration.returncode == 113 and 'Could not find service' in registration.stderr, 'Registration absence unproved')
        # Atomic cohort live0 plus absence of every known birth proves no owned listeners/assertions.
        audit.update(registration_absent=True, scratch_absent=True, namespace_absent=True,
                     profiles_absent=profiles, owned_listeners_absent_via_no_live_owned_task=True)
        return audit

    def no_job_cleanup(self, evidence):
        if self.tmp is None:
            return {'released': False, 'reason': 'No allocation returned; preserve attached exception allocation facts'}
        return observe_call(self.result['raw'].setdefault('cleanup', []), 'unlaunched-private-tmp', self.browser.preserve_private_tmp,
                            self.tmp, self.admission, evidence / 'preserved_private_tmp', no_process_launched=True)
