"""CPU-only one-time freeze of the separately granted asset-free browser proof runner."""
import ast
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from run_round4_browser_proof import executable_path, RUN

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).parent
BASE = ROOT / 'assets/renders/stations/round4'
OUT = BASE / 'browser_proof_ready02'


def binding(path):
    path = Path(path)
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


def write(path, data):
    assert not path.exists(), path
    path.write_text(json.dumps(data, indent=2) + '\n')


accepted_file = BASE / 'controller_revise01/freeze02/readiness.json'
accepted = json.loads(accepted_file.read_text())
current_prior = []
for record in accepted['sources']:
    current = binding(ROOT / record['source']['path'])
    current_prior.append(current)
    if Path(current['path']).name != 'round4_job_boundary.py':
        assert current['sha256'] == record['source']['sha256']
before = ast.parse((BASE / 'controller_revise01/freeze02/frozen_sources/round4_job_boundary.py').read_text())
after = ast.parse((HERE / 'round4_job_boundary.py').read_text())
for old in before.body:
    if isinstance(old, ast.FunctionDef):
        new = next(v for v in after.body if isinstance(v, ast.FunctionDef) and v.name == old.name)
        assert ast.dump(old, include_attributes=False) == ast.dump(new, include_attributes=False)
old_class = next(v for v in before.body if isinstance(v, ast.ClassDef) and v.name == 'StationJob')
new_class = next(v for v in after.body if isinstance(v, ast.ClassDef) and v.name == 'StationJob')
for old in old_class.body:
    if isinstance(old, ast.FunctionDef) and old.name != 'archive':
        new = next(v for v in new_class.body if isinstance(v, ast.FunctionDef) and v.name == old.name)
        assert ast.dump(old, include_attributes=False) == ast.dump(new, include_attributes=False)
review2_preservation = BASE / 'browser_proof_ready01/review2_preservation.json'
for record in json.loads(review2_preservation.read_text())['files']:
    assert binding(ROOT / record['path'])['sha256'] == record['sha256']
assert not RUN.exists()
assert not (OUT / 'parent_gpu_proof_grant.json').exists()
assert not (OUT / 'consumed_proof_grants').exists()
test_log = OUT / 'proof_controls19.log'
assert 'Ran 19 tests' in test_log.read_text() and test_log.read_text().rstrip().endswith('OK')
for name, count in (('archive_controls_final9.log', 9), ('relevant_controls23.log', 23)):
    content = (OUT / name).read_text()
    assert f'Ran {count} tests' in content and content.rstrip().endswith('OK')

pnpm = Path(shutil.which('pnpm')).resolve()
assert 'exec "${SCRIPT_DIR}/../../node/bin/node"' in pnpm.read_text()
embedded_node = (pnpm.parent / '../../node/bin/node').resolve()
resolver_argv = [str(embedded_node), str(HERE / 'resolve_round4_browser_cpu.cjs')]
env = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR') if key in os.environ}
resolved = subprocess.run(resolver_argv, cwd=ROOT, env=env, capture_output=True, text=True, timeout=5)
assert resolved.returncode == 0, resolved.stderr
resolver = json.loads(resolved.stdout)
assert resolver['spawnCalls'] == [] and resolver['validatedHeadless'] is True
assert resolver['selectedRegistryName'] == 'chromium-headless-shell'
assert resolver['selectedExecutable']['sha256'] == '77d8278b1ac9d0687fad4e817ea83023ede09b1deef36e1864b49ba194ac9634'
write(OUT / 'exact_resolver.json', resolver)
write(OUT / 'resolver_command_receipt.json', {'mode': 'CPU_ONLY_NO_LAUNCH', 'argv': resolver_argv,
      'exit': resolved.returncode, 'stderr': resolved.stderr, 'spawnCalls': resolver['spawnCalls']})

code_candidates = [Path(r['path']) for r in resolver['installedBinaryAndLibraryCandidates']]
toolchain = [pnpm, embedded_node, Path(shutil.which('node')).resolve(), Path(sys.executable).resolve(),
             Path(executable_path(os.getpid())), Path('/usr/bin/caffeinate'), Path('/bin/bash'), Path('/usr/bin/env')]
toolchain += sorted((ROOT / 'node_modules/.pnpm').glob('@esbuild+darwin-arm64@*/node_modules/@esbuild/darwin-arm64/bin/esbuild'))
process_binaries = {str(p.resolve()): binding(p)['sha256'] for p in code_candidates + toolchain if p != pnpm}
names = ('run_round4_browser_proof.py', 'round4_browser_probe.mjs', 'resolve_round4_browser_cpu.cjs',
         'test_round4_browser_proof.py', 'prepare_round4_browser_proof.py', 'round4_job_boundary.py',
         'test_round4_profile_archive.py')
sources = [binding(HERE / name) for name in names]
freeze = OUT / 'frozen_sources'
freeze.mkdir(exist_ok=False)
for name in names:
    shutil.copy2(HERE / name, freeze / name)
    assert binding(freeze / name)['sha256'] == binding(HERE / name)['sha256']

inputs = {r['path']: r['sha256'] for r in sources}
inputs.update({r['path']: r['sha256'] for r in current_prior})
inputs.update({str(p.resolve()): binding(p)['sha256'] for p in code_candidates + toolchain})
inputs[resolver['installedPlaywrightBundle']['path']] = resolver['installedPlaywrightBundle']['sha256']
original = BASE / 'capture_readiness.json'
for name, value in json.loads(original.read_text())['input_sha256'].items():
    assert binding(ROOT / name)['sha256'] == value
    inputs[str(ROOT / name)] = value

history_paths = [accepted_file, BASE / 'controller_revise01/actual_browser_boundary_proposal.json',
                 BASE / 'controller_revise01/freeze02/inventory.json', BASE / 'stage1_artifact_recovery.json',
                 BASE / 'browser_proof_ready01/readiness.json', BASE / 'browser_proof_ready01/inventory.json']
history = [binding(p) for p in history_paths]
ready = {'task': 'P1.E11.T01', 'status': 'CPU_READY_FOR_NARROW_INDEPENDENT_PROOF_RUNNER_REVIEW',
         'GPU_GATE': 'CLOSED; separate explicit parent grant required after review',
         'actual_execution_performed': False, 'actual_station_capture_enabled': False,
         'scope_after_a_passing_real_run': 'Observed Chromium execution cohort only',
         'external_native_XPC_service_ownership': 'UNQUALIFIED; needed separately for later E14.T13',
         'runtime_output': str(RUN), 'argv': ['pnpm', 'exec', 'tsx', str((HERE / 'round4_browser_probe.mjs').relative_to(ROOT))],
         'runner_command': [sys.executable, str(HERE / 'run_round4_browser_proof.py')],
         'runner_sha256': binding(HERE / 'run_round4_browser_proof.py')['sha256'],
         'payload_sha256': binding(HERE / 'round4_browser_probe.mjs')['sha256'],
         'python_executable': str(Path(sys.executable).resolve()), 'pnpm_executable': str(pnpm),
         'capture_seconds': 30, 'cleanup_seconds': 30, 'receipt_barrier_seconds': 5,
         'work': 'One about:blank page at1920x1080, one1x1 WebGL2 clear/finish; no assets/screenshots/performance',
         'launch_call': 'chromium.launch({ args })', 'launch_settings_unchanged': True,
         'resolver_argv': resolver_argv, 'resolver': resolver,
         'process_binary_sha256': process_binaries, 'temporary_root': str((RUN / 'private_profiles').resolve()),
         'input_sha256': inputs, 'prior_accepted_eight_source_bindings': accepted['sources'],
         'current_prior_source_bindings': current_prior,
         'archive_API_delta': {'optional_keywords': ['profile_namespace', 'profile_prefixes'],
             'allowed_prefixes': ['playwright_chromiumdev_profile-', 'playwright_firefoxdev_profile-', 'playwright_webkitdev_profile-'],
             'ownership': 'Explicit canonical UID-owned mode0700 private namespace admits allowlisted direct children, including unlogged WebKit profiles; receipts distinguish namespace-owned/log-observed/caller-declared.',
             'default': 'Chromium-only, named/log-bound; no global temp scan',
             'other_7_prior_sources_exact': True, 'ownership_signaling_counters_sequencing_AST_identical': True},
         'required_receipts': ['browser', 'gpu-process', 'renderer', 'utility'],
         'receipt_policy': 'Each current kernel birth/UID/cohort and actual executable matches a prelaunch binding; exact owned launch log/profile and backend log/file agree before5s acknowledgment.',
         'sequence': 'Atomic one-grant consumption and exclusive payload-start claim; no retry or alternate output. Any failure holds attempt.',
         'teardown': 'Reviewed StationJob drain, kernel counter terminal proof and known-PID absence; exact owned profile/job/scratch archive; primary failure retained independently of teardown failure.',
         'limits': ['Python phase cancellation is not a hard scheduler/uninterruptible-native bound.',
                    'Prelaunch boundary errors or rejected profile identity retain raw scratch and UNPROVED teardown; never signal/remove unknown resources.',
                    'Observed receipts do not claim observation of every historical process or externally brokered native/XPC ownership.',
                    'Historical CPU stub02/03 exact profiles remain UNKNOWN; unbound directories untouched.',
                    'Original GPU stage1 remains controller FAILED, capture/caffeinate UNKNOWN;12 recovered artifacts unchanged.'],
         'future_grant_file': str(OUT / 'parent_gpu_proof_grant.json'),
         'future_grant_fields': ['authorization_id', 'purpose=ASSET_FREE_CHROMIUM_BOUNDARY_PROOF_ONLY', 'authorized_head', 'readiness_sha256', 'runner_sha256'],
         'required_environment': 'STATION_BROWSER_PROOF_GRANT=<new parent authorization_id>',
         'history_bindings_not_recopied': history, 'full_review2_preservation': binding(review2_preservation),
         'new_CPU_tests': {'count': 19, 'log': binding(test_log), 'scope': 'parsing/gating/negative mocks, syntax and dry resolver; no Job/browser launch'},
         'focused_archive_controls': {'count': 9, 'log': binding(OUT / 'archive_controls_final9.log')},
         'relevant_previous_controls': {'count': 23, 'log': binding(OUT / 'relevant_controls23.log'), 'rerun_once_for_authorized_archive_API_change': True},
         'new_sources': sources}
write(OUT / 'readiness.json', ready)
write(OUT / 'proposal.json', {key: ready[key] for key in ('status', 'GPU_GATE', 'argv', 'runner_command', 'capture_seconds',
      'cleanup_seconds', 'receipt_barrier_seconds', 'work', 'launch_call', 'resolver', 'required_receipts', 'limits')})
records = [binding(p) for p in sorted(OUT.rglob('*')) if p.is_file()]
write(OUT / 'inventory.json', {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'files': records})
for p in OUT.rglob('*'):
    if p.is_file(): p.chmod(0o444)
print(json.dumps({'readiness': binding(OUT / 'readiness.json'), 'inventory': binding(OUT / 'inventory.json'),
                  'selected_browser': resolver['selectedExecutable'], 'authorized_archive_API_changes': 1,
                  'other_accepted_source_changes': 0}, indent=2))
