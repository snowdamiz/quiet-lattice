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


VT_ENCODER = '/System/Library/Frameworks/VideoToolbox.framework/Versions/A/XPCServices/VTEncoderXPCService.xpc/Contents/MacOS/VTEncoderXPCService'
VT_ENCODER_SHA256 = 'a3af9d8f1d6423de4d6303c323f5132122181e01367155d325fc9bde3ed872b5'
VT_ENCODER_REQUIREMENT = 'identifier "com.apple.coremedia.videoencoder" and anchor apple'


def apple_encoder_binding():
    """Bind the exact Apple file; StageReceipts still proves current ownership."""
    path = canonical(VT_ENCODER)
    protected = []
    for item in (path, *path.parents):
        info = item.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'Apple encoder route must be root-owned and non-writable')
        require(stat.S_ISREG(info.st_mode) if item == path else stat.S_ISDIR(info.st_mode), 'Apple encoder route type')
        protected.append({'path': str(item), 'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid, 'mode': stat.S_IMODE(info.st_mode)})
    before = file_binding(path)
    require(before['sha256'] == VT_ENCODER_SHA256 and before['bytes'] == 167280, 'Unexpected Apple encoder bytes')
    codesign = file_binding('/usr/bin/codesign')
    observations = []
    for options in (['--verify', '--strict', '-R', '=' + VT_ENCODER_REQUIREMENT], ['-d', '--verbose=4', '-r-']):
        argv = ['/usr/bin/codesign', *options, str(path)]
        result = subprocess.run(argv, capture_output=True, timeout=5)
        require(len(result.stdout) + len(result.stderr) <= 65536, 'Encoder signature output ceiling')
        observations.append({'argv': argv, 'exit': result.returncode, 'stdout': result.stdout.decode('utf-8', 'strict'), 'stderr': result.stderr.decode('utf-8', 'strict')})
        require(result.returncode == 0, 'Apple encoder signature rejected')
    lines = (observations[-1]['stdout'] + observations[-1]['stderr']).splitlines()
    fields = dict(line.split('=', 1) for line in lines if '=' in line)
    require(fields.get('Identifier') == 'com.apple.coremedia.videoencoder' and fields.get('Platform identifier') == '26', 'Apple encoder platform identity')
    require('designated => ' + VT_ENCODER_REQUIREMENT in lines and len(fields.get('CDHash', '')) == 40, 'Apple encoder designated signature')
    require(file_binding(path) == before and file_binding('/usr/bin/codesign') == codesign, 'Encoder/signature tool changed during verification')
    for row in protected:
        info = Path(row['path']).lstat()
        require((info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode)) == (row['device'], row['inode'], row['uid'], row['mode']), 'Apple encoder route changed')
    return {'executable': before, 'codesign': codesign, 'protectedRoute': protected, 'requirement': VT_ENCODER_REQUIREMENT,
            'signature': fields, 'observations': observations,
            'scope': 'Exact owned-cohort executable only; current UID/birth/coalition/executable checks remain mandatory. External XPC ownership unqualified.'}


MTL_COMPILER = '/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/MTLCompilerService.xpc/Contents/MacOS/MTLCompilerService'
MTL_COMPILER_SHA256 = '65af927ce641351e604bf36da7a664e5350d583483c7e5f3fe799e0d0db7a78b'
MTL_COMPILER_REQUIREMENT = 'identifier "com.apple.MTLCompilerService" and anchor apple'


def apple_mtl_compiler_binding():
    """Bind one exact Metal compiler file; ownership remains StageReceipts' job."""
    path = canonical(MTL_COMPILER)
    protected = []
    for item in (path, *path.parents):
        info = item.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'Apple Metal compiler route must be root-owned and non-writable')
        require(stat.S_ISREG(info.st_mode) if item == path else stat.S_ISDIR(info.st_mode), 'Apple Metal compiler route type')
        protected.append({'path': str(item), 'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid, 'mode': stat.S_IMODE(info.st_mode)})
    before = file_binding(path)
    require(before['sha256'] == MTL_COMPILER_SHA256 and before['bytes'] == 389760, 'Unexpected Apple Metal compiler bytes')
    codesign = file_binding('/usr/bin/codesign')
    observations = []
    for options in (['--verify', '--strict', '-R', '=' + MTL_COMPILER_REQUIREMENT], ['-d', '--verbose=4', '-r-']):
        argv = ['/usr/bin/codesign', *options, str(path)]
        result = subprocess.run(argv, capture_output=True, timeout=5)
        require(len(result.stdout) + len(result.stderr) <= 65536, 'Metal compiler signature output ceiling')
        observations.append({'argv': argv, 'exit': result.returncode, 'stdout': result.stdout.decode('utf-8', 'strict'), 'stderr': result.stderr.decode('utf-8', 'strict')})
        require(result.returncode == 0, 'Apple Metal compiler signature rejected')
    lines = (observations[-1]['stdout'] + observations[-1]['stderr']).splitlines()
    fields = dict(line.split('=', 1) for line in lines if '=' in line)
    require(fields.get('Identifier') == 'com.apple.MTLCompilerService' and fields.get('Platform identifier') == '26', 'Apple Metal compiler platform identity')
    require('designated => ' + MTL_COMPILER_REQUIREMENT in lines and len(fields.get('CDHash', '')) == 40, 'Apple Metal compiler designated signature')
    require(file_binding(path) == before and file_binding('/usr/bin/codesign') == codesign, 'Metal compiler/signature tool changed during verification')
    for row in protected:
        info = Path(row['path']).lstat()
        require((info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode)) == (row['device'], row['inode'], row['uid'], row['mode']), 'Apple Metal compiler route changed')
    return {'executable': before, 'codesign': codesign, 'protectedRoute': protected, 'requirement': MTL_COMPILER_REQUIREMENT,
            'signature': fields, 'observations': observations,
            'scope': 'Exact owned-cohort executable only; current UID/birth/coalition/executable checks remain mandatory. External XPC ownership unqualified.'}


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
    encoder = apple_encoder_binding()
    metal_compiler = apple_mtl_compiler_binding()
    python = file_binding(sys.executable)
    kernel = self_kernel()
    files = [HELPERS / n for n in HELPER_HASHES] + [ROOT / 'pnpm-lock.yaml', ROOT / 'package.json', Path(node), DECODER, Path('/usr/bin/caffeinate'), Path(VT_ENCODER), Path(MTL_COMPILER), Path('/usr/bin/codesign')]
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
    process[VT_ENCODER] = encoder['executable']['sha256']
    process[MTL_COMPILER] = metal_compiler['executable']['sha256']
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
            'process_binary_sha256': process, 'appleEncoder': encoder, 'appleMetalCompiler': metal_compiler, 'browser_binary': routes['browserBinary'],
            'path': os.environ['PATH'], 'generatedCaches': [str(p) for p in CACHES],
            'ignoredInventorySha256': hashlib.sha256(ignored_inventory()).hexdigest()}


def verify(ready):
    actual = discover()
    require(actual == ready['bindings'], 'Source/dependency/launcher/kernel binding drift')
    return cache_owners()
