"""CPU-only freeze of routes/accounting. Does not import Playwright, Vite or ownership helpers."""
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

HELPERS = Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/blend/stations/_authoring')
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


def binding(path):
    p = Path(path)
    return {'path': str(p), 'realpath': str(p.resolve(strict=True)), 'sha256': caller.sha(p), 'bytes': p.stat().st_size}


def make_ready():
    caller.optimization_guard()
    for name, expected in PINS.items():
        caller.require(caller.sha(HELPERS / name) == expected, 'Accepted helper pin changed: ' + name)
    caller.require(caller.sha(PRODUCT_REVIEW) == PRODUCT_REVIEW_SHA, 'Prior product source review drifted')
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
    native = [Path(sys.executable).resolve(), Path(node), Path('/usr/bin/caffeinate'), browser]
    esbuild_binary = ROOT / 'node_modules/.pnpm/@esbuild+darwin-arm64@0.28.2/node_modules/@esbuild/darwin-arm64/bin/esbuild'
    caller.require(esbuild_binary.is_file(), 'Exact tsx esbuild native route missing')
    native += [esbuild_binary]
    browser_libraries = list(browser_root.glob('*.dylib'))
    files = [Path('/usr/bin/git'), Path('/usr/sbin/lsof'), Path('/bin/ps'), Path('/bin/launchctl'), Path('/usr/bin/pmset')]
    files += [HELPERS / name for name in PINS]
    files += native + browser_libraries + [PRODUCT_REVIEW] + [Path(v) for k, v in routes.items() if k != 'nodeVersion']
    files += [DECODER_PYTHON, core / 'lib/coreBundle.js', core / 'browsers.json']
    files += [ROOT / p for p in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'packages/client/vite.config.js', 'packages/client/package.json', 'packages/shared/package.json', 'packages/tools/package.json')]
    tracked = subprocess.check_output(['/usr/bin/git', 'ls-files', '-z', 'packages/client/src', 'packages/client/public', 'packages/shared/src', 'packages/tools/src/capture'], cwd=ROOT).decode().split('\0')
    files += [ROOT / p for p in tracked if p and '/fauna_packet/' not in p]
    files += [p for p in HERE.iterdir() if p.is_file() and p.name != 'readiness.json']
    product_names = ['packages/client/src/Game.js', 'packages/client/src/gameplay/Fauna.js', 'packages/client/src/ui/HUD.js',
                     'packages/client/src/net/combat.js', 'packages/client/src/remote/RemoteEntities.js', 'packages/client/src/remote/replay.js',
                     'packages/tools/src/capture/capture.ts', 'packages/tools/src/capture/screens.ts']
    image_cap, metadata_cap, snapshot_cap = 16 * 1024**2, 64 * 1024**2, 64 * 1024**2
    output_cap = 81 * image_cap + 16384
    # Native writers have no hard quota here. These are conservative reserves and observed stop thresholds.
    reserves = {'nativeProfileWorkingAndArchivePeak': 2 * 1024**3, 'privateTmpWorkingAndArchivePeak': 1024**3,
                'helperLogWorkingAndArchivePeak': 128 * 1024**2, 'generatedCacheGrowth': 256 * 1024**2,
                'filesystemMetadata': 16 * 1024**2, 'safetyReserveBytes': 1024**3}
    legacy_files = caller.inventory(ROOT / 'assets/renders/ui/fauna-combat') + caller.inventory(ROOT / 'assets/renders/ui/fauna-combat-night')
    caller.require(len(legacy_files) == 440, 'Legacy packet must remain exactly 440 artifacts')
    workspace_links = [str(ROOT / 'packages' / name) for name in ('client', 'server', 'shared', 'tools')]
    caches = [str(ROOT / 'packages/client/node_modules/.vite'), str(ROOT / 'packages/client/node_modules/.vite-temp')]
    cache_owner_receipt = caller.cache_owners({'root': str(ROOT), 'uid': os.getuid(), 'generatedCaches': caches})
    initial_cache_bytes = sum(caller.observed_bytes(p) for p in caches)
    caller.require(initial_cache_bytes <= snapshot_cap, 'Pre-run cache snapshot exceeds cap')
    units = {}
    for light in ('day', 'night'):
        for aspect in ('16x9', '21x9'):
            name = 'fauna-hit-turn-' + light + '-' + aspect
            nonce = uuid.uuid4().hex
            units[name] = {'screen': name, 'light': light, 'aspect': aspect, 'attemptId': nonce,
                           'output': str(ROOT / 'assets/renders/ui' / ('fauna-packet-' + name + '-' + nonce)),
                           'evidence': '/private/tmp/fhp-' + nonce, 'consumption': '/private/tmp/fhc-' + nonce + '.json'}
    per_unit = output_cap * 3 + metadata_cap + snapshot_cap + sum(reserves.values())
    return {
        'runtimeEnabled': False, 'phase': 'CPU_CANDIDATE_PENDING_INDEPENDENT_CALLER_FIXTURE_REVIEW',
        'root': str(ROOT), 'uid': os.getuid(), 'python': str(Path(sys.executable).resolve()), 'pythonVersion': sys.version,
        'node': node, 'path': os.environ['PATH'], 'git': '/usr/bin/git', **routes,
        'stationDirectory': str(HELPERS), 'acceptedHelperCommit': 'ca7d91e378e9d2f3f0ce8f0651475dcb843875d9',
        'browserCache': str(cache), 'resolver': {'selectedExecutable': {'path': str(browser), 'sha256': caller.sha(browser)}},
        'process_binary_sha256': {str(p): caller.sha(p) for p in native},
        'bindings': [binding(p) for p in sorted(set(files))],
        'dependencies': caller.tree_binding(ROOT / 'node_modules/.pnpm', workspace_links),
        'decoderPython': str(DECODER_PYTHON.resolve()), 'decoderSite': str(DECODER_SITE),
        'decoderDependencies': caller.tree_binding(DECODER_SITE / 'PIL'),
        'productBindings': {p: caller.sha(ROOT / p) for p in product_names},
        'reviewedCoreHead': '2f36cdb2d6bdd1f40428b6b48c2c27fddbdcfcae',
        'priorProductSourceReview': {'verdict': 'PASS', 'path': str(PRODUCT_REVIEW), 'sha256': PRODUCT_REVIEW_SHA},
        'generatedCaches': caches, 'initialCacheBytes': initial_cache_bytes, 'cacheOwnerFreezeObservation': cache_owner_receipt,
        'legacyFiles': legacy_files, 'legacyArtifactCount': 440, 'legacyBytesAlreadyOnDisk': sum(row['bytes'] for row in legacy_files),
        'units': units,
        'budget': {'imagePerFileCapBytes': image_cap, 'imageCount': 81, 'readoutCapBytes': 16384,
                   'newOutputCapBytes': output_cap, 'controlledMetadataCapBytes': metadata_cap, 'cacheSnapshotCapBytes': snapshot_cap,
                   'cacheSnapshotDeadlineSeconds': caller.CACHE_SNAPSHOT_SECONDS,
                   'outputCopyStagingBytes': 0, 'controlledImageTemporaryDiskBytes': 0,
                   'futureLfsAdditionalBytes': output_cap, 'futureMainHydrationAdditionalBytes': output_cap,
                   'nativeReservesAndObservedThresholds': reserves, 'safetyReserveBytes': reserves['safetyReserveBytes'],
                   'oneUnitAdmissionBytes': per_unit, 'fourUnitsConservativeBytes': 4 * (per_unit - reserves['safetyReserveBytes']) + reserves['safetyReserveBytes'],
                   'nativeWritersHardBounded': False, 'allFourFitClaimed': False,
                   'accounting': 'New output + future LFS object + future main hydration + controlled receipts + pre-run cache copy + native working/archive reserves + safety. Existing legacy/source/dependency bytes are already reflected in observed free space; no extra staging/output/archive image copy is requested.'},
        'scope': {'stillsPerUnit': 8, 'framesPerUnit': 72, 'sheetsPerUnit': 1, 'readoutsPerUnit': 1,
                  'totalProposed': {'stills': 32, 'frames': 288, 'sheets': 4, 'readouts': 4},
                  'offlineReplayOnly': True, 'liveServerQualified': False, 'realTimeQualified': False},
        'nativeRoutes': ['StationJob Python worker via launchctl', 'caffeinate owned by StationJob', 'pinned Node + bound tsx esm API entry (no pnpm/shell route)',
                         'tsx esbuild service', 'Vite rolldown/lightningcss in-process native addons',
                         'ordinary Chromium headless shell with GPU/renderer/utility children'],
        'noVideoRequested': True, 'ffmpegOrHardwareEncoderAllowed': False,
        'externalSystemXpcOwnership': 'UNQUALIFIED; no explicit encoder/recorder route in captureUi',
    }


if __name__ == '__main__':
    ready = make_ready()
    with (HERE / 'readiness.json').open('x') as stream:
        json.dump(ready, stream, sort_keys=True, indent=2)
        stream.write('\n')
    print(json.dumps({'runtimeEnabled': False, 'units': 4, 'oneUnitAdmissionBytes': ready['budget']['oneUnitAdmissionBytes']}))
