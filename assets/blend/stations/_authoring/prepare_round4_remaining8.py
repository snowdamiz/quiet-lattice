"""Freeze the exact remaining-eight caller; never launch a station or create a grant."""
import ast
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import run_round4_remaining8 as caller
from run_round4_browser_proof import PRIVATE_TMP_POLICY

ROOT, BASE, OUT = caller.ROOT, caller.BASE, caller.FREEZE
HERE = Path(__file__).parent


def binding(path):
    path = Path(path)
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


def save(path, value):
    assert not path.exists(), path
    path.write_text(json.dumps(value, indent=2) + '\n')


assert not caller.READY.exists() and not caller.GRANT.exists() and not (OUT / 'consumed_grants').exists()
prior = json.loads((BASE / 'browser_proof_ready04/readiness.json').read_text())
for name, expected in [('round4_job_boundary.py', '3f5ca99841be6a2ab4218bd45c5e44c5bb368e331d4b323b906b25354baa444c'),
                       ('run_round4_browser_proof.py', 'f550d2e70238c9ff5527a4316833b83a38cdcf519273ed4b366491a936961fab'),
                       ('round4_capture_children.py', 'e6bca98d53ce502a4115a6220a2aa78b27b3ab9ee1383c30165c274aaabb1f07')]:
    assert binding(HERE / name)['sha256'] == expected
old = BASE / 'controller_revise01/freeze02/frozen_sources/capture_round4_stage.py'
def function(path):
    return next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'run_plan')
assert ast.dump(function(old)) == ast.dump(function(HERE / 'capture_round4_stage.py'))
for path, expected in prior['input_sha256'].items():
    if path != str(HERE / 'capture_round4_stage.py'): assert binding(path)['sha256'] == expected, path
resolver = json.loads(subprocess.check_output(prior['resolver_argv'], cwd=ROOT, text=True, timeout=5))
assert resolver == prior['resolver'] and resolver['spawnCalls'] == []
save(OUT / 'installed_resolver_cpu.json', resolver)

sources = ['capture_round4_stage.py', 'run_round4_remaining8.py', 'inspect_round4_station_output.py',
           'test_round4_remaining8.py', 'test_round4_station_artifacts.py', 'prepare_round4_remaining8.py']
freeze = OUT / 'frozen_sources'; freeze.mkdir(exist_ok=False)
for name in sources:
    shutil.copy2(HERE / name, freeze / name)
    assert binding(HERE / name)['sha256'] == binding(freeze / name)['sha256']

python310 = Path('/Users/andreyyurlov/.local/share/uv/python/cpython-3.10.22-macos-aarch64-none/bin/python3.10')
site = Path('/Users/andreyyurlov/.cache/uv/archive-v0/a88MR2jSm399x3XK/lib/python3.10/site-packages')
inputs = dict(prior['input_sha256'])
inputs.update({str(HERE / name): binding(HERE / name)['sha256'] for name in sources})
inputs[str(python310)] = binding(python310)['sha256']
# Pin the decoder modules/native extension bytes, without relying on an ephemeral uv environment.
for path in sorted(site.rglob('*')):
    if path.is_file() and path.suffix in ('.py', '.so', '.dylib'):
        inputs[str(path)] = binding(path)['sha256']
for path in ['packages/tools/src/capture/classes.ts', 'packages/tools/src/capture/screens.ts',
             'packages/client/vite.config.js', 'pnpm-lock.yaml', 'package.json', 'packages/tools/package.json',
             'assets/renders/stations/round4/capture_readiness.json',
             'assets/renders/stations/round4/stage1_artifact_recovery.json',
             'assets/renders/stations/round4/browser_proof_execution04/qualification.json',
             'assets/renders/stations/round4/actual_browser_proof04/result.json',
             'assets/renders/stations/round4/actual_browser_proof04/probe/kernel_receipts.json',
             'assets/renders/stations/round4/browser_proof_execution04/terminal_resource_audit.json',
             'assets/renders/stations/review_round3/waystation/manifest.json',
             'assets/renders/stations/review_round3/scrapyard/manifest.json',
             'assets/blend/stations/_authoring/scratch/round3_1764eaf1/preserved_round2/packages/client/public/models/stations/waystation.glb']:
    path = ROOT / path; inputs[str(path)] = binding(path)['sha256']
assert inputs[str(ROOT / 'assets/blend/stations/_authoring/scratch/round3_1764eaf1/preserved_round2/packages/client/public/models/stations/waystation.glb')] == '9277e2c6c70917440bbb40f9d9350eb1faba0b03f17c324d04167fe002efbf7d'
ready = {'task': 'P1.E11.T01', 'status': 'CPU_READY_FOR_FRESH_REMAINING8_CALLER_REVIEW', 'GPU_GATE': 'CLOSED_NO_GRANT',
    'source_parent': '0df99794471b4978aff6f97fb6eabbe88794c876',
    'entry': str(HERE / 'capture_round4_stage.py'), 'runner': str(HERE / 'run_round4_remaining8.py'),
    'capture_seconds': 600, 'cleanup_seconds': 60, 'artifact_inspection_cpu_seconds_after_release': 45,
    'private_tmp_policy': PRIVATE_TMP_POLICY, 'stages': caller.original_stages(), 'input_sha256': inputs,
    'python_executable': prior['python_executable'], 'pnpm_executable': prior['pnpm_executable'],
    'launch_path': os.environ['PATH'], 'resolver_argv': prior['resolver_argv'], 'resolver': resolver,
    'process_binary_sha256': prior['process_binary_sha256'], 'decoder_python': str(python310),
    'decoder_site': str(site), 'inspector': str(HERE / 'inspect_round4_station_output.py'),
    'qualification': binding(BASE / 'browser_proof_execution04/qualification.json'),
    'recovered_stage1': binding(BASE / 'stage1_artifact_recovery.json'),
    'recovered_original_status': {'controller': 'FAILED', 'capture_exit': 'UNKNOWN', 'caffeinate_exit': 'UNKNOWN',
                                  'rerendered': False},
    'sequence': 'Unchanged accepted run_plan: atomic exclusive grant consumption, exact8 order, no retry/resume/skip; first failure permanently holds attempt',
    'stage_admission': 'Rechecks exact grant/head/inputs and persisted current stage/prior successes; one atomic launch claim per stage',
    'terminal_before_next': 'Capture0+caffeinate0, clean drained cohort and atomic kernel count0, known-birth absence, archived profiles/cache, absent exact review copies/job/scratch/assertion; exact outputs fully decoded and metadata validated',
    'limits': ['Observed blank Chromium cohort proof does not qualify external native/XPC services.',
               'Standard helper has requested gl only; actual standard renderer UNKNOWN. Raw3 perf samples unqualified under E14.T13.',
               'Supplement requested shots and actual metadata are both retained; no equivalence or occlusion fix is claimed.',
               'Python phase cancellation is not a hard scheduler/uninterruptible native-code bound.',
               'Automated artifact validity is not an independent visual grade; fourth review remains pending.'],
    'future_grant_file': str(caller.GRANT),
    'future_grant_fields': ['authorization_id', 'purpose=STATION_ROUND4_REMAINING_EIGHT_ONLY', 'authorized_head',
                           'readiness_sha256', 'runner_sha256', 'entry_sha256'],
    'run_argv': ['/opt/homebrew/opt/python@3.14/bin/python3.14', str(HERE / 'capture_round4_stage.py')],
    'required_environment': {'STATION_ROUND4_GPU_GRANT': '<new root authorization_id>', 'PATH': os.environ['PATH']},
    'current_parent_authorization': 'CPU preparation only; character QA owns next GPU slot; separate review and parent grant required',
    'unchanged_core_and_short_tmp_helpers': [binding(HERE / n) for n in ['round4_job_boundary.py', 'round4_capture_children.py', 'run_round4_browser_proof.py']],
    'source_bindings': [binding(HERE / n) for n in sources],
    'history_references_not_recopied': [binding(BASE / p) for p in ['browser_proof_ready04/readiness.json',
        'browser_proof_execution04/inventory.json', 'controller_revise01/freeze02/readiness.json', 'remaining8_readiness.json']],
    'focused_controls': [binding(OUT / p) for p in ['caller_controls_final16.log', 'artifact_controls_final5.log',
        'caller_controls_final16/fixture_audit.json', 'entry_absent_grant.txt']]}
caller.validate_plan(ready)
save(caller.READY, ready)
save(OUT / 'inventory.json', {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files': [binding(p) for p in sorted(OUT.rglob('*')) if p.is_file() and not p.is_symlink()]})
print(json.dumps({'readiness': binding(caller.READY), 'inventory': binding(OUT / 'inventory.json'),
                  'entry': binding(HERE / 'capture_round4_stage.py'), 'runner': binding(HERE / 'run_round4_remaining8.py'),
                  'input_bindings': len(inputs), 'focused_controls': 21}, indent=2))
