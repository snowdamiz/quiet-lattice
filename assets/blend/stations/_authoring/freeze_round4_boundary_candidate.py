"""Freeze the station CPU candidate and directly audit owned fixture release."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from round4_job_boundary import identity, kernel_tasks

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).parent
BASE = ROOT / 'assets/renders/stations/round4'
OUT = BASE / 'controller_revise01'
FINAL = OUT / 'freeze02'
FINAL.mkdir(exist_ok=False)


def item(path):
    return {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


def check(record):
    assert item(ROOT / record['path'])['sha256'] == record['sha256'], record['path']


for record in json.loads((OUT / 'preservation.json').read_text())['files']:
    check(record)
plan = json.loads((BASE / 'capture_readiness.json').read_text())
assert item(BASE / 'capture_readiness.json')['sha256'] == 'd1dc9907f657cf9a707a2b5ee2cc477fa15831cf3ba378bebb51b05b6ac973fa'
for path, expected in plan['input_sha256'].items():
    assert item(ROOT / path)['sha256'] == expected
third_count = 0
for kit in ('waystation', 'scrapyard'):
    for record in json.loads((ROOT / f'assets/renders/stations/review_round3/{kit}/inventory.json').read_text())['files']:
        check(record)
        third_count += 1
recovery_file = BASE / 'stage1_artifact_recovery.json'
assert item(recovery_file)['sha256'] == '534baf14ae0d8690fec8ed84eadb5bef8f8cf13f37c3b3d4d4403b94faabd0e2'
recovery = json.loads(recovery_file.read_text())
assert recovery['original_execution']['controller_status'] == 'FAILED'
assert recovery['original_execution']['capture_exit'] == recovery['original_execution']['caffeinate_exit'] == 'UNKNOWN'
for record in recovery['input_bindings'] + recovery['decoded_artifacts']:
    check(record)
protected = ROOT / 'assets/blend/stations/_authoring/scratch/round3_1764eaf1/preserved_round2/packages/client/public/models/stations/waystation.glb'
assert item(protected)['sha256'] == '9277e2c6c70917440bbb40f9d9350eb1faba0b03f17c324d04167fe002efbf7d'
assert item(BASE / 'engine_runs/attempt01/standard-waystation-ws_fabricator/controller_source_at_failure.py')['sha256'] == '8b91ae9081bb73daa178ff6df967e1304515538118367ff110b9eb4f87976a37'
assert item(BASE / 'engine_runs/attempt01/standard-waystation-ws_fabricator/manual_failure_release.json')['sha256'] == '401851c5c326a7802d205a76ec4604a33b5d572b141c1874ac8625605aaeb392'
for name in ('gpu_grant_remaining8.json', 'gpu_grant_remaining8_after_boundary.json', 'actual_capture_boundary_qualification.json', 'remaining8_readiness_after_boundary.json'):
    assert not (BASE / name).exists(), name

# Inspect birth-bound receipts only. A reused PID is reported without exposing its argv/env.
identities, jobs, profiles = {}, {}, set()
def visit(value):
    if isinstance(value, dict):
        if isinstance(value.get('pid'), int) and isinstance(value.get('birth'), list):
            identities[(value['pid'], tuple(value['birth']))] = value
        if isinstance(value.get('target'), str) and value['target'].startswith(f'gui/{os.getuid()}/local.stations.round4.'):
            jobs[value['target']] = value
        for key in ('owned_logged_profiles',):
            profiles.update(value.get(key, []))
        for child in value.values(): visit(child)
    elif isinstance(value, list):
        for child in value: visit(child)

for path in OUT.rglob('*.json'):
    visit(json.loads(path.read_text()))
profiles.update(re.findall(r'--user-data-dir=([^\s\'\"]+)',
    (OUT / 'installed_boundary01/installed_launcher/capture_stdout.txt').read_text()))
reused = []
for (pid, birth), old in identities.items():
    current = identity(pid)
    assert current is None or tuple(current['birth']) != birth, (old, current)
    if current:
        reused.append({'historic': old, 'current_kernel_identity': current, 'same_birth': False, 'signalled': False})
for target, record in jobs.items():
    result = subprocess.run(['/bin/launchctl', 'print', target], capture_output=True, text=True, timeout=3)
    assert result.returncode != 0, target
    if record.get('coalition_id'):
        assert kernel_tasks(record['coalition_id'])['live'] == 0
    if record.get('scratch'):
        assert not Path(record['scratch']).exists(), record['scratch']
assert all(not Path(p).exists() for p in profiles)
profile = Path('/var/folders/w6/vbftz74j4jzb2t9ry9r724g00000gn/T/playwright_chromiumdev_profile-IXs5cd')
assert not profile.exists()
listener = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP@127.0.0.1:64873', '-sTCP:LISTEN'], capture_output=True, text=True, timeout=3)
assert listener.returncode == 1 and not listener.stdout
assert not list((ROOT / 'packages/client/public/models/stations').glob('_review_*.glb'))
log = (OUT / 'final23_receipt_barrier.log').read_text()
assert 'Ran 23 tests' in log and log.rstrip().endswith('OK')
assert len(json.loads((OUT / 'final23_receipt_barrier/fixtures.json').read_text())) == 23
after = json.loads((OUT / 'enumeration_race_after02/result.json').read_text())['terminal_receipt']
assert after['incomplete_scan_receipts'][0]['kernel']['live'] == 2
assert after['kernel_before_root_release']['live'] == 1 and after['kernel_terminal']['live'] == 0
installed = json.loads((OUT / 'installed_boundary04/result.json').read_text())
assert installed['actual_capture_boundary_qualified'] is False
write_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
release = {'utc': write_time, 'mode': 'CPU_ONLY', 'historic_birth_bound_identities': len(identities),
           'all_historic_birth_bound_fixture_pids_absent': True, 'reused_unrelated_identities': reused,
           'unique_owned_jobs_checked': len(jobs), 'all_job_registrations_scratch_and_live_coalitions_absent': True,
           'logged_profiles_checked': sorted(profiles), 'all_known_profiles_absent': True,
           'historic_successful_stub_profile_telemetry': {'installed_boundary02': 'UNKNOWN exact path; no ownership inference or cleanup of unbound directories', 'installed_boundary03': 'UNKNOWN exact path; no ownership inference or cleanup of unbound directories'},
           'original_stage1_profile_and_listener_absent': True, 'temporary_review_glbs_absent': True,
           'signals_sent_by_this_audit': [], 'no_GPU_browser_or_Blender_run_in_this_revision': True}
(FINAL / 'final_resource_audit.json').write_text(json.dumps(release, indent=2) + '\n')

freeze = FINAL / 'frozen_sources'
freeze.mkdir(exist_ok=False)
names = ('capture_round4_stage.py', 'round4_capture_children.py', 'round4_job_boundary.py',
         'test_round4_capture_lifecycle.py', 'test_round4_job_boundary.py', 'prove_round4_launch_boundary.py',
         'prove_round4_enumeration_race.py', 'freeze_round4_boundary_candidate.py')
sources = []
for name in names:
    shutil.copy2(HERE / name, freeze / name)
    sources.append({'source': item(HERE / name), 'copy': item(freeze / name)})
stages = [s for s in plan['stages'] if s['id'] != 'standard-waystation-ws_fabricator']
assert len(stages) == 8 and all(not (ROOT / s['out_path']).exists() for s in stages)
ready = {'task': 'P1.E11.T01', 'status': 'CPU_CANDIDATE_READY_FOR_INDEPENDENT_SOURCE_REVIEW',
         'GPU_GATE': 'CLOSED', 'actual_capture_boundary_qualified': False,
         'capture_callable_frozen': False, 'actual_capture_entry_deliberately_disabled': True,
         'reviewed_parent': '9e81e36e0f564aae6b46e323d5c55eb42a3748f1',
         'scope': 'Task-local CPU ownership/sequencing/deadline candidate; not approved for actual capture',
         'sources': sources, 'test_count': 23, 'test_log': item(OUT / 'final23_receipt_barrier.log'),
         'test_fixtures': item(OUT / 'final23_receipt_barrier/fixtures.json'), 'resource_audit': item(FINAL / 'final_resource_audit.json'),
         'before_premise_proof': item(OUT / 'before/adverse_results.json'),
         'before_sequence_proof': item(OUT / 'before/stop_failure_results.json'),
         'real_enumeration_race_before': item(OUT / 'enumeration_race_before/result.json'),
         'exact_cleanup_race_after': item(OUT / 'enumeration_race_after02/result.json'),
         'installed_launcher_CPU_proof': item(OUT / 'installed_boundary04/result.json'),
         'actual_browser_proposal': item(OUT / 'actual_browser_boundary_proposal.json'),
         'stage1_recovery': item(recovery_file), 'original_stage1_execution': recovery['original_execution'],
         'third_inventory_files_verified': third_count, 'original_plan': item(BASE / 'capture_readiness.json'),
         'protected_T13_export': item(protected), 'unchanged_unlaunched_stages': stages,
         'stages_equal_original_argv_and_paths': True,
         'deadline_limit': 'Tested Python phase interruption, not a hard scheduler/uninterruptible-native bound; actual runtime disabled',
         'next': 'Fresh independent source review; separately authorized actual browser boundary proof; subsequent reviewed actual capture binding and new resource grant. No automatic retry.'}
(FINAL / 'readiness.json').write_text(json.dumps(ready, indent=2) + '\n')
inventory = [item(p) for p in sorted(OUT.rglob('*')) if p.is_file() and p != FINAL / 'inventory.json']
(FINAL / 'inventory.json').write_text(json.dumps({'files': inventory}, indent=2) + '\n')
for path in OUT.rglob('*'):
    if path.is_file(): path.chmod(0o444)
print(json.dumps({'readiness': item(FINAL / 'readiness.json'), 'inventory': item(FINAL / 'inventory.json'), 'release': release}, indent=2))
