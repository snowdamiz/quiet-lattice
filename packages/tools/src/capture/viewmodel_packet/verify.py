"""Sequential source/CPU checks only. Every run needs a fresh owned evidence directory."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
DECODER = '/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10'
SITE = '/Users/andreyyurlov/.cache/uv/archive-v0/a88MR2jSm399x3XK/lib/python3.10/site-packages'


def run(evidence, name, argv, env, timeout=180):
    log = evidence / (name + '.log')
    start = time.monotonic()
    with log.open('xb') as stream:
        result = subprocess.run(argv, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
    row = {'name': name, 'argv': argv, 'cwd': str(ROOT), 'exit': result.returncode,
           'seconds': time.monotonic() - start, 'log': str(log.relative_to(ROOT)),
           'logSha256': hashlib.sha256(log.read_bytes()).hexdigest()}
    with (evidence / 'commands.jsonl').open('a') as stream: stream.write(json.dumps(row) + '\n')
    print(f"{name}: exit {result.returncode}", flush=True)
    return result.returncode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('evidence', type=Path)
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    assert evidence.is_relative_to(HERE / 'evidence') and evidence.is_dir() and not any(evidence.iterdir())
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2', 'VECLIB_MAXIMUM_THREADS': '2'}
    commands = [
        ('python-boundary', [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(HERE), '-p', 'test_boundary.py', '-v'], env),
        ('python-helper', [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(HERE), '-p', 'test_native.py', '-v'], env),
        ('python-inspector', [DECODER, '-B', '-m', 'unittest', 'discover', '-s', str(HERE), '-p', 'test_inspect.py', '-v'], {**env, 'PYTHONPATH': SITE}),
        ('node-boundary', ['node', '--test', '--test-concurrency=2', str(HERE / 'entry.test.mjs'), str(HERE / 'fixture.test.mjs')], env),
        ('typecheck', ['pnpm', 'typecheck'], env),
        ('lint', ['pnpm', 'exec', 'eslint', *[str(p) for p in sorted(HERE.glob('*.mjs'))]], env),
        ('format', ['pnpm', 'exec', 'prettier', '--check', *[str(p) for p in sorted(HERE.glob('*.mjs'))], str(HERE / 'inventory.json')], env),
        ('focused-units', ['pnpm', 'exec', 'vitest', 'run', 'packages/client/src/entities', 'packages/client/src/exosuit.test.js', 'packages/client/src/Game.test.js', '--maxWorkers=2', '--no-file-parallelism', '--no-cache'], env),
        ('diff-check', ['git', 'diff', '--check', '05909e4f74d1c6acf64a5be110f3e44af18b7bc5'], env),
    ]
    failures = [name for name, argv, command_env in commands if run(evidence, name, argv, command_env)]
    syntax = []
    for path in sorted(HERE.glob('*.py')):
        ast.parse(path.read_text(), filename=str(path)); syntax.append(path.name)
    (evidence / 'syntax.json').write_text(json.dumps({'status': 'PASS', 'files': syntax}, indent=2) + '\n')
    print(json.dumps({'status': 'FAIL' if failures else 'PASS', 'failures': failures, 'nativeJobs': 0}))
    return bool(failures)


if __name__ == '__main__': sys.exit(main())
