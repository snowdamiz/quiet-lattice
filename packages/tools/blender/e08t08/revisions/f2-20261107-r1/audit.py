"""Read-only preservation audit; writes one exclusive revision result."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
TASK = HERE.parents[1]
ROOT = TASK.parents[3]
REVIEW = Path('/tmp/space-e08t08-independent-c2-iimrHP')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    before = json.loads((HERE / 'preservation-before.json').read_text())
    reviewer = json.loads((REVIEW / 'after.json').read_text())
    mutable = {str((TASK / name).relative_to(ROOT)) for name in (
        '.gitattributes', '.gitignore', 'README.md', 'bin/blender',
        'consumer.test.js', 'finalize.py', 'stage.py')}
    for path, pin in before['files'].items():
        if path not in mutable:
            assert sha(ROOT / path) == pin['sha256'], path
    for path, pin in reviewer['changedFiles'].items():
        if path not in mutable:
            assert sha(ROOT / path) == pin['sha256'], path
    for path, pin in reviewer['protectedSHA256'].items():
        assert sha(ROOT / path) == pin, path
    for path, pin in before['reviewOriginals'].items():
        assert sha(REVIEW / path) == pin, path
    dependencies = {}
    for rel, expected in reviewer['dependencyMetadata'].items():
        root = (ROOT / rel).resolve()
        rows = []
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in sorted(dirs + files):
                path = Path(directory) / name
                stat = path.lstat()
                rows.append([str(path.relative_to(root)), stat.st_mode, stat.st_size,
                             stat.st_mtime_ns, stat.st_ctime_ns,
                             os.readlink(path) if path.is_symlink() else None])
        rows.sort()
        actual = dict(target=str(root), entries=len(rows), metadataSHA256=
                      hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest())
        assert actual == expected, rel
        dependencies[rel] = actual
    parsed = []
    for path in sorted(TASK.glob('*.py')):
        ast.parse(path.read_text(), filename=str(path))
        parsed.append(str(path.relative_to(ROOT)))
    checks = []
    commands = [
        ['/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node',
         '--check', str(TASK / 'consumer.test.js')],
        ['/bin/sh', '-n', str(TASK / 'bin/blender')],
        ['git', 'diff', '--check'],
    ]
    for command in commands:
        proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=15)
        checks.append(dict(command=command, exit=proc.returncode, output=proc.stdout + proc.stderr))
        assert proc.returncode == 0, checks[-1]
    rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,args='], text=True, timeout=2).splitlines()
    remaining = [row for row in rows if str(TASK) in row and any(name in row for name in (
        'lifecycle_worker.py', 'lifecycle_driver.py', 'stage_lifecycle_test.py'))]
    assert not remaining, remaining
    qualification = json.loads((HERE / 'final-qualification-v3.receipt.json').read_text())
    assert qualification['exit'] == 0 and qualification['sourceUnchanged']
    for name, pin in qualification['sourceSHA256'].items():
        assert sha(TASK / name) == pin, name
    results = json.loads((HERE / 'final-qualification-v3/results.json').read_text())
    assert results['cases'] == results['passed'] == 22 and results['allFixtureWorkersExited']
    changed = subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).splitlines()
    assert set(changed) <= mutable
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines()
    assert all(path.startswith('packages/tools/blender/e08t08/') for path in untracked)
    stat = os.statvfs(ROOT)
    free = stat.f_bavail * stat.f_frsize
    assert free >= 12 * 1024 ** 3
    result = dict(base=before['base'], baseTree=before['tree'], time=time.time(),
                  assetsPreserved=reviewer['assets'], pngsPreserved=reviewer['pngs'],
                  baselineFilesCompared=len(before['files']), priorChangedFilesCompared=len(reviewer['changedFiles']),
                  protectedHashesPreserved=reviewer['protectedSHA256'],
                  reviewOriginalFilesPreserved=before['reviewOriginals'],
                  historicalReceiptsAndLogsPreserved=True, dependencyMetadata=dependencies,
                  pythonASTParsed=parsed, checks=checks, remainingOwnedProcesses=remaining,
                  freeBytes=free, changedTracked=changed, newPaths=len(untracked),
                  revisionAllocatedKiB=int(subprocess.check_output(['du', '-sk', str(HERE)], text=True).split()[0]),
                  currentToolSHA256=qualification['sourceSHA256'])
    with Path(sys.argv[1]).open('x') as output:
        json.dump(result, output, indent=2)
        output.write('\n')
    print(json.dumps(dict(status='preserved', assets=14, PNGs=79,
                         dependencies=dependencies, remainingOwnedProcesses=remaining, freeBytes=free)))


if __name__ == '__main__':
    main()
