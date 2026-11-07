"""The one disabled effects pilot. No runtime, imports of native helpers, or allocation."""
import hashlib
import json
import os
import stat
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
ASSET_HEAD = '2643aca9d8b85a45498d85eb637d20260ebf06d1'
HELPER_HEAD = 'ca7d91e378e9d2f3f0ce8f0651475dcb843875d9'
FILE, ASSET = 'effects/gravitic', 'gravitic_pull'
PURPOSE = 'EFFECTS_GRAVITIC_PULL_SINGLE_DISABLED_PILOT'
LIGHTS = ('noon-lush', 'night-exotic', 'open-space')
MIB = 1024 ** 2
PNG_CAP, PERF_CAP = 16 * MIB, 16 * 1024
OUTPUT_CAP = 11 * PNG_CAP + PERF_CAP
CAPTURE_SECONDS, CLEANUP_SECONDS, DECODE_SECONDS = 600, 60, 45
CACHE_SECONDS, CACHE_CAP = 30, 64 * MIB
METADATA_PER_PROCESS = 32 * MIB


class Refused(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise Refused(message)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(MIB), b''):
            h.update(chunk)
    return h.hexdigest()


def bounded_bytes(path, cap):
    p = Path(path)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= cap, 'JSON type/size cap: ' + str(p))
        data = stream.read(cap + 1)
        after = os.fstat(stream.fileno())
    require(len(data) <= cap, 'JSON cap: ' + str(p))
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and len(data) == before.st_size, 'JSON changed while reading')
    return data


def snapshot(path, cap=2 * MIB):
    """One bounded descriptor snapshot is both the hash and semantic authority."""
    data = bounded_bytes(path, cap)
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    value = json.loads(data, object_pairs_hook=unique, parse_constant=lambda value: (_ for _ in ()).throw(Refused('Nonfinite JSON: ' + value)))
    return {'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'value': value}


def read_json(path, cap=2 * MIB):
    return snapshot(path, cap)['value']


def plan():
    """Actual captureReview write order; all.length=6 adds the named asset subdirectory."""
    names = []
    for light in LIGHTS:
        names += [light + '_lod0.png', light + '_lod2.png']
        if light == 'noon-lush':
            names += ['wireframe_lod0.png', 'wireframe_lod2.png', 'overlay.png', 'far_lod2.png']
    return [ASSET + '/' + n for n in names + ['perf.json', 'sheet.png']]


def ledger():
    rows = [
        ('capture_outputs', OUTPUT_CAP, '11 controlled PNG writes plus perf.json; failed partials stay in the fresh output root'),
        ('future_lfs_copy', OUTPUT_CAP, 'Reserved for later Git LFS adoption; this pilot performs no git add or LFS write'),
        ('future_main_hydration', OUTPUT_CAP, 'Reserved for later parent hydration; this pilot makes no main-worktree copy'),
        ('controlled_metadata', 64 * MIB, 'Node and Python each reserve attempted receipt bytes before writing, 32 MiB each'),
        ('cache_snapshot', CACHE_CAP, 'One bounded pre-run cache copy, including a failed partial; 30 seconds; originals retained'),
        ('profile_work_and_archive', 2 * 1024 ** 3, 'StationJob.archive copytree before removal: 1 GiB observed source threshold plus 1 GiB archive'),
        ('private_tmp_work_and_archive', 1024 ** 3, 'preserve_private_tmp copies before removal: 512 MiB source plus 512 MiB archive, excluding profiles'),
        ('helper_logs_work_and_archive', 128 * MIB, 'StationJob scratch and archived log/receipt copies, 64 MiB observed source threshold; includes constructor/failed job'),
        ('generated_cache_growth', 256 * MIB, 'Observed additional Vite cache growth; original cache bytes already reduce free space'),
        ('filesystem_metadata', 16 * MIB, 'Directory and filesystem overhead reserve'),
        ('safety', 1024 ** 3, 'Fresh disk safety reserve, checked at admission and while observing'),
    ]
    total = sum(row[1] for row in rows)
    require(OUTPUT_CAP == 184565760 and total == 5402312704, 'Budget arithmetic drift')
    return {'rows': [{'writer': k, 'bytes': n, 'semantics': why} for k, n, why in rows],
            'outputCapBytes': OUTPUT_CAP, 'admissionBytes': total, 'imageStagingBytes': 0,
            'imageArchiveCopyBytes': 0, 'nativeOSQuotas': False,
            'scope': 'One pilot only; native thresholds are observations and can overshoot, not OS quotas.'}
