"""Read-only audits and immutable fourth-grader metadata; no render/browser work."""
from pathlib import Path
from collections import Counter
import datetime, hashlib, json, re, subprocess

root = Path.cwd()
stage = root / '.claude/pause/characters-resume'
v = root / 'assets/renders/characters/validate'
review = root / 'assets/renders/review/characters'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
write = lambda name, value: (v / name).write_text(json.dumps(value, indent=2) + '\n')
item = lambda p: {'path': str(p.relative_to(root)), 'sha256': sha(p), 'bytes': p.stat().st_size}
source = root / 'assets/blend/characters/ulgani.blend'
export = root / 'packages/client/public/models/characters/ulgani.glb'
source_commit = 'c8a90a0eb8a55529099e34bfd797c3e77533cd71'
assert sha(source) == 'd0ab87a61e5b50ccb336c03b14a1553b7b2b063c7935af334ba12218bc013bc7'
assert sha(export) == '14d386eefd291892f3b3f2f0072c640e37a6f267fe73e4a4cb757c49db1caece'
pre = json.loads((v / 'ulgani-review4-capture-preflight.json').read_text())
for path, digest in pre['measurement_sources'].items():
    assert sha(root / path) == digest, path
for people in ('thalune', 'ixari'):
    inventory = json.loads((v / f'{people}-review5-inventory.json').read_text())
    assert len(inventory['artifacts']) == 179
    for record in inventory['artifacts']:
        assert sha(root / record['path']) == record['sha256'], record['path']
run_path = v / 'ulgani-review4-run.json'
run = json.loads(run_path.read_text())
assert len(run['steps']) == 17 and run['steps'][-1]['exit_code'] == 0
session = json.loads((v / 'ulgani-review4-capture-session.json').read_text())
assert session['controller_exit_code'] == session['sampler_exit_code'] == session['caffeinate_exit_code'] == 0
backup = root / run['prior_capture_backup']
old_paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', pre['head'], '--', 'assets/renders/review/characters/ulgani'], text=True).splitlines()
old_items = []
prefix = Path('assets/renders/review/characters/ulgani')
for path in old_paths:
    blob = subprocess.check_output(['git', 'show', pre['head'] + ':' + path])
    match = re.search(rb'^oid sha256:([0-9a-f]{64})$', blob, re.M)
    expected = match.group(1).decode() if match else hashlib.sha256(blob).hexdigest()
    old = backup / 'ulgani' / Path(path).relative_to(prefix)
    assert sha(old) == expected, path
    old_items.append({'previous_path': path, 'previous_head': pre['head'], 'sha256': expected, 'backup': str(old.relative_to(root))})
write('ulgani-review4-preserved-prior-captures.json', {'verified_utc': now, 'note': 'Every prior tracked Ulgani engine capture is retained byte-identically and checked against its prior Git/LFS content identity. No raw source/checkpoint/map was replaced.', 'count': len(old_items), 'artifacts': old_items})
variants = [f'{kind}{n}' for kind, count in (('head', 6), ('suit', 4)) for n in range(1, count + 1)]
reports, records, placement, uncertain = [], [], [], []
for variant in variants:
    path = review / 'ulgani/ulgani' / f'ulgani_{variant}/perf.json'
    report = json.loads(path.read_text())
    assert report['file'] == 'characters/ulgani' and report['variant'] == f'ulgani_{variant}'
    assert report['viewport'] == [1920, 1080] and report['gl'] == 'metal' and not report['errors']
    assert {c['case'] for c in report['perf']} == {'noon-lush', 'night-exotic', 'open-space'}
    reports.append(item(path))
    placement.append({'variant': report['variant'], 'report_sha256': sha(path), 'spots': report['spots'], 'far': report['far']})
    for case in report['perf']:
        assert case['scene']['gpuSamples'] > 0 and case['asset']['pairs'] > 0
        assert case['scene']['triangles'] > case['withoutAsset']['triangles']
        records.append({'variant': report['variant'], 'report_sha256': sha(path), **case})
        if not case['asset']['reliable']:
            uncertain.append({'variant': report['variant'], 'case': case['case'], 'pairs': case['asset']['pairs'], 'ci95': case['asset']['gpuMsCi95'], 'ci_target_ms': case['asset']['ciTargetMs']})
assert len(records) == 30
load_path = v / 'ulgani-review4-load-samples.json'
load = json.loads(load_path.read_text())
counts = Counter(x['phase'] for x in load['samples'])
range_of = lambda values: [min(values), max(values)]
context = {
    'scope': 'One standard1920x1080 Ulgani fourth art-review browser session:10 variants x3 lighting cases, each once. Adaptive ABBA pairs within a case are not independent repeated sessions. Raw observations only; no budget/60fps, attributable frame-cost, regression or repaired-performance conclusion.',
    'performance_verdict': 'INCONCLUSIVE: known T13 pass/query attribution remains unresolved, including records whose nominal reliable flag is true.',
    'machine': {'model': pre['hardware']['hw.model'], 'logical_cpu_cores': int(pre['hardware']['hw.logicalcpu']), 'physical_cpu_cores': int(pre['hardware']['hw.physicalcpu']), 'memory_bytes': int(pre['hardware']['hw.memsize']), 'graphics_api': 'ANGLE/Metal configured; owned GPU browser process87371 with Metal flags observed; all10 reports gl=metal and all30 records have nonzero GPU samples.', 'viewport': [1920, 1080]},
    'source_sha256': sha(source), 'export_sha256': sha(export), 'source_commit': source_commit, 'export_commit': source_commit,
    'capture_interval_utc': [session['browser_begin_utc'], session['gpu_end_utc']], 'drain_verified_utc': session['drain_verified_utc'],
    'measurement_sources': pre['measurement_sources'],
    'method_as_reported': 'Unchanged standard harness warmup and adjacent shown/hidden ABBA pairs, starts120 and caps720 by the interval target. Raw GPU-query values, counters, errors and nominal flags retained unchanged. No rerun selected a more favorable outcome.',
    'known_limitations': [
        'T13 pass/query attribution remains unresolved: scene/withoutAsset/asset labels do not establish total or attributable frame cost.',
        'One case per variant/session; no five qualified independent paired runs per lighting case or limiter profile was performed.',
        'This development review scene is not the production24-player/capital budget scenario.',
        'No isolated idle baseline.15-second ps/load snapshots are coarse; ps pcpu is a process-lifetime average and can miss short processes, not instantaneous utilization or per-pair attribution.',
        'Parent permitted performance diagnostic preparation and station source/CPU work. Exact execution intervals were not supplied; no work or host process is assigned to individual timing pairs.',
        'Exclusive GPU authority covered scheduled jobs, not isolation of all user/system compositor, browser, filesystem or other services.',
        'Far clear is the harness ground-line-to-centre result, not a guarantee of full-body/flora visibility. Raw placement/flora counters and full uncropped captures remain available.'
    ],
    'concurrent_context': {'parent_reported_qa_gpu_release_utc': pre['parent_qa_release_utc'], 'parent_reported_final_cleanup_utc': pre['parent_qa_final_cleanup_utc'], 'parent_reported_drained': pre['parent_reported_qa_drained'], 'authorized_parent_cpu_work': pre['parent_authorized_competing_work'], 'observed_unassigned_top_executables': sorted({p['executable'] for s in load['samples'] for p in s['top_cpu_processes']}), 'unrelated_process_arguments_recorded': False, 'native_trace_run_by_this_worker': False},
    'load_evidence': {**item(load_path), 'sample_count': len(load['samples']), 'phases': dict(counts), 'one_minute_load_range': range_of([s['load_average'][0] for s in load['samples']])},
    'session_evidence': item(v / 'ulgani-review4-capture-session.json'),
    'checks': {'fresh_variants': 10, 'lighting_records': 30, 'page_errors': 0, 'nonzero_gpu_sample_records': 30, 'positive_shown_minus_hidden_triangle_work_records': 30, 'raw_nominal_reliable_records': sum(c['asset']['reliable'] for c in records), 'raw_uncertain_records': uncertain},
    'raw_observed_ranges_ms': {'scene_cpu_median': range_of([c['scene']['cpuMsMedian'] for c in records]), 'scene_gpu_median': range_of([c['scene']['gpuMsMedian'] for c in records]), 'paired_asset_cpu': range_of([c['asset']['cpuMs'] for c in records]), 'paired_asset_gpu': range_of([c['asset']['gpuMs'] for c in records]), 'qualification': 'Ranges across30 differently configured variant/light records in one session; not repeated-run spread or validated attributed physical costs.'},
    'raw_reports': reports, 'raw_case_records': records,
}
write('ulgani-review4-performance-context.json', context)
shared = []
for column, people in enumerate(('thalune', 'ixari', 'ulgani'), 1):
    capture = review / people / people / f'{people}_head1/far_lod2.png'
    report_path = capture.with_name('perf.json')
    report = json.loads(report_path.read_text())
    shared.append({'column': column, 'species': people, 'variant': f'{people}_head1', 'source': item(root / f'assets/blend/characters/{people}.blend'), 'export': item(root / f'packages/client/public/models/characters/{people}.glb'), 'capture': item(capture), 'report': item(report_path), 'spots': report['spots'], 'far100': next(x for x in report['far'] if x['range'] == 100)})
write('ulgani-review4-placement-context.json', {'scope': 'Raw placement and far-view records from unmodified captures, not a visual grade.', 'current_ulgani_variants': placement, 'shared_lineup_columns': shared, 'shared_lineups': [item(review / name) for name in ('lineup_far_lod2.png', 'lineup_far_lod2.json', 'lineup_far_lod2_grayscale.png', 'lineup_far_lod2_grayscale.json')], 'limits': ['Shared columns use head1 of Thalune, Ixari, Ulgani in that order; peer captures are frozen fifth packets and Ulgani is the fresh fourth session.', 'Nominal noon-lush,100m,LOD2 does not make distinct sessions/placement offsets/terrain/flora identical. This is a visual comparison, not a controlled timing comparison.', 'Centre120x120 actual pixels are copied at native size and4x nearest. No silhouette/background mask, repositioning, extra rendered angle, zoom or source change.', 'Grayscale directly applies existing lineup.py Rec709 coefficients to captured PNG channels; all20 frozen peer native crops validate within1/255. The initial failed linear-light reference check is retained separately.']})
inventory_path = v / 'ulgani-review4-inventory.json'
inventory = json.loads(inventory_path.read_text())
assert inventory['artifact_count'] == 179 and inventory['source_sha256'] == sha(source) and inventory['export_sha256'] == sha(export)
for record in inventory['artifacts']:
    assert sha(root / record['path']) == record['sha256'], record['path']
validators = []
for kind in ('blend', 'glb'):
    path = v / f'characters__ulgani.{kind}.json'
    data = json.loads(path.read_text())
    assert data['status'] == 'PASS' and data['summary']['fail'] == data['summary']['warn'] == 0
    validators.append({**item(path), 'status': 'PASS', 'checks_passed': 5, 'fail': 0, 'warn': 0})
peer = json.loads((v / 'ixari-review5-grader-packet.json').read_text())
packet = {
    'read_only': True, 'purpose': 'Fresh independent FOURTH visual grade of the current Ulgani component. Read only task/spec/art bible/rubric/artifacts, not worker chat, operational handoff or authoring rationale. Do not edit assets, self-assign a fifth revision, regrade frozen peers or mark the whole three-species task complete.',
    'task': peer['task'], 'component': 'Ulgani, fourth review; shared lineups provide frozen-peer context only.', 'round': 4, 'worktree': str(root), 'spec_refs': peer['spec_refs'],
    'source': {**item(source), 'commit': source_commit}, 'export': {**item(export), 'commit': source_commit}, 'cpu_artifact_checkpoint': pre['head'],
    'inventory': {**item(inventory_path), 'artifact_count': 179}, 'validators': validators,
    'capture_run': item(run_path), 'performance_context': item(v / 'ulgani-review4-performance-context.json'), 'placement_context': item(v / 'ulgani-review4-placement-context.json'),
    'capture_facts': {'variants': 10, 'lighting_records': 30, 'viewport': [1920, 1080], 'graphics_api': 'Metal', 'page_errors': 0, 'raw_reliable_false_records': uncertain, 'qualification': 'All30 nominal flags true is not a performance pass: T13 attribution remains unresolved. Host load and placement limits are recorded without pair-level attribution.'},
    'required_artifacts': inventory['artifacts'],
    'supporting_artifacts': [item(v / name) for name in ('source-audit.json', 'ulgani-review4-performance-context.json', 'ulgani-review4-placement-context.json', 'ulgani-review4-capture-preflight.json', 'ulgani-review4-capture-session.json', 'ulgani-review4-load-samples.json', 'ulgani-review4-lineup-reference-check.json', 'ulgani-review4-lineup-generation.json')] + [item(review / name) for name in ('lineup_far_lod2.png', 'lineup_far_lod2.json', 'lineup_far_lod2_grayscale.png', 'lineup_far_lod2_grayscale.json')],
    'excluded_from_this_grade': ['worker chat/reasoning, operational handoffs and authoring rationale', 'old captures, backups and partial/failure recovery files', 'Ixari and Thalune fifth verdict histories and follow-up tasks; their current-source captures are frozen context', 'a combined three-species completion decision or any performance-repair/60fps conclusion']
}
write('ulgani-review4-grader-packet.json', packet)
print('ULGANI_FOURTH_PACKET_READY', '179required', len(packet['supporting_artifacts']), 'supporting', len(old_items), 'prior captures verified', '30raw records', len(load['samples']), 'load samples')
print('RAW_RANGES', context['raw_observed_ranges_ms'])
print('RAW_UNCERTAIN', uncertain)
