"""CPU-only local byte freeze and self-executable observation; never starts a capture."""
import sys
import os
if not __debug__ or sys.flags.optimize:
    raise SystemExit('Optimized Python refused')
sys.dont_write_bytecode = True
import ctypes
import json
from pathlib import Path
import shutil
import subprocess
import sysconfig
import uuid
import zlib
import cache_owners
import cache_io
import apple_encoder

from bindings import file_binding, git, tree_binding
from contract import ASSET, ASSET_HEAD, FILE, HERE, ROOT, ledger, plan, read_json, require, sha


def make_ready():
    recovery = read_json(HERE / 'recovery.json')
    for row in recovery['files']:
        require(sha(ROOT / row['path']) == row['sha256'], 'Recovered helper changed')
    shared_capture = read_json(HERE / 'shared_capture.json')
    for row in shared_capture['files']:
        require(sha(ROOT / row['path']) == row['sha256'], 'Reviewed shared capture source changed')
    require(sha(shared_capture['review']['path']) == shared_capture['review']['sha256'], 'Shared capture review changed')
    python = str(Path(sys.executable).resolve())
    # Self introspection only. Bind the Homebrew launcher AND macOS Python.app kernel route.
    libproc = ctypes.CDLL('/usr/lib/libproc.dylib')
    libproc.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    libproc.proc_pidpath.restype = ctypes.c_int
    buf = ctypes.create_string_buffer(4096)
    require(libproc.proc_pidpath(os.getpid(), buf, len(buf)) > 0, 'Self Python kernel executable unavailable')
    actual = buf.value.decode()
    node = str(Path(shutil.which('node')).resolve())
    program = """import{createRequire}from'node:module';const r=createRequire(process.cwd()+'/packages/tools/package.json');
const playwright=r.resolve('@playwright/test'),p=createRequire(playwright).resolve('playwright'),core=createRequire(p).resolve('playwright-core');
const tsxApi=createRequire(process.cwd()+'/package.json').resolve('tsx/esm/api'),esbuild=createRequire(tsxApi).resolve('esbuild');
const esbuildBinary=createRequire(esbuild).resolve('@esbuild/darwin-arm64/bin/esbuild');
console.log(JSON.stringify({playwright,core,tsxApi,esbuild,esbuildBinary,nodeVersion:process.version}));"""
    routes = json.loads(subprocess.check_output([node, '--input-type=module', '-e', program], cwd=ROOT, text=True, timeout=10))
    core = Path(routes['core']).parent
    revisions = read_json(core / 'browsers.json')['browsers']
    revision = next(r['revision'] for r in revisions if r['name'] == 'chromium-headless-shell')
    browser_root = Path.home() / 'Library/Caches/ms-playwright' / ('chromium_headless_shell-' + revision) / 'chrome-headless-shell-mac-arm64'
    browser = browser_root / 'chrome-headless-shell'
    require(browser.is_file(), 'Installed browser missing; no network fetch authorized')
    encoder = apple_encoder.binding()
    processes = [Path(python), Path(actual), Path(node), browser, Path(routes['esbuildBinary']), Path('/usr/bin/caffeinate'), Path(encoder['executable']['path'])]
    tracked = git(ROOT, 'ls-files', 'packages/client/src', 'packages/shared/src', 'packages/tools/src/capture').splitlines()
    asset_paths = git(ROOT, 'diff', '--name-only', '634c51d2378748c6a514af2a792ee4500b912643', ASSET_HEAD).splitlines()
    require(len(asset_paths) == 64, 'Reviewed 64-file source unit changed')
    require(not git(ROOT, 'diff', ASSET_HEAD, '--', *asset_paths), 'Original source assets changed')
    files = {ROOT / p for p in tracked if '/effects_packet/' not in p}
    files.update(ROOT / p for p in asset_paths)
    files.update(ROOT / r['path'] for r in recovery['files'])
    files.update(p for p in HERE.iterdir() if p.suffix in ('.py', '.mjs') or p.name in ('recovery.json', 'shared_capture.json', 'native_failure_fixture.json', 'README.md'))
    files.add(Path(shared_capture['review']['path']))
    files.update(processes)
    files.add(Path(encoder['codesign']['path']))
    files.update(Path(p) for p in ('/usr/bin/git', '/bin/launchctl', '/bin/ps', '/usr/sbin/lsof', '/usr/bin/pmset'))
    files.update(Path(p) for k, p in routes.items() if k != 'nodeVersion')
    files.update(browser_root.glob('*.dylib'))
    files.add(core / 'browsers.json')
    files.update(ROOT / p for p in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'packages/client/vite.config.js', 'packages/client/package.json', 'packages/tools/package.json', 'packages/shared/package.json', 'packages/tools/blender/families.json', 'assets/manifest.json') if (ROOT / p).is_file())
    # The browser uses all local runtime resources; pin the installed tree, not a filename promise.
    dependency_roots = [ROOT / 'node_modules', browser_root, ROOT / 'packages/client/public']
    dependency_roots += [ROOT / 'packages' / p / 'node_modules' for p in ('client', 'tools', 'shared') if (ROOT / 'packages' / p / 'node_modules').is_dir()]
    stdlib = Path(sysconfig.get_path('stdlib'))
    files.update(stdlib / p for p in ('json/__init__.py', 'json/decoder.py', 'json/scanner.py', 'json/encoder.py', 'hashlib.py', 'struct.py', 'pathlib/__init__.py', 'contextlib.py', 'signal.py', 'subprocess.py', 'shutil.py', 'stat.py') if (stdlib / p).is_file())
    files.add(Path(zlib.__file__))
    files.add(stdlib.parent.parent / 'Python')
    # Decode imports are frozen too, including their in-process extension modules.
    import inspect_packet
    for module in list(sys.modules.values()):
        module_file = getattr(module, '__file__', None)
        if module_file and Path(module_file).is_file() and str(Path(module_file)).startswith(str(stdlib)):
            files.add(Path(module_file))
    files.update((stdlib / 'lib-dynload').glob('_hashlib.*'))
    files.update((stdlib / 'lib-dynload').glob('_struct.*'))
    files.update((stdlib / 'lib-dynload').glob('_json.*'))
    review = Path('/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab/docs/review-records/p1-e07-t14/source-review-01-2643aca.txt')
    files.add(review)
    manifest = read_json(ROOT / 'assets/blend/effects/manifest.json')
    asset = next(a for a in manifest['assets'] if a['id'] == ASSET)
    require(asset['material'] == 'LIB_FX_Gravitic' and asset['triangles'] == 576, 'Manifest filament contract changed')
    nonce = uuid.uuid4().hex
    caches = [str(ROOT / 'packages/client/node_modules' / n) for n in ('.vite', '.vite-temp')]
    from native_ports import tree_bytes  # Pure function; NativePorts is NOT instantiated or imported by disabled caller.
    initial = sum(tree_bytes(p) for p in caches)
    require(initial <= 64 * 1024 ** 2, 'Initial cache exceeds finite snapshot cap')
    return {
        'runtimeEnabled': False, 'phase': 'SOURCE_ONLY_PENDING_PARENT_CALLER_REVIEW_AND_ONE_USE_GRANT',
        'root': str(ROOT), 'uid': os.getuid(), 'path': os.environ['PATH'], 'python': python, 'node': node, **routes,
        'pythonRuntime': {'launcher': file_binding(python), 'kernelExecutable': file_binding(actual),
                          'probe': {'scope': 'CURRENT_CPU_SELF_PROCESS_ONLY', 'pid': os.getpid(), 'uid': os.getuid(), 'nativeCaptureStarted': False}},
        'process_binary_sha256': {str(p): sha(p) for p in processes},
        'appleEncoder': encoder,
        'resolver': {'selectedExecutable': {'path': str(browser), 'sha256': sha(browser)}},
        'bindings': [file_binding(p) for p in sorted(files)],
        'dependencyTrees': [tree_binding(p) for p in dependency_roots],
        'decoder': {'kind': 'IN_PROCESS_STDLIB_ZLIB_ALL_PNG_SCANLINES', 'nativeCodecJob': False, 'python': python, 'zlib': file_binding(zlib.__file__), 'deadlineSeconds': 45},
        'assetHead': ASSET_HEAD, 'assetSourcePaths': asset_paths, 'asset': asset,
        'retainedAssetSourceReview': file_binding(review),
        'freezePredecessor': {'head': git(ROOT, 'rev-parse', 'HEAD'), 'tree': git(ROOT, 'rev-parse', 'HEAD^{tree}'), 'informativeOnly': True},
        'generatedCaches': caches, 'initialCacheBytes': initial,
        'cacheReadPolicy': {'entryCap': cache_io.ENTRY_CAP, 'allAncestorsNoFollow': True,
                            'reads': 'Copy, source verification, destination verification: admitted descriptor size plus one byte each.'},
        'sharedCaptureLifecycle': shared_capture,
        'cacheOwnerPolicy': {'secondsPerCheck': cache_owners.OWNER_SECONDS, 'commandOutputCap': cache_owners.COMMAND_CAP,
                             'checkOutputCap': cache_owners.CHECK_CAP, 'phases': ['before-consumption-and-snapshot', 'immediately-before-launch'],
                             'scope': 'Exact cache opens and task-local Node/Vite cwd/argv; any owner or uncertainty refuses; observations are not a lock.'},
        'pilot': {'file': FILE, 'asset': ASSET, 'gl': 'metal', 'viewport': [1920, 1080], 'files': plan(),
                  'attemptId': nonce, 'authorizationId': 'effects-' + nonce,
                  'output': str(ROOT / 'assets/renders' / ('effects-pilot-' + nonce)),
                  'evidence': '/private/tmp/egp-' + nonce, 'consumption': '/private/tmp/egc-' + nonce + '.json',
                  'grant': '/private/tmp/egg-' + nonce + '.json'},
        'budget': ledger(), 'deadlines': {'capture': 600, 'cleanup': 60, 'decode': 45, 'cacheCopy': 30},
        'remainingPrerequisites': ['Both runtime flags remain false after the spent failed native pilot; fresh correction review required.',
                                  'Failed authorization effects-b61233fdf3564205bd01d9566f306430 is permanently spent; never retry it.',
                                  'Parent independent caller review tied to exact clean head/tree and exact readiness bytes.',
                                  'Parent schedules a fresh one-root slot only after correction/activation review and a distinct one-use grant; native authority already exists.',
                                  'Parent observed OS exit zero plus exact terminal result and consumption hashes.',
                                  'Native Metal/backend performance and blind visual acceptance remain unqualified.'],
        'systemLibraryBoundary': 'macOS system libraries in the OS dyld cache are platform dependencies, not standalone file byte pins; Python framework, decoder extension and loaded stdlib files are pinned.',
        'externalSystemXpcOwnership': 'UNQUALIFIED; no recorder/encoder requested',
        'scope': 'Only gravitic_pull; static 12-file pilot, requested LOD2 selects only authored LOD0; no motion/atlas/21:9/alpha-overlap/batch.'}


if __name__ == '__main__':
    result = make_ready()
    (HERE / 'readiness.json').write_text(json.dumps(result, sort_keys=True, indent=2) + '\n')
    print(json.dumps({'runtimeEnabled': False, 'bindings': len(result['bindings']), 'budget': result['budget']['admissionBytes'], 'pilot': result['pilot']}))
