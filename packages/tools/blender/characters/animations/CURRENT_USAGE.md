# Current saved-animation validation usage

`README.md` is retained historical documentation. The current exporter requires
`--report-dir`, and that directory must **not exist**. Existing directories,
including empty directories and old receipt directories, are refused. Create a
unique parent and pass a new child; the directory returned by `mktemp -d` itself
is not a valid receipt destination.

From the worktree root, this validates the saved 42 actions and runs the ten
export-boundary negative controls. It does not author, export, render or bake.
It starts one factory-background Blender process with two threads, a 300-second
wall/CPU limit, a 64 MiB per-file limit and an 8 GiB sampled RSS stop threshold.
The RSS threshold is checked every half second; it is not an OS memory quota.

```sh
/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B - <<'PY'
import os, pathlib, resource, signal, subprocess, tempfile, time
parent = pathlib.Path(tempfile.mkdtemp(prefix='t02-library-', dir='/tmp'))
receipts = parent / 'receipts'
assert not receipts.exists()
argv = ['/Applications/Blender.app/Contents/MacOS/Blender', '-b', '-t', '2',
        '--factory-startup', '--disable-autoexec', '--python-exit-code', '1',
        '-P', 'packages/tools/blender/characters/animations/export_saved.py', '--',
        '--validate-only', '--selftest', '--report-dir', str(receipts)]
env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
for name in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
             'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS']:
    env[name] = '2'
def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (300, 300))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64*1024**2, 64*1024**2))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
with (parent / 'blender.txt').open('x') as log:
    started = time.monotonic()
    child = subprocess.Popen(argv, env=env, stdout=log, stderr=subprocess.STDOUT,
                             start_new_session=True, preexec_fn=limits)
    while child.poll() is None:
        sample = subprocess.run(['/bin/ps', '-p', str(child.pid), '-o', 'rss='],
                                capture_output=True, text=True, timeout=3)
        if time.monotonic()-started > 300 or int(sample.stdout.strip() or '0')*1024 > 8*1024**3:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=10)
            raise RuntimeError(f'CPU validation limit exceeded; preserve {parent}')
        time.sleep(.5)
    assert child.wait() == 0, f'Validation failed; preserve {parent}'
print(parent)
PY
```

For source validation without negative controls, omit only `--selftest`; still
pass `--validate-only --report-dir <new-child>`. Neither command is a successful
export command. Preserve the new receipt directory on success or failure.

The actual-library tests use a different fresh output parent:

```sh
task_proof_parent="$(mktemp -d /tmp/t02-library-proof-XXXXXX)"
ANIMATION_PROOF_PATH="$task_proof_parent/animation-proof.json" \
SHARED_RIG_PROOF_PATH="$task_proof_parent/shared-rig-proof.json" \
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 \
pnpm exec vitest run packages/client/src/characters/animationLibrary.test.js \
  packages/client/src/characters/sharedRig.test.js --maxWorkers=1 --no-file-parallelism
```

These 28 tests cover 126 clip/people pairs using the existing CPU geometry loader.
They do not establish rendered appearance, native media qualification or capture
authorization. The disabled Thalune candidate and its current integration report
are under `thalune-run-candidate/revision-03/`.
