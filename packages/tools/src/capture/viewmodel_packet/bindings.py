"""Read-only, local bindings. This module never imports a capture helper."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

from boundary import canonical, git, require, snapshot

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
HELPERS = ROOT / 'assets/blend/stations/_authoring'
HELPER_HASHES = {
    'round4_job_boundary.py': '3f5ca99841be6a2ab4218bd45c5e44c5bb368e331d4b323b906b25354baa444c',
    'round4_capture_children.py': 'e6bca98d53ce502a4115a6220a2aa78b27b3ab9ee1383c30165c274aaabb1f07',
    'run_round4_browser_proof.py': 'f550d2e70238c9ff5527a4316833b83a38cdcf519273ed4b366491a936961fab',
    'run_round4_remaining8.py': '4cc69399da225c755833ab8c35972e2a1845eec45198cad29488994ff870c5d8',
}
CACHES = [ROOT / 'packages/client/node_modules' / n for n in ('.vite', '.vite-temp')]
DECODER = Path('/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10')
DECODER_SITE = Path('/Users/andreyyurlov/.cache/uv/archive-v0/a88MR2jSm399x3XK/lib/python3.10/site-packages')


def file_binding(path):
    logical = Path(path).absolute()
    real = logical.resolve(strict=True)
    data, digest = snapshot(real, 512 * 1024 * 1024)
    return {'path': str(logical), 'realpath': str(real), 'bytes': len(data), 'sha256': digest}


def tree_binding(path, *, exclude=()):
    path = canonical(path)
    h = hashlib.sha256()
    total = count = 0
    if path.exists():
        for base, dirs, files in os.walk(path, followlinks=False):
            dirs[:] = sorted(d for d in dirs if Path(base) / d not in exclude and d != '__pycache__')
            for name in sorted(dirs + files):
                p = Path(base) / name
                if p in exclude or name == '__pycache__':
                    continue
                s = p.lstat()
                if stat.S_ISLNK(s.st_mode):
                    row = [str(p.relative_to(path)), 'link', os.readlink(p), str(p.resolve(strict=True))]
                elif stat.S_ISREG(s.st_mode):
                    binding = file_binding(p)
                    row = [str(p.relative_to(path)), 'file', binding['bytes'], binding['sha256']]
                    total += binding['bytes']
                    count += 1
                elif stat.S_ISDIR(s.st_mode):
                    row = [str(p.relative_to(path)), 'dir']
                else:
                    raise ValueError(f'Unsupported dependency entry {p}')
                h.update(json.dumps(row, separators=(',', ':')).encode() + b'\n')
    return {'path': str(path), 'sha256': h.hexdigest(), 'bytes': total, 'files': count, 'exists': path.exists()}


def self_kernel():
    require(sys.platform == 'darwin' and __debug__ and sys.flags.optimize == 0, 'Unoptimized macOS Python required')
    lib = ctypes.CDLL('/usr/lib/libproc.dylib')
    buf = ctypes.create_string_buffer(4096)
    size = lib.proc_pidpath(os.getpid(), buf, len(buf))
    require(size > 0, 'Cannot observe own kernel executable')
    return file_binding(os.fsdecode(buf.value))


def ignored_inventory(root=ROOT):
    paths = git(root, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z').split(b'\0')
    prefixes = [os.fsencode(str(p.relative_to(root))) + b'/' for p in CACHES if p.is_relative_to(root)]
    return b'\0'.join(p for p in paths if p and not any(p.startswith(prefix) for prefix in prefixes))


def cache_owners():
    commands = subprocess.run(['/bin/ps', '-axo', 'pid=,command='], capture_output=True, timeout=5, check=True).stdout
    conflicts = [line.decode(errors='replace') for line in commands.splitlines()
                 if str(ROOT).encode() in line and any(v in line for v in (b'vite', b'esbuild'))
                 and str(HERE).encode() not in line]
    opened = []
    for cache in CACHES:
        canonical(cache)
        if cache.exists():
            result = subprocess.run(['/usr/sbin/lsof', '-nP', '+D', str(cache)], capture_output=True, timeout=10)
            require(result.returncode in (0, 1), f'Cache owner probe failed: {result.stderr!r}')
            if result.stdout:
                opened.append({'path': str(cache), 'stdout': result.stdout.decode(errors='replace'), 'stderr': result.stderr.decode(errors='replace')})
    require(not conflicts and not opened, f'Cache owners present: {conflicts!r} {opened!r}')
    return {'conflictingTaskLocalViteOwners': conflicts, 'openCacheOwners': opened, 'paths': [str(p) for p in CACHES]}


def discover():
    node = str(Path(shutil.which('node')).resolve(strict=True))
    resolver = subprocess.run([node, str(HERE / 'resolve.mjs')], cwd=ROOT, capture_output=True, timeout=10, check=True)
    routes = json.loads(resolver.stdout)
    python = file_binding(sys.executable)
    kernel = self_kernel()
    files = [HELPERS / n for n in HELPER_HASHES] + [ROOT / 'pnpm-lock.yaml', ROOT / 'package.json', Path(node), DECODER, Path('/usr/bin/caffeinate')]
    files += [HERE / n for n in ('caller.py', 'boundary.py', 'bindings.py', 'native.py', 'entry.mjs', 'fixture.mjs', 'inspect_packet.py', 'resolve.mjs', 'inventory.json')]
    files += [Path(routes[n]) for n in ('tsxApi', 'playwright', 'esbuild', 'browserBinary')]
    bindings = [file_binding(p) for p in files]
    for name, digest in HELPER_HASHES.items():
        require(file_binding(HELPERS / name)['sha256'] == digest, f'Helper differs: {name}')
    source = hashlib.sha256()
    for item in sorted(git(ROOT, 'ls-files', '-z').split(b'\0')):
        if not item:
            continue
        rel = os.fsdecode(item)
        if rel.startswith(str(HERE.relative_to(ROOT)) + '/'):
            continue
        p = ROOT / rel
        require(p.exists(), f'Tracked source absent: {p}')
        b = file_binding(p)
        source.update(item + b'\0' + b['sha256'].encode() + b'\n')
    trees = [tree_binding(ROOT / 'node_modules', exclude=tuple(CACHES)), tree_binding(Path(routes['browserBinary']).parent), tree_binding(DECODER_SITE / 'PIL')]
    # The actual Python kernel executable can differ from its command-line launcher.
    process = {b['realpath']: b['sha256'] for b in bindings if b['realpath'] in (node, routes['esbuild'], routes['browserBinary'], '/usr/bin/caffeinate')}
    process[python['realpath']] = python['sha256']
    process[kernel['realpath']] = kernel['sha256']
    browser_dir = Path(routes['browserBinary']).parent
    for p in browser_dir.rglob('*'):
        if p.is_file() and os.access(p, os.X_OK) and not p.is_symlink():
            process[str(p)] = file_binding(p)['sha256']
    return {'version': 1, 'root': str(ROOT), 'reviewedSource': '05909e4f74d1c6acf64a5be110f3e44af18b7bc5',
            'branch': git(ROOT, 'branch', '--show-current').decode().strip(), 'bindings': bindings, 'trees': trees,
            'sourceDigest': source.hexdigest(), 'python': python, 'pythonKernel': kernel,
            'node': node, **routes, 'decoderPython': str(DECODER), 'decoderSite': str(DECODER_SITE),
            'process_binary_sha256': process, 'browser_binary': routes['browserBinary'],
            'path': os.environ['PATH'], 'generatedCaches': [str(p) for p in CACHES],
            'ignoredInventorySha256': hashlib.sha256(ignored_inventory()).hexdigest()}


def verify(ready):
    actual = discover()
    require(actual == ready['bindings'], 'Source/dependency/launcher/kernel binding drift')
    return cache_owners()
