"""Pure byte bindings and strict single-pilot source/grant admission."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from contract import ASSET, ASSET_HEAD, FILE, PURPOSE, ROOT, ledger, plan, require, sha, snapshot


def file_binding(path):
    p = Path(path)
    return {'path': str(p), 'realpath': str(p.resolve(strict=True)), 'bytes': p.stat().st_size, 'sha256': sha(p)}


def tree_binding(root):
    """Hash dependency files and symlink routes without following workspace directory links."""
    base, digest, count, size = Path(root), hashlib.sha256(), 0, 0
    require(base.is_dir(), 'Dependency tree absent: ' + str(base))
    for directory, dirs, files in os.walk(base, followlinks=False):
        dirs[:] = [d for d in dirs if d not in ('.vite', '.vite-temp')]
        for name in sorted(dirs + files):
            p = Path(directory) / name
            if p.is_symlink():
                record = ['link', str(p.relative_to(base)), os.readlink(p)]
            elif p.is_file():
                n = p.stat().st_size
                record = ['file', str(p.relative_to(base)), n, sha(p)]
                size += n
            else:
                continue
            digest.update((json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n').encode())
            count += 1
        dirs.sort()
    return {'path': str(base), 'sha256': digest.hexdigest(), 'entries': count, 'bytes': size}


def git(root, *args):
    return subprocess.check_output(['/usr/bin/git', *args], cwd=root, timeout=20).decode().strip()


def source(ready):
    root = Path(ready['root'])
    require(root == ROOT and root.resolve() == root, 'Wrong actual checkout')
    require(git(root, 'branch', '--show-current') == 'task/P1-E07-T14-effects', 'Wrong branch')
    require(not git(root, 'status', '--porcelain', '--untracked-files=all'), 'Strict clean source HEAD required; no predecessor-artifact exemption')
    require(not git(root, 'diff', ASSET_HEAD, '--', *ready['assetSourcePaths']), 'Reviewed source assets changed')
    return {'head': git(root, 'rev-parse', 'HEAD'), 'tree': git(root, 'rev-parse', 'HEAD^{tree}'), 'clean': True}


def verify(ready):
    require(ready['root'] == str(ROOT) and ready['uid'] == os.getuid(), 'Root/UID drift')
    require(str(Path(sys.executable).resolve()) == ready['python'], 'Python launcher drift')
    require(os.environ.get('PATH') == ready['path'], 'PATH drift')
    require(all(not os.environ.get(k) for k in ('NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'ESBUILD_BINARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH')), 'Runtime override environment refused')
    for row in ready['bindings']:
        require(file_binding(row['path']) == row, 'Source/dependency bytes drift: ' + row['path'])
    for row in ready['dependencyTrees']:
        require(tree_binding(row['path']) == row, 'Dependency tree drift: ' + row['path'])
    for kind in ('launcher', 'kernelExecutable'):
        row = ready['pythonRuntime'][kind]
        require(row in ready['bindings'] and ready['process_binary_sha256'].get(row['path']) == row['sha256'], 'Python process binding missing')
    return source(ready)


def fresh(path):
    p = Path(path)
    require(p.is_absolute() and p.resolve() == p and not p.exists() and not p.is_symlink(), 'Not a fresh canonical path: ' + str(p))
    parent = p.parent
    while not parent.exists():
        parent = parent.parent
    info = parent.stat()
    private_tmp = parent == Path('/private/tmp') and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o1777
    require(parent.resolve() == parent and (info.st_uid == os.getuid() or private_tmp), 'Unowned/noncanonical parent')


def admit(ready_snapshot, grant_snapshot, current, authorization, now=None):
    r, g = ready_snapshot['value'], grant_snapshot['value']
    p = r['pilot']
    require(r['runtimeEnabled'] is True, 'Readiness disabled')
    require(r['budget'] == ledger() and p['files'] == plan(), 'Exact pilot budget/inventory required')
    require(p['file'] == FILE and p['asset'] == ASSET and p['viewport'] == [1920, 1080] and p['gl'] == 'metal', 'Pilot scope mismatch')
    require(g.get('purpose') == PURPOSE and g.get('oneUse') is True and g.get('nativeReservesAccepted') is True, 'Explicit one-use native reserve grant required')
    require(g.get('authorizationId') == authorization == p['authorizationId'], 'Authorization identity mismatch')
    require(g.get('readinessSha256') == ready_snapshot['sha256'] and g.get('pilot') == p, 'Grant/readiness scope mismatch')
    require(g.get('source') == current and current.get('clean') is True, 'Grant must bind the latest clean source head/tree')
    require(g.get('assetHead') == ASSET_HEAD, 'Reviewed asset head mismatch')
    expiry = datetime.datetime.fromisoformat(g['expiresAt'])
    require(expiry.tzinfo is not None and (now or datetime.datetime.now(datetime.timezone.utc)) < expiry, 'Grant expired')
    # Read once: hash and PASS semantics share the same bounded snapshot, never sha(path)+reopen.
    review = snapshot(g['callerReview']['path'])
    require(review['sha256'] == g['callerReview']['sha256'], 'Caller review receipt hash mismatch')
    value = review['value']
    require(value.get('verdict') == 'PASS' and value.get('source') == current and value.get('scope') == 'INDEPENDENT_EFFECTS_PILOT_CALLER_REVIEW', 'Fresh independent caller review required')
    for name in ('output', 'evidence', 'consumption'):
        fresh(p[name])
    require(Path(p['output']).parent == ROOT / 'assets/renders', 'Output must be the single designated effects root')
    require(Path(p['evidence']).parent == Path('/private/tmp') and Path(p['consumption']).parent == Path('/private/tmp'), 'Pilot evidence/consumption location')
    require(str(grant_snapshot['path']) == p['grant'], 'Wrong grant path')
    return {'ready': ready_snapshot, 'grant': grant_snapshot, 'review': review, 'source': current}
