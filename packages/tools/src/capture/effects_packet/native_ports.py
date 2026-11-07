"""Lazy adapter over the four unchanged Station helpers. Never imported while disabled."""
import contextlib
import importlib
import os
from pathlib import Path
import shutil
import signal
import stat
import sys
import time
from types import SimpleNamespace

from contract import CACHE_CAP, CACHE_SECONDS, MIB, ROOT, require, sha
from evidence import failure, raw


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
    charged = 0
    with phase(CACHE_SECONDS):
        for index, name in enumerate(ready['generatedCaches']):
            root = Path(name)
            row = {'source': name, 'exists': root.exists(), 'files': [], 'complete': False}
            observations.append(row)
            if not root.exists():
                row['complete'] = True
                continue
            require(root.resolve() == root and not root.is_symlink(), 'Cache root route changed')
            require(tree_bytes(root) + charged <= CACHE_CAP, 'Cache snapshot admission cap')
            target = destination / str(index)
            target.mkdir(parents=True, exist_ok=False)
            for p in sorted(root.rglob('*')):
                require(not p.is_symlink(), 'Cache symlink')
                q = target / p.relative_to(root)
                if p.is_dir():
                    q.mkdir(exist_ok=False)
                    continue
                before = p.stat()
                require(p.is_file() and charged + before.st_size <= CACHE_CAP, 'Cache snapshot file cap')
                charged += before.st_size  # Include partial attempts; no retry.
                item = {'path': str(p), 'bytes': before.st_size, 'complete': False}
                row['files'].append(item)
                with p.open('rb') as src, q.open('xb') as dst:
                    remaining = before.st_size
                    while remaining:
                        block = src.read(min(MIB, remaining))
                        require(block, 'Cache shrank')
                        dst.write(block)
                        remaining -= len(block)
                    require(not src.read(1), 'Cache grew')
                require(p.stat() == before and sha(p) == sha(q), 'Cache snapshot drift')
                item.update(complete=True, sha256=sha(q))
            row['complete'] = True
    return charged


def observe_call(records, name, function, *args, owner=None, **kwargs):
    """Intercept existing read/ownership ports before assertions erase partial observations."""
    job = owner
    row = {'call': name, 'observations': [], 'returned': None, 'failure': None}
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
    old_members = job.__dict__.get('members') if job else None
    had_members = job and 'members' in job.__dict__
    try:
        for key in ('kernel_tasks', 'identity', 'coalition', 'executable_path', 'current_commands', 'parse_launch', '_archive_profile_paths', '_tmp_tree', 'tmp_admission'):
            if key in namespace:
                replaced[key] = namespace[key]
                namespace[key] = wrap(key, namespace[key])
        if 'subprocess' in namespace:
            original = namespace['subprocess']
            replaced['subprocess'] = original
            namespace['subprocess'] = SimpleNamespace(**{**vars(original), **{k: wrap('subprocess.' + k, getattr(original, k)) for k in ('run', 'check_output')}})
        if job:
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
        if job:
            row['jobState'] = raw(getattr(job, 'state', {}))
            row['known'] = raw(getattr(job, 'known', {}))
            if had_members:
                job.members = old_members
            else:
                del job.members


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
        p = self.ready['pilot']
        profiles = sum(tree_bytes(x) for x in self.tmp.iterdir() if x.name.startswith('playwright_chromiumdev_profile-'))
        tmp = sum(tree_bytes(x) for x in self.tmp.iterdir() if not x.name.startswith('playwright_chromiumdev_profile-'))
        logs = tree_bytes(job.scratch) + tree_bytes(job.out)
        caches = sum(tree_bytes(x) for x in self.ready['generatedCaches'])
        observed = {'profileBytes': profiles, 'privateTmpNonprofileBytes': tmp, 'helperBytes': logs,
                    'cacheBytes': caches, 'free': shutil.disk_usage(p['output']).free}
        self.result['raw']['lastWriterObservation'] = observed
        require(profiles <= 1024 ** 3 and tmp <= 512 * MIB and logs <= 64 * MIB, 'Native writer observed stop threshold')
        require(caches <= self.ready['initialCacheBytes'] + 256 * MIB and observed['free'] >= 1024 ** 3, 'Cache growth/free-space stop threshold')
        if for_archive:
            observed['archiveRequiredFree'] = profiles + tmp + logs + 1024 ** 3
            require(observed['free'] >= observed['archiveRequiredFree'], 'Insufficient actual copy-before-remove archive headroom')

    def cleanup(self, job, observer):
        records = self.result['raw'].setdefault('cleanup', [])
        # Constructor/start failure without a proved cohort is retained, never guessed away.
        require(getattr(job, 'root', None) and getattr(job, 'coalition_id', None), 'No proved cohort for attempted job; retain all partials')
        observe_call(records, 'drain', job.drain, seconds=45, observer=observer.observe if observer else lambda: None, owner=job)
        require(job.state.get('clean') is True and job.state.get('drained') is True and job.state.get('kernel_terminal', {}).get('live') == 0, 'Positive capture cohort release missing')
        self.budgets(job, for_archive=True)
        observe_call(records, 'archive', job.archive, profile_namespace=self.tmp, profile_prefixes=('playwright_chromiumdev_profile-',), owner=job)
        profile = __import__('contract').snapshot(job.out / 'profile_release.json')
        self.result['raw']['profileReleaseSnapshot'] = profile
        require(profile['value'].get('all_absent') is True, 'Profile release missing')
        tmp = observe_call(records, 'private-tmp', self.browser.preserve_private_tmp, self.tmp, self.admission, job.out / 'preserved_private_tmp', owner=job, job=job, **{'no_process_launched': False})
        require(tmp.get('namespace_removed') is True and tmp.get('all_bytes_preserved') is True, 'TMP release incomplete')
        audit = observe_call(records, 'terminal', self.stages.terminal_audit, job, str(self.tmp), profile['value']['all_owned_profiles'], owner=job)
        require(audit.get('kernel_terminal', {}).get('live') == 0 and audit.get('registration_absent') is True and audit.get('namespace_absent') is True and audit.get('owned_listeners_absent_via_no_live_owned_task') is True, 'Terminal release facts missing')
        return {'released': True, 'terminal': audit, 'tmp': tmp, 'profiles': profile}

    def no_job_cleanup(self, evidence):
        if self.tmp is None:
            return {'released': False, 'reason': 'No allocation returned; preserve attached exception allocation facts'}
        return observe_call(self.result['raw'].setdefault('cleanup', []), 'unlaunched-private-tmp', self.browser.preserve_private_tmp,
                            self.tmp, self.admission, evidence / 'preserved_private_tmp', no_process_launched=True)
