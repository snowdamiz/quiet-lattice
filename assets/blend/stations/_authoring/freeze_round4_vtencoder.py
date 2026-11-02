"""Freeze one exact Apple encoder binding and the next disabled station attempt."""
import ast
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import run_round4_remaining8 as caller

ROOT, BASE, OUT = caller.ROOT, caller.BASE, caller.FREEZE
HERE = Path(__file__).resolve().parent
PRIOR = BASE / 'station_remaining8_ready03'
FAILURE = BASE / 'station_remaining8_execution01'


def binding(path):
    path = Path(path)
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


def save(path, value):
    if path.exists():
        assert json.loads(path.read_text()) == value, path
        return
    path.write_text(json.dumps(value, indent=2) + '\n')


assert not caller.READY.exists() and not caller.GRANT.exists() and not (OUT / 'consumed_grants').exists()
assert binding(PRIOR / 'readiness.json')['sha256'] == '1d6161c39ed8c6b75a02ea09df8460ee4cc679f2f7036f4b76c73296ec74bb4a'
assert binding(PRIOR / 'parent_gpu_grant.json')['sha256'] == 'e4901ed82ecfe566fe99f667d6a52ce59a2cd2fc8b8af382d2f6bbb20ca4cc87'
assert binding(FAILURE / 'terminal_resource_audit.json')['sha256'] == '1d716d45d2adaa56fd500bad4bd8482bd4d32cde9d12d5fac989255a061218ff'
manifest = json.loads((FAILURE / 'preserved_attempt_manifest.json').read_text())
for row in manifest['files']:
    path = ROOT / row['path']
    assert binding(path)['sha256'] == row['sha256'] and path.stat().st_size == row['bytes'], path
save(OUT / 'attempt01_preservation.json', {'files_verified': len(manifest['files']),
     'manifest': binding(FAILURE / 'preserved_attempt_manifest.json'),
     'grant': binding(PRIOR / 'parent_gpu_grant.json'), 'readiness': binding(PRIOR / 'readiness.json'),
     'terminal_audit': binding(FAILURE / 'terminal_resource_audit.json'), 'all_original_bytes_unchanged': True})

old_ast = ast.parse((PRIOR / 'frozen_sources/run_round4_remaining8.py').read_text())
new_ast = ast.parse((HERE / 'run_round4_remaining8.py').read_text())
for old in old_ast.body:
    if isinstance(old, (ast.FunctionDef, ast.ClassDef)) and old.name not in ('original_stages', 'preflight', 'StageReceipts'):
        new = next(n for n in new_ast.body if type(n) is type(old) and n.name == old.name)
        assert ast.dump(old) == ast.dump(new), old.name
old_observer = next(n for n in old_ast.body if isinstance(n, ast.ClassDef) and n.name == 'StageReceipts')
new_observer = next(n for n in new_ast.body if isinstance(n, ast.ClassDef) and n.name == 'StageReceipts')
for old in old_observer.body:
    if isinstance(old, ast.FunctionDef) and old.name != 'observe':
        new = next(n for n in new_observer.body if isinstance(n, ast.FunctionDef) and n.name == old.name)
        assert ast.dump(old) == ast.dump(new), old.name

ready = json.loads((PRIOR / 'readiness.json').read_text())
for path, expected in ready['input_sha256'].items():
    if path != str(HERE / 'run_round4_remaining8.py'):
        assert binding(path)['sha256'] == expected, path
expected = json.loads(json.dumps(ready['stages']).replace('/engine/attempt01/', '/engine/attempt02/'))
assert caller.original_stages() == expected
ready['stages'] = expected
caller.validate_plan(ready)
encoder = caller.encoder_binding()
save(OUT / 'apple_encoder_signature.json', encoder)
ready['process_binary_sha256'][caller.VTENCODER] = encoder['sha256']
ready['input_sha256'][caller.VTENCODER] = encoder['sha256']
ready['input_sha256']['/usr/bin/codesign'] = encoder['codesign_sha256']
names = ['run_round4_remaining8.py', 'test_round4_vtencoder.py', 'freeze_round4_vtencoder.py']
frozen = OUT / 'frozen_sources'; frozen.mkdir(exist_ok=False)
for name in names:
    shutil.copy2(HERE / name, frozen / name)
    ready['input_sha256'][str(HERE / name)] = binding(HERE / name)['sha256']
assert 'Ran 10 tests' in (OUT / 'controls_final02.txt').read_text()
assert (OUT / 'controls_final02.txt').read_text().rstrip().endswith('OK')
ready.update(status='CPU_READY_FOR_EXACT_APPLE_ENCODER_AND_OBSERVATION_REVIEW', GPU_GATE='CLOSED_NO_GRANT',
    source_parent=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    future_grant_file=str(caller.GRANT), apple_encoder_binding=encoder,
    output_namespace='assets/renders/stations/round4/engine/attempt02',
    source_bindings=[binding(HERE / n) for n in names],
    prior_focused_controls_reused_not_rerun=ready['focused_controls'],
    focused_controls=[binding(OUT / n) for n in ['controls_before.txt', 'controls_after.txt',
        'controls_after_fixed_fixture.txt', 'controls_final.txt', 'controls_codesign_argv_before.txt',
        'controls_final02.txt', 'entry_absent_grant.txt']],
    correction={'scope': 'Persist stable birth/coalition/executable/role before rejection; one exact Apple encoder binary; fresh attempt02 outputs',
        'admitted_native_executables_added': [caller.VTENCODER], 'framework_wildcards': False,
        'signature_admission': 'Exact whole-binary SHA256, canonical path and codesign Apple anchor/identifier verification; pinned platform/CDHash diagnostics',
        'job_ownership_counter_signaling_semantics_changed': False,
        'observation_rejection_stays_fail_closed': True, 'new_cpu_controls': 10,
        'fixture_iteration': 'First post-edit run exposed /var versus /private/var in CPU fixture paths; fixture now resolves its own root before testing canonical binary admission. Raw failure retained.',
        'signature_argv_iteration': 'First CPU signature query treated -R argument as a file; local codesign documentation requires an equals prefix for inline requirements. Focused control reproduces the error; final source uses the documented inline form. Raw failure retained.',
        'broad_unchanged_suites_repeated': False, 'browser_service_proof_or_retry_executed': False,
        'failure_preservation': binding(OUT / 'attempt01_preservation.json')},
    current_parent_authorization='CPU correction only. Independent fresh source review and a new separate parent grant are required before attempt02.')
ready['history_references_not_recopied'] += [binding(PRIOR / 'readiness.json'), binding(FAILURE / 'WORKER-REPORT.md')]
save(caller.READY, ready)
caller.verify_encoder_binding(ready)
save(OUT / 'parent_gpu_grant.DISABLED_TEMPLATE.json', {
    'enabled': False, 'purpose': 'NOT_AUTHORIZED_CPU_ONLY_DISABLED_TEMPLATE',
    'authorization_id': 'NEW_PARENT_AUTHORIZATION_REQUIRED_AFTER_FRESH_SOURCE_REVIEW',
    'authorized_head': 'REPLACE_WITH_FRESH_REVIEWED_HEAD_AFTER_COMMIT',
    'readiness_sha256': binding(caller.READY)['sha256'],
    'runner_sha256': binding(HERE / 'run_round4_remaining8.py')['sha256'],
    'entry_sha256': binding(HERE / 'capture_round4_stage.py')['sha256']})
save(OUT / 'inventory.json', {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'files': [binding(p) for p in sorted(OUT.rglob('*')) if p.is_file() and '__pycache__' not in p.parts
              and not p.name.startswith('freeze_stdout')],
    'actual_grant_absent': not caller.GRANT.exists(), 'consumption_absent': not (OUT / 'consumed_grants').exists()})
print(json.dumps({'readiness': binding(caller.READY), 'runner': binding(HERE / 'run_round4_remaining8.py'),
                  'encoder_sha256': encoder['sha256'], 'encoder_cdhash': encoder['cdhash'],
                  'new_cpu_controls': 10, 'no_runtime_launch': True}, indent=2))
