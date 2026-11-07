"""CPU-only freeze. One self-identity probe imports the pinned helpers; no job/browser is launched."""
import sys
import os
if not __debug__ or sys.flags.optimize != 0 or os.environ.get('PYTHONOPTIMIZE', '') not in ('', '0'):
    raise SystemExit('Optimized Python is refused before imports/allocation')
sys.dont_write_bytecode = True

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
spec = importlib.util.spec_from_file_location('fauna_caller', HERE / 'caller.py')
caller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caller)

HELPERS = ROOT / 'assets/blend/stations/_authoring'
PINS = {
    'round4_job_boundary.py': '3f5ca99841be6a2ab4218bd45c5e44c5bb368e331d4b323b906b25354baa444c',
    'round4_capture_children.py': 'e6bca98d53ce502a4115a6220a2aa78b27b3ab9ee1383c30165c274aaabb1f07',
    'run_round4_browser_proof.py': 'f550d2e70238c9ff5527a4316833b83a38cdcf519273ed4b366491a936961fab',
    'run_round4_remaining8.py': '4cc69399da225c755833ab8c35972e2a1845eec45198cad29488994ff870c5d8',
}
DECODER_PYTHON = Path('/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10')
DECODER_SITE = Path('/Users/andreyyurlov/.cache/uv/archive-v0/a88MR2jSm399x3XK/lib/python3.10/site-packages')
PRODUCT_REVIEW = Path('/Users/andreyyurlov/.codex/reviews/p1-e08-t09-2f36cdb2-source-rereview-sol/REVIEW.md')
PRODUCT_REVIEW_SHA = '6305f73723f18b48da6e25be99100c6867c6d524ac5bd8ec2441eeb0a18a3fa4'
PRODUCT_HEAD = 'd688579adf31c2a8ee9836495ba6b32708b99ccd'
LEGACY_HEAD = '02248e6fc53bcaade146008f97bd83b6373af3d9'
LEGACY_MANIFEST = ROOT / 'docs/review-records/p1-e08-t09-da01f7c6c/original-artifact-manifest.json'


def unit_budget(images, common):
    output = images * common['imagePerFileCapBytes'] + common['readoutCapBytes']
    return {'imageCount': images, 'fileCount': images + 1, 'newOutputCapBytes': output,
            'futureLfsAdditionalBytes': output, 'futureMainHydrationAdditionalBytes': output,
            'oneUnitAdmissionBytes': output * 3 + common['controlledMetadataCapBytes'] + common['cacheSnapshotCapBytes']
                                     + sum(common['nativeReservesAndObservedThresholds'].values())}


def binding(path):
    p = Path(path)
    return {'path': str(p), 'realpath': str(p.resolve(strict=True)), 'sha256': caller.sha(p), 'bytes': p.stat().st_size}


def python_runtime_probe():
    """Discover this pinned launcher's actual kernel executable in one short CPU child."""
    for name, expected in PINS.items():
        caller.require(caller.sha(HELPERS / name) == expected, 'Accepted helper pin changed: ' + name)
    launcher = str(Path(sys.executable).resolve())
    program = '''import os, sys
if not __debug__ or sys.flags.optimize != 0 or os.environ.get('PYTHONOPTIMIZE', '') not in ('', '0'):
    raise SystemExit('Optimized Python self probe refused')
sys.dont_write_bytecode = True
import hashlib, json
from pathlib import Path
helpers = Path(sys.argv[1])
for name, expected in json.loads(sys.argv[2]).items():
    if hashlib.sha256((helpers / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Accepted helper pin changed before self probe import')
sys.path.insert(0, str(helpers))
from round4_job_boundary import identity
from run_round4_browser_proof import executable_path
pid = os.getpid()
before = identity(pid)
actual = executable_path(pid)
after = identity(pid)
if not before or not after or before['birth'] != after['birth'] or before['uid'] != os.getuid() or after['uid'] != os.getuid():
    raise SystemExit('Python self identity changed')
def file(path):
    p = Path(path)
    return {'path': str(p), 'realpath': str(p.resolve(strict=True)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'bytes': p.stat().st_size}
print(json.dumps({'scope': 'CPU_SELF_PROCESS_ONLY_NOT_CAPTURE', 'pid': pid, 'uid': os.getuid(), 'identityBefore': before, 'identityAfter': after,
                  'launcher': file(str(Path(sys.executable).resolve())), 'kernelExecutable': file(actual)}))
'''
    argv = [launcher, '-I', '-B', '-c', program, str(HELPERS), json.dumps(PINS, sort_keys=True)]
    result = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=10,
                            env={'PATH': os.environ['PATH'], 'PYTHONOPTIMIZE': '0', 'PYTHONDONTWRITEBYTECODE': '1'})
    caller.require(result.returncode == 0, 'Pinned Python self probe failed: ' + result.stderr)
    observed = json.loads(result.stdout)
    caller.require(observed['launcher'] == binding(launcher) and observed['uid'] == os.getuid(), 'Pinned Python self probe launcher/UID mismatch')
    caller.require(observed['kernelExecutable'] == binding(observed['kernelExecutable']['path']), 'Actual Python executable binding changed')
    return {'argv': argv, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr,
            'observation': observed, 'processExitedAndReaped': True, 'nativeCaptureStarted': False}


def validate_python_runtime_bindings(ready):
    """The freeze must cover both the published launcher and self-observed executable."""
    observed = ready['pythonRuntimeProbe']['observation']
    caller.require(observed['launcher']['path'] == ready['python'], 'Python launcher selection changed')
    for kind in ('launcher', 'kernelExecutable'):
        expected = observed[kind]
        caller.require(ready['process_binary_sha256'].get(expected['path']) == expected['sha256'], 'Python ' + kind + ' missing/drifted in native process bindings')
        caller.require(expected in ready['bindings'], 'Python ' + kind + ' missing/drifted in immutable file bindings')


def make_ready():
    caller.optimization_guard()
    for name, expected in PINS.items():
        caller.require(caller.sha(HELPERS / name) == expected, 'Accepted helper pin changed: ' + name)
    caller.require(caller.sha(PRODUCT_REVIEW) == PRODUCT_REVIEW_SHA, 'Prior product source review drifted')
    python_probe = python_runtime_probe()
    node = str(Path(subprocess.check_output(['/usr/bin/which', 'node'], text=True).strip()).resolve())
    script = """import{createRequire}from'node:module';import{dirname}from'node:path';
const r=createRequire(process.cwd()+'/packages/tools/package.json'),t=r.resolve('@playwright/test'),p=createRequire(t).resolve('playwright'),c=createRequire(p).resolve('playwright-core');
const x=createRequire(process.cwd()+'/package.json').resolve('tsx/esm/api'),e=createRequire(x).resolve('esbuild');
console.log(JSON.stringify({nodeVersion:process.version,playwright:t,core:c,tsxApi:x,esbuild:e}));"""
    routes = json.loads(subprocess.check_output([node, '--input-type=module', '-e', script], cwd=ROOT, text=True, timeout=10))
    core = Path(routes['core']).parent
    browsers = json.loads((core / 'browsers.json').read_text())
    revision = next(b['revision'] for b in browsers['browsers'] if b['name'] == 'chromium-headless-shell')
    cache = Path.home() / 'Library/Caches/ms-playwright'
    browser_root = cache / ('chromium_headless_shell-' + revision) / 'chrome-headless-shell-mac-arm64'
    browser = browser_root / 'chrome-headless-shell'
    native = [Path(sys.executable).resolve(), Path(python_probe['observation']['kernelExecutable']['path']), Path(node), Path('/usr/bin/caffeinate'), browser]
    esbuild_binary = ROOT / 'node_modules/.pnpm/@esbuild+darwin-arm64@0.28.2/node_modules/@esbuild/darwin-arm64/bin/esbuild'
    caller.require(esbuild_binary.is_file(), 'Exact tsx esbuild native route missing')
    native += [esbuild_binary]
    browser_libraries = list(browser_root.glob('*.dylib'))
    files = [Path('/usr/bin/git'), Path('/usr/sbin/lsof'), Path('/bin/ps'), Path('/bin/launchctl'), Path('/usr/bin/pmset')]
    files += [HELPERS / name for name in PINS]
    files += native + browser_libraries + [PRODUCT_REVIEW, LEGACY_MANIFEST] + [Path(v) for k, v in routes.items() if k != 'nodeVersion']
    files += [DECODER_PYTHON, core / 'lib/coreBundle.js', core / 'browsers.json']
    files += [ROOT / p for p in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'packages/client/vite.config.js', 'packages/client/package.json', 'packages/shared/package.json', 'packages/tools/package.json')]
    tracked = subprocess.check_output(['/usr/bin/git', 'ls-files', '-z', 'packages/client/src', 'packages/client/public', 'packages/shared/src', 'packages/tools/src/capture'], cwd=ROOT).decode().split('\0')
    files += [ROOT / p for p in tracked if p and '/fauna_packet/' not in p]
    files += [p for p in HERE.iterdir() if p.is_file() and p.name != 'readiness.json']
    product_names = ['packages/client/src/Game.js', 'packages/client/src/gameplay/Fauna.js', 'packages/client/src/ui/HUD.js',
                     'packages/client/src/net/combat.js', 'packages/client/src/remote/RemoteEntities.js', 'packages/client/src/remote/replay.js',
                     'packages/tools/src/capture/capture.ts', 'packages/tools/src/capture/screens.ts']
    image_cap, metadata_cap, snapshot_cap = 16 * 1024**2, 64 * 1024**2, 64 * 1024**2
    # Native writers have no hard quota here. These are conservative reserves and observed stop thresholds.
    reserves = {'nativeProfileWorkingAndArchivePeak': 2 * 1024**3, 'privateTmpWorkingAndArchivePeak': 1024**3,
                'helperLogWorkingAndArchivePeak': 128 * 1024**2, 'generatedCacheGrowth': 256 * 1024**2,
                'filesystemMetadata': 16 * 1024**2, 'safetyReserveBytes': 1024**3}
    budget = {'imagePerFileCapBytes': image_cap, 'readoutCapBytes': 16384,
              'controlledMetadataCapBytes': metadata_cap, 'cacheSnapshotCapBytes': snapshot_cap,
              'cacheSnapshotDeadlineSeconds': caller.CACHE_SNAPSHOT_SECONDS,
              'outputCopyStagingBytes': 0, 'controlledImageTemporaryDiskBytes': 0,
              'nativeReservesAndObservedThresholds': reserves, 'safetyReserveBytes': reserves['safetyReserveBytes'],
              'nativeWritersHardBounded': False, 'allSixFitClaimed': False,
              'accounting': 'Each unit: output + future LFS copy + future main hydration + controlled receipts + bounded cache copy + native working/archive reserves + safety. Existing bytes are reflected in free space; no image staging/archive copy. Fresh admission is required for each unit.'}
    legacy = caller.legacy_binding(ROOT, '/usr/bin/git', LEGACY_HEAD)
    legacy_files = caller.read_json(LEGACY_MANIFEST)
    caller.require(legacy['files'] == len(legacy_files) == 440, 'Legacy packet must remain exactly 440 artifacts')
    workspace_links = [str(ROOT / 'packages' / name) for name in ('client', 'server', 'shared', 'tools')]
    caches = [str(ROOT / 'packages/client/node_modules/.vite'), str(ROOT / 'packages/client/node_modules/.vite-temp')]
    cache_owner_receipt = caller.cache_owners({'root': str(ROOT), 'uid': os.getuid(), 'generatedCaches': caches})
    initial_cache_bytes = sum(caller.observed_bytes(p) for p in caches)
    caller.require(initial_cache_bytes <= snapshot_cap, 'Pre-run cache snapshot exceeds cap')
    units = {}
    screens = [('fauna-hit-turn-' + light + '-' + aspect, light, aspect, 'correction')
               for light in ('day', 'night') for aspect in ('16x9', '21x9')]
    screens += [('fauna-combat', 'day', '16x9', 'broad'), ('fauna-combat-night', 'night', '16x9', 'broad')]
    for name, light, aspect, kind in screens:
        nonce = uuid.uuid4().hex
        units[name] = {'screen': name, 'light': light, 'aspect': aspect, 'kind': kind, 'attemptId': nonce,
                       'inventory': {'stills': 14 if kind == 'broad' else 8, 'frames': 204 if kind == 'broad' else 72, 'sheets': 1, 'readouts': 1},
                       'budget': unit_budget(219 if kind == 'broad' else 81, budget),
                       'output': str(ROOT / 'assets/renders/ui' / ('fauna-packet-' + name + '-' + nonce)),
                       'evidence': '/private/tmp/fhp-' + nonce, 'consumption': '/private/tmp/fhc-' + nonce + '.json',
                       'grant': '/private/tmp/fhg-' + nonce + '.json', 'authorizationId': 'fauna-' + nonce}
    ready = {
        'runtimeEnabled': False, 'phase': 'CPU_CANDIDATE_PENDING_INDEPENDENT_CALLER_FIXTURE_REVIEW',
        'root': str(ROOT), 'uid': os.getuid(), 'python': str(Path(sys.executable).resolve()), 'pythonVersion': sys.version,
        'node': node, 'path': os.environ['PATH'], 'git': '/usr/bin/git', **routes,
        'stationDirectory': str(HELPERS), 'acceptedHelperCommit': 'ca7d91e378e9d2f3f0ce8f0651475dcb843875d9',
        'browserCache': str(cache), 'resolver': {'selectedExecutable': {'path': str(browser), 'sha256': caller.sha(browser)}},
        'process_binary_sha256': {str(p): caller.sha(p) for p in native},
        'pythonRuntimeProbe': python_probe,
        'bindings': [binding(p) for p in sorted(set(files))],
        'dependencies': caller.tree_binding(ROOT / 'node_modules/.pnpm', workspace_links),
        'decoderPython': str(DECODER_PYTHON.resolve()), 'decoderSite': str(DECODER_SITE),
        'decoderDependencies': caller.tree_binding(DECODER_SITE / 'PIL'),
        'productBindings': {p: caller.sha(ROOT / p) for p in product_names},
        'productSourceHead': PRODUCT_HEAD, 'currentProductSourceReview': {'head': PRODUCT_HEAD, 'verdict': 'PASS', 'basis': 'Fresh source review PASS reported by parent; caller and runtime gates remain separate'},
        'priorProductSourceReview': {'verdict': 'PASS', 'historicalOnly': True, 'head': '2f36cdb2d6bdd1f40428b6b48c2c27fddbdcfcae',
                                    'path': str(PRODUCT_REVIEW), 'sha256': PRODUCT_REVIEW_SHA},
        'generatedCaches': caches, 'initialCacheBytes': initial_cache_bytes, 'cacheOwnerFreezeObservation': cache_owner_receipt,
        'legacyArchive': legacy, 'legacyArtifactCount': 440, 'legacyRecordedBytes': sum(row['bytes'] for row in legacy_files),
        'legacyVerification': 'Retained Git/LFS object identities and recorded manifest; historical images not hydrated into this worktree',
        'units': units, 'unitOrder': list(units), 'budget': budget,
        'scope': {'totalProposed': {'stills': 60, 'frames': 696, 'sheets': 6, 'readouts': 6, 'files': 768},
                  'offlineReplayOnly': True, 'liveServerQualified': False, 'realTimeQualified': False},
        'nativeRoutes': ['StationJob Python worker via launchctl', 'caffeinate owned by StationJob', 'pinned Node + bound tsx esm API entry (no pnpm/shell route)',
                         'tsx esbuild service', 'Vite rolldown/lightningcss in-process native addons',
                         'ordinary Chromium headless shell with GPU/renderer/utility children'],
        'noVideoRequested': True, 'ffmpegOrHardwareEncoderAllowed': False,
        'externalSystemXpcOwnership': 'UNQUALIFIED; no explicit encoder/recorder route in captureUi',
    }
    validate_python_runtime_bindings(ready)
    return ready


if __name__ == '__main__':
    ready = make_ready()
    with (HERE / 'readiness.json').open('x') as stream:
        json.dump(ready, stream, sort_keys=True, indent=2)
        stream.write('\n')
    print(json.dumps({'runtimeEnabled': False, 'unitOrder': ready['unitOrder'], 'perUnit': {name: ready['units'][name]['budget'] for name in ready['unitOrder']}}))
