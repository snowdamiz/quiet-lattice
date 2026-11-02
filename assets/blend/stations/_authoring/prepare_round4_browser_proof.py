"""Freeze only the allocation-order correction; reuse immutable passing ready03 evidence."""
import ast
import copy
import datetime
import hashlib
import json
from pathlib import Path
import shutil

from run_round4_browser_proof import RUN

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).parent
BASE = ROOT / 'assets/renders/stations/round4'
PRIOR = BASE / 'browser_proof_ready03'
OUT = BASE / 'browser_proof_ready04'


def binding(path):
    path = Path(path)
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


def write(path, data):
    assert not path.exists(), path
    path.write_text(json.dumps(data, indent=2) + '\n')


assert binding(PRIOR / 'readiness.json')['sha256'] == '146b7ffa55397eaea9a4033bb4adec8e3a54f8ef3212b7a5a9bdfe65975f2257'
prior = json.loads((PRIOR / 'readiness.json').read_text())
before = ast.parse((PRIOR / 'frozen_sources/run_round4_browser_proof.py').read_text())
after = ast.parse((HERE / 'run_round4_browser_proof.py').read_text())
for old in before.body:
    if isinstance(old, (ast.FunctionDef, ast.ClassDef)) and old.name not in ('create_private_tmp', 'execute'):
        new = next(v for v in after.body if type(v) is type(old) and v.name == old.name)
        assert ast.dump(old, include_attributes=False) == ast.dump(new, include_attributes=False)
for name, expected in (('round4_job_boundary.py', '3f5ca99841be6a2ab4218bd45c5e44c5bb368e331d4b323b906b25354baa444c'),
                       ('round4_browser_probe.mjs', '50a6ec79087bb4a9f3c8de8cc6e82c8bb9542a9b5552e27746e905ef949b336f')):
    assert binding(HERE / name)['sha256'] == expected
changed = {str(HERE / n) for n in ('run_round4_browser_proof.py', 'prepare_round4_browser_proof.py')}
for path, expected in prior['input_sha256'].items():
    if path not in changed: assert binding(path)['sha256'] == expected, path
test_log = OUT / 'allocation_controls_final6.log'
assert 'Ran 6 tests' in test_log.read_text() and test_log.read_text().rstrip().endswith('OK')
for record in json.loads((OUT / 'review_preservation.json').read_text())['files']:
    if record['type'] == 'file': assert binding(ROOT / record['path'])['sha256'] == record['sha256']
assert not RUN.exists() and not (OUT / 'parent_gpu_proof_grant.json').exists()
assert not (OUT / 'consumed_proof_grants').exists()

names = ('run_round4_browser_proof.py', 'prepare_round4_browser_proof.py', 'test_round4_tmp_allocation.py')
freeze = OUT / 'frozen_sources'; freeze.mkdir(exist_ok=False)
sources = []
for name in names:
    shutil.copy2(HERE / name, freeze / name)
    assert binding(HERE / name)['sha256'] == binding(freeze / name)['sha256']
    sources.append(binding(HERE / name))
ready = copy.deepcopy(prior)
ready.update(status='CPU_READY_FOR_NARROW_ALLOCATION_FAILURE_REVIEW', runtime_output=str(RUN),
             runner_sha256=binding(HERE / 'run_round4_browser_proof.py')['sha256'], new_sources=sources,
             future_grant_file=str(OUT / 'parent_gpu_proof_grant.json'))
ready['input_sha256'].update({r['path']: r['sha256'] for r in sources})
ready['history_bindings_not_recopied'] += [binding(PRIOR / 'readiness.json'), binding(PRIOR / 'inventory.json')]
ready['new_CPU_tests'] = {'count': 6, 'log': binding(test_log),
    'scope': 'Injected allocation/admission/write/cancellation failures and exact rollback; no job/launcher/browser'}
ready['allocation_correction'] = {
    'before_proof': binding(OUT / 'allocation_before/observed.json'),
    'before_recovery': binding(OUT / 'allocation_before/reviewer-recovery.json'),
    'review_preservation': binding(OUT / 'review_preservation.json'),
    'success_signature_unchanged': 'create_private_tmp(record_path) -> (Path, admission)',
    'rollback': 'Allocator owns raw path/UID/dev/inode before fallible admission persistence. Pre-return failures remove only that exact empty root; original exception retained.',
    'unproved': 'Exception.private_tmp_allocation retains path/identity/cleanup failure; execute records UNPROVED and retained_private_tmp.',
    'cancellation': 'SIGALRM/SIGINT deferred only across allocation and identity acquisition; exact prior mask restored in finally before receipt/copy work.',
    'unchanged': 'Accepted archive/kernel/counters/process signaling, cache preservation, browser payload/flags and all other prior runner functions/classes',
    'prior_passing_launcher_core_evidence_reused': True, 'launcher_or_broad_core_repeated_this_unit': False}
write(OUT / 'readiness.json', ready)
write(OUT / 'inventory.json', {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files': [binding(p) for p in sorted(OUT.rglob('*')) if p.is_file() and not p.is_symlink()]})
for p in OUT.rglob('*'):
    if p.is_file() and not p.is_symlink(): p.chmod(0o444)
print(json.dumps({'readiness': binding(OUT / 'readiness.json'), 'inventory': binding(OUT / 'inventory.json'),
                  'runner': binding(HERE / 'run_round4_browser_proof.py'), 'new_controls': 6}, indent=2))
