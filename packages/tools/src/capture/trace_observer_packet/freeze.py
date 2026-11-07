"""CPU-only exact source/binary/dependency binding. Outputs are external and disabled."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
sys.dont_write_bytecode = True
from metadata import Refused, atomic, digest, encode, file_hash, snapshot, admit, inventory, ReadBudget, Directory, mkdir, copy_file, io_deadline

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
GIT = str(Path('/opt/homebrew/bin/git').resolve(strict=True))
NODE = '/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node'
PURPOSE = 'P1.E14.T13/unchanged-reference-trace-observer-v1'
BOUNDS = {'preparations': 12, 'warmUpFrames': 7200, 'frames': 10, 'dependentPasses': 48,
          'preflightFences': 36, 'controlFences': 24, 'png': 0, 'queries': 0, 'segments': 6,
          'traceBytes': 67108864, 'events': 250000, 'reads': 1024,
          'captureMs': 1009100, 'drainMs': 306100, 'terminalMs': 1315200}
LIMITS = {'sourceFiles': 6000, 'sourceBytes': 256 * 1024**2, 'dependencyFiles': 30000,
          'dependencyBytes': 512 * 1024**2, 'outputFiles': 20000, 'outputBytes': 512 * 1024**2,
          'profileFiles': 20000, 'profileBytes': 512 * 1024**2, 'logBytes': 256 * 1024**2,
          'minimumFreeBytes': 8 * 1024**3, 'metadataBytes': 16 * 1024**2,
          'frozenFiles': 40000, 'frozenBytes': 768 * 1024**2}


def git(root, *args):
    return subprocess.check_output([GIT, '-C', str(root), *args], timeout=15).decode().strip()


def clean(root, head):
    if git(root, 'rev-parse', 'HEAD') != head or git(root, 'status', '--porcelain=v1', '--untracked-files=all'):
        raise Refused('Exact HEAD and fully clean worktree required')


def capacity(path):
    info = os.statvfs(path)
    return {'at': time.time(), 'path': str(path), 'availableBytes': info.f_bavail * info.f_frsize,
            'minimumFreeBytes': LIMITS['minimumFreeBytes'], 'quotaGuaranteed': False}


def bind_file(path, cap=512 * 1024**2, *, system=False):
    path = Path(path)
    owners = (os.getuid(), 0) if system else (os.getuid(),)
    admitted = admit(path, cap, owners=owners)['stamp']
    return {'path': str(path), 'sha256': file_hash(path, cap, expected_stamp=admitted, owners=owners), 'bytes': admitted[4]}


def source_paths(root):
    paths = git(root, 'ls-files', '-z').split('\0')
    return sorted(p for p in paths if p and (
        p in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json') or
        p.startswith(('packages/tools/src/', 'packages/shared/src/', 'packages/client/src/')) or
        p in ('packages/tools/package.json', 'packages/client/package.json', 'packages/shared/package.json', 'packages/server/package.json',
              'packages/client/index.html', 'packages/client/vite.config.js', 'packages/client/tsconfig.json') or
        p.startswith(('packages/client/public/basis/', 'packages/client/public/audio/')) or
        p in tuple('packages/client/public/models/' + name + '.glb' for name in ('ship', 'flora', 'creatures', 'structures', 'multitool')) or
        p.startswith('assets/blend/stations/_authoring/') and p.endswith(('round4_job_boundary.py',
            'round4_capture_children.py', 'run_round4_browser_proof.py', 'run_round4_remaining8.py'))))


DEPENDENCY_ROOTS = ['node_modules', 'packages/tools/node_modules', 'packages/client/node_modules', 'packages/shared/node_modules']


def dependency_rows(root, *, hash_content=True):
    rows, size, entries = [], 0, 0
    for relative in DEPENDENCY_ROOTS:
        admitted = inventory(root / relative, count=LIMITS['dependencyFiles'] - entries,
                             cap=LIMITS['dependencyBytes'] - size, live=True)
        entries += admitted['count']
        size += admitted['bytes']
        for record in admitted['files']:
            name = str(Path(relative) / record['path'])
            path = root / name
            if record['kind'] == 'symlink-not-followed':
                target = Path(os.path.normpath(path.parent / record['link']))
                if not target.is_relative_to(root):
                    raise Refused('External dependency link')
                rows.append({'relative': name, 'link': record['link'], 'target': str(target), 'stamp': record['stamp']})
            elif record['kind'] == 'file':
                rows.append({'path': str(path), 'relative': name, 'bytes': record['bytes'], 'stamp': record['stamp']})
            elif record['kind'] != 'directory':
                raise Refused('Dependency entry type')
    # All four inventories/counts/sizes are admitted before the first content read.
    budget = ReadBudget(LIMITS['dependencyBytes'])
    if hash_content:
        for row in rows:
            if 'bytes' in row:
                row['sha256'] = file_hash(row['path'], LIMITS['dependencyBytes'], expected_stamp=row['stamp'], budget=budget)
    return sorted(rows, key=lambda row: row['relative'])


def content_rows(rows):
    return [{key: value for key, value in row.items() if key != 'stamp'} for row in rows]



def make_freeze(root, destination, binding, *, dependencies=True):
    with io_deadline(120):
        return _make_freeze(root, destination, binding, dependencies=dependencies)


def _make_freeze(root, destination, binding, *, dependencies=True):
    root, destination = Path(root), Path(destination)
    with Directory(root):
        pass
    head = git(root, 'rev-parse', 'HEAD')
    clean(root, head)
    if destination.exists() or destination.is_symlink() or destination.is_relative_to(root) or destination.parent.resolve() != destination.parent:
        raise Refused('Freeze must be fresh external canonical path')
    available = capacity(destination.parent)
    if available['availableBytes'] < LIMITS['minimumFreeBytes']:
        raise Refused('Current capacity insufficient', available)
    sources, total = [], 0
    for relative in source_paths(root):
        admitted = admit(root / relative, LIMITS['sourceBytes'])['stamp']
        row = {'path': str(root / relative), 'bytes': admitted[4], 'stamp': admitted}
        total += row['bytes']
        if len(sources) >= LIMITS['sourceFiles'] or total > LIMITS['sourceBytes']:
            raise Refused('Source ledger ceiling')
        sources.append({**row, 'relative': relative})
    if not sources:
        raise Refused('Source closure absent')
    deps = dependency_rows(root, hash_content=False) if dependencies else []
    source_budget, dependency_budget = ReadBudget(LIMITS['sourceBytes']), ReadBudget(LIMITS['dependencyBytes'])
    for row in sources:
        row['sha256'] = file_hash(row['path'], LIMITS['sourceBytes'], expected_stamp=row['stamp'], budget=source_budget)
    for row in deps:
        if 'bytes' in row:
            row['sha256'] = file_hash(row['path'], LIMITS['dependencyBytes'], expected_stamp=row['stamp'], budget=dependency_budget)
    for row in binding['binaries']:
        if bind_file(row['path'], system=True)['sha256'] != row['sha256']:
            raise Refused('Binary binding changed')
    asset = bind_file(binding['assetPath'], 64 * 1024**2)
    if asset['sha256'] != 'dc54adf60dfbb4275fe355695d960de284357336c4e962be82fb960f00741c27':
        raise Refused('Exact existing Thalune asset required; no hydration')
    for path in (binding['output'], binding['fallback'], binding['consumption'], binding['grant']):
        p = Path(path)
        if p.exists() or p.is_symlink() or p.parent.resolve() != p.parent or p.is_relative_to(root):
            raise Refused('Prospective path occupied/noncanonical/in worktree: ' + path)
    mkdir(destination)
    copy = destination / 'source'
    mkdir(copy)
    source_budget = ReadBudget(LIMITS['sourceBytes'])
    dependency_budget = ReadBudget(LIMITS['dependencyBytes'])
    for row in sources:
        copied_hash = copy_file(row['path'], copy / row['relative'], row, source_budget)
        if copied_hash != row['sha256']:
            raise Refused('Source copy mismatch')
    for relative in DEPENDENCY_ROOTS if dependencies else []:
        with Directory(copy / relative, create=True):
            pass
    for row in deps:
        target = copy / row['relative']
        if 'link' in row:
            with Directory(target.parent, create=True) as parent:
                os.symlink(row['link'], target.name, dir_fd=parent.fd)
                parent.verify()
        elif copy_file(row['path'], target, row, dependency_budget) != row['sha256']:
            raise Refused('Dependency copy differs')
    if dependencies:
        copied_deps = content_rows(dependency_rows(copy))
        expected_deps = json.loads(json.dumps(content_rows(deps)).replace(str(root) + '/', str(copy) + '/'))
        if copied_deps != expected_deps:
            raise Refused('Dependency copy ledger differs')
    clean(root, head)
    ready = {'kind': 'T13_OBSERVER_LOCAL_BINDING_V1', 'purpose': PURPOSE, 'runtimeAuthorized': False,
             'head': head, 'tree': git(root, 'rev-parse', 'HEAD^{tree}'), 'root': str(root),
             'frozenRoot': str(copy), 'bounds': BOUNDS, 'limits': LIMITS, 'binding': binding,
             'sources': sources, 'dependencies': deps, 'asset': asset, 'capacityAtFreeze': available,
             'planSha256': digest(encode(BOUNDS)), 'historical': {'cloud03': 'FAILED', 'accepted': False}}
    atomic(destination / 'readiness.json', encode(ready))
    return ready


def verify_freeze(ready):
    with io_deadline(120):
        return _verify_freeze(ready)


def _verify_freeze(ready):
    root = Path(ready['root'])
    if not any(r['path'] == GIT and bind_file(GIT, 64 * 1024**2, system=True)['sha256'] == r['sha256'] for r in ready['binding']['binaries']):
        raise Refused('Actual Git executable is not bound')
    clean(root, ready['head'])
    if (git(root, 'rev-parse', 'HEAD^{tree}') != ready['tree'] or encode(ready['bounds']) != encode(BOUNDS) or
        encode(ready['limits']) != encode(LIMITS) or ready['planSha256'] != digest(encode(BOUNDS))):
        raise Refused('Frozen plan/tree/ceilings changed')
    if source_paths(root) != [r['relative'] for r in ready['sources']]:
        raise Refused('Source inventory incomplete or reordered')
    for row in ready['sources']:
        for path in [root / row['relative'], Path(ready['frozenRoot']) / row['relative']]:
            if file_hash(path, LIMITS['sourceBytes']) != row['sha256']:
                raise Refused('Source changed: ' + str(path))
    frozen = Path(ready['frozenRoot'])
    all_files = inventory(frozen, count=LIMITS['frozenFiles'], cap=LIMITS['frozenBytes'], live=True)
    observed = []
    for row in all_files['files']:
        relative = row['path']
        if any(relative == base or relative.startswith(base + '/') for base in DEPENDENCY_ROOTS):
            continue
        if row['kind'] not in ('file', 'directory'):
            raise Refused('Frozen source link/type differs')
        if row['kind'] == 'file':
            observed.append(relative)
    if sorted(observed) != source_paths(root):
        raise Refused('Frozen source file ledger differs')
    if dependency_rows(root) != ready['dependencies'] or content_rows(dependency_rows(frozen)) != json.loads(json.dumps(content_rows(ready['dependencies'])).replace(str(root) + '/', str(frozen) + '/')):
        raise Refused('Dependencies changed')
    for row in ready['binding']['binaries']:
        if bind_file(row['path'], system=True)['sha256'] != row['sha256']:
            raise Refused('Bound input changed')
    if bind_file(ready['asset']['path'], 64 * 1024**2)['sha256'] != ready['asset']['sha256']:
        raise Refused('Bound asset changed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--binding', required=True)
    parser.add_argument('--binding-sha256', required=True)
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    binding = snapshot(args.binding, args.binding_sha256)['value']
    make_freeze(ROOT, args.destination, binding)
