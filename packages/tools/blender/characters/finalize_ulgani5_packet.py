"""Bind the completed fifth Ulgani files; no source, render or browser work."""
from pathlib import Path
import datetime
import hashlib
import json
import platform
import shutil
import subprocess
from PIL import Image

root = Path.cwd()
assert str(root) == '/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41'
assert subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip() == 'task/P1-E05-T01'
validation = root / 'assets/renders/characters/validate'
stage = root / '.claude/pause/characters-resume'
studio = root / 'assets/renders/characters/ulgani-review5'
lineups = root / 'assets/renders/review/characters/ulgani-review5/lineups'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
utc = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()

def read(path):
    return json.loads(Path(path).read_text())

def item(path):
    path = Path(path)
    return {'path': str(path.relative_to(root)), 'sha256': sha(path), 'bytes': path.stat().st_size}

def write(name, value):
    path = validation / name
    assert not path.exists(), f'Preserve existing packet: {path}'
    path.write_text(json.dumps(value, indent=2) + '\n')
    return path

source = root / 'assets/blend/characters/ulgani.blend'
export = root / 'packages/client/public/models/characters/ulgani.glb'
assert sha(source) == '06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b'
assert sha(export) == '9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682'
ready = read(validation / 'ulgani-review5-cpu-ready.json')
cache = read(validation / 'ulgani-review5-browser-cache.json')
drain = read(validation / 'ulgani-review5-capture-drain.json')
variants = [f'ulgani_{kind}{i}' for kind, count in [('head', 6), ('suit', 4)] for i in range(1, count + 1)]
assert list(cache['completed']) == variants and ready['stage_count'] == 16
assert drain['all_pids_groups_profiles_ports_assertions_absent']
assert (stage / 'hold-ulgani5-gpu').exists()
assert not list(stage.glob('gpu-review-release-ulgani5*'))
assert cache['identity']['source_sha256'] == ready['source_sha256'] == sha(source)
assert cache['identity']['export_sha256'] == ready['export_sha256'] == sha(export)
assert sha(validation / 'ulgani-review5-cpu-ready.json') == cache['identity']['cpu_ready_sha256']
prepared = read(validation / 'ulgani-review5-capture-only-preparation.json')
for binding in ready['artifacts'] + ready['dialogue_support']['artifacts'] + prepared['helpers'] + prepared['harness']:
    assert sha(root / binding['path']) == binding['sha256'], binding['path']
peers = []
for species in ('thalune', 'ixari'):
    peer = read(validation / f'{species}-review5-inventory.json')
    for binding in peer['artifacts']:
        assert sha(root / binding['path']) == binding['sha256'], binding['path']
    assert sha(root / f'assets/blend/characters/{species}.blend') == peer['source_sha256']
    assert sha(root / f'packages/client/public/models/characters/{species}.glb') == peer['export_sha256']
    peers.append({'species': species, 'source_sha256': peer['source_sha256'], 'export_sha256': peer['export_sha256'], 'frozen_inventory': item(validation / f'{species}-review5-inventory.json'), 'context_only': True})

required = []
for variant in variants:
    for ending in ('turntable.png', 'materials.png', 'materials.txt'):
        required.append(studio / f'ulgani_ulgani_{variant}_{ending}')
for ending in ('turntable.png', 'materials.png', 'materials.txt', 'heads_family.png', 'heads_family.txt', 'suits_family.png', 'suits_family.txt', 'heads_closeup.png', 'blendshapes.png', 'blendshapes.txt', 'hands_feet.png', 'bendtest_head1.png', 'bendtest_suit3.png'):
    required.append(studio / f'ulgani_{ending}')
assert len(required) == 43
records, raw, placement, sessions, loads, uncertain, gpu_processes = [], [], [], [], [], [], []
for variant in variants:
    entry = cache['completed'][variant]
    assert entry['identity'] == cache['identity'] and entry['status'] == 'FINALIZED_DRAINED'
    assert len(entry['artifacts']) == 13
    for binding in entry['artifacts']:
        assert sha(root / binding['path']) == binding['sha256']
        required.append(root / binding['path'])
    directory = root / entry['outdir']
    path = directory / 'perf.json'
    perf = read(path)
    assert perf['variant'] == variant and perf['file'] == 'characters/ulgani'
    assert perf['gl'] == 'metal' and perf['viewport'] == [1920, 1080] and perf['errors'] == []
    assert {x['case'] for x in perf['perf']} == {'noon-lush', 'night-exotic', 'open-space'}
    placement.append({'variant': variant, 'report': item(path), 'spots': perf['spots'], 'far': perf['far'], 'overlay': perf['overlay']})
    raw.append(item(path))
    for case in perf['perf']:
        assert case['asset']['pairs'] > 0 and case['scene']['gpuSamples'] > 0
        assert case['scene']['triangles'] > case['withoutAsset']['triangles']
        records.append({'variant': variant, 'report_sha256': sha(path), **case})
        if not case['asset']['reliable']:
            uncertain.append({'variant': variant, 'case': case['case'], 'pairs': case['asset']['pairs'], 'ci95': case['asset']['gpuMsCi95'], 'ci_target_ms': case['asset']['ciTargetMs']})
    if variant == 'ulgani_head1':
        load_path = validation / 'ulgani-review5-head1-attempt1-load.json'
        session = {'variant': variant, 'started_utc': entry['started_utc'], 'cli_end_utc': entry['cli_end_utc'], 'original_controller_status': 'FAILED_PRESERVED_NO_AUTOMATIC_RETRY', 'adoption': item(validation / 'ulgani-review5-head1-recovery.json'), 'rerendered': False, 'active_vite_port': 'Not observed; exact original port unavailable.'}
    else:
        evidence = validation / 'ulgani-review5-capture' / variant
        load_path = evidence / 'load-samples.json'
        boundary = read(evidence / 'external-boundary.json')
        session = {'variant': variant, 'started_utc': entry['started_utc'], 'cli_end_utc': entry['cli_end_utc'], 'finalized_utc': entry['finalized_utc'], 'boundary': item(evidence / 'external-boundary.json'), 'controller_exit_code': 0, 'observed_ports': boundary['port_results']}
    session.update(controller_pid=entry['controller_pid'], controller_pgid=entry['controller_pgid'], capture_command=entry['command'], preparation_sha256=entry['preparation_sha256'], capture_helper_sha256=('8ad21d3e8df837960413079b988d22dcf6d72611211821d800674e07f3f09358' if variant == 'ulgani_head1' else prepared['helpers'][0]['sha256']), source_export_harness_identity=entry['identity'])
    load = read(load_path)
    loads.append({'variant': variant, **item(load_path), 'sample_count': len(load['samples'])})
    sessions.append(session)
    for sample in load['samples']:
        for process in sample['processes']:
            if '--type=gpu-process' in process['command']:
                gpu_processes.append({'variant': variant, 'pid': process['pid'], 'pgid': process['pgid'], 'sample_utc': sample['utc'], 'metal_argument_observed': '--use-angle=metal' in process['command']})
assert len(records) == 30
for suffix in ('', '_grayscale'):
    required.extend(lineups / f'ulgani_lineup_far_lod2{suffix}.{ext}' for ext in ('png', 'json'))
validators = []
for name, dependency in [('ulgani-review5-source-validation-final.json', source), ('ulgani-review5-export-validation.json', export)]:
    path = validation / name
    report = read(path)
    assert report['file'] == str(dependency.relative_to(root)) and report['status'] == 'PASS' and report['error'] is None
    assert report['summary']['checks'] == dict.fromkeys(('naming', 'triangles', 'lods', 'materials', 'scale'), 'PASS')
    assert report['summary']['fail'] == report['summary']['warn'] == 0
    validators.append({**item(path), 'input_sha256': sha(dependency), 'status': 'PASS', 'checks_passed': 5, 'fail': 0, 'warn': 0})
    required.append(path)
assert len(required) == len(set(required)) == 179
artifacts = []
for path in required:
    entry = item(path)
    if path.suffix == '.png':
        with Image.open(path) as image:
            image.load()
            entry['dimensions'] = list(image.size)
            entry['independent_png_decode'] = True
    artifacts.append(entry)
inventory_path = write('ulgani-review5-inventory.json', {'note': 'Completeness and exact content/source binding, not a visual grade. Fresh fifth paths are explicit; no legacy flat-path alias or fabricated CLI run.', 'round': 5, 'verified_utc': utc(), 'source_sha256': sha(source), 'export_sha256': sha(export), 'cpu_ready': item(validation / 'ulgani-review5-cpu-ready.json'), 'browser_cache': item(validation / 'ulgani-review5-browser-cache.json'), 'artifact_count': 179, 'artifacts': artifacts, 'independent_png_decode_count': sum('independent_png_decode' in x for x in artifacts)})

all_samples = [sample for evidence in loads for sample in read(root / evidence['path'])['samples']]
range_of = lambda values: [min(values), max(values)]
performance_path = write('ulgani-review5-performance-context.json', {
    'scope': 'Ten bounded variant browser sessions, each variant/light once. Raw observations only; adaptive pairs within a case are not five independent qualified sessions.',
    'qualification': 'INCONCLUSIVE: T13 pass/query attribution unresolved. No qualified60fps, scene-budget, attributable frame-cost or asset-regression conclusion.',
    'identity': cache['identity'], 'viewport': [1920, 1080], 'graphics_api': 'ANGLE/Metal configured; owned GPU process and Metal argument observed. No native GPU-utilization or browser physical-device renderer-string probe.',
    'host': {'platform': platform.platform(), **{name: subprocess.check_output(['sysctl', '-n', name], text=True).strip() for name in ('hw.model', 'hw.logicalcpu', 'hw.physicalcpu', 'hw.memsize', 'machdep.cpu.brand_string')}},
    'intervals': sessions, 'full_gpu_release_utc': drain['gpu_release_utc'],
    'parent_authorized_cpu_context': ['Head1: station CPU2D montage/hashpacket and native CPU artifact analysis.', 'Remaining9: visual graders and performance reviewer CPU-only. Exact execution intervals were not instrumented by this worker; no pair-level attribution.'],
    'limitations': ['Known T13 scene/withoutAsset/asset query labels do not establish total or attributable physical frame cost, including nominal reliable=true records.', 'One session per variant, not five independent qualified paired runs per lighting case; no isolated idle baseline or limiter experiment.', 'Development review scene is not the production24-player/capital budget scenario.', 'Host load/ps snapshots are coarse15second observations; ps pcpu is process-lifetime average, can miss short processes and cannot attribute individual pairs.', 'Exclusive scheduling covers owned jobs, not unrelated T3 browsers, system compositor or other applications. External process arguments are omitted.', 'Original Head1 controller failed after Node0 due to a completed/reaped observer row;13successful files were independently adopted without rerender. Original FAILED evidence remains preserved.', 'Head1 active Vite port was not observed; remaining9 active ports and their absence were directly recorded.'],
    'observed_unassigned_top_executables': sorted({p['executable'] for sample in all_samples for p in sample['top_cpu_processes']}),
    'load_sample_count': len(all_samples), 'one_minute_load_range': range_of([x['load_average'][0] for x in all_samples]), 'test_related_snapshot_count': sum(bool(x['test_related_processes']) for x in all_samples), 'load_evidence': loads,
    'owned_gpu_process_observations': gpu_processes, 'raw_nominal_reliable_false': uncertain,
    'raw_ranges_ms': {'scene_gpu_median': range_of([x['scene']['gpuMsMedian'] for x in records]), 'scene_cpu_median': range_of([x['scene']['cpuMsMedian'] for x in records]), 'paired_asset_gpu': range_of([x['asset']['gpuMs'] for x in records]), 'qualification': 'Across differently configured variant/light records, not repeated-run spread or attributed costs.'},
    'raw_reports': raw, 'raw_case_records': records,
})
shared = []
for species in ('thalune', 'ixari', 'ulgani'):
    path = root / ('assets/renders/review/characters/' + (f'ulgani-review5/attempt-01/ulgani/{species}_head1' if species == 'ulgani' else f'{species}/{species}/{species}_head1'))
    perf = read(path / 'perf.json')
    shared.append({'species': species, 'variant': species + '_head1', 'capture': item(path / 'far_lod2.png'), 'report': item(path / 'perf.json'), 'far100': next(x for x in perf['far'] if x['range'] == 100), 'frozen_peer_context_only': species != 'ulgani'})
placement_path = write('ulgani-review5-placement-context.json', {'lineup_method': 'Lossless2D color pixel composition from existing100m screenshots;4x nearest copy. Grayscale is the existing Rec709 channel conversion. No fresh3D render.', 'current_ulgani_variants': placement, 'shared_columns': shared, 'frozen_peers': peers, 'limits': ['Shared columns are frozen Thalune head1, frozen Ixari head1, fresh Ulgani head1. They are visual context, not new peer grades or a controlled timing comparison.', 'Nominal100m/LOD2/noon-lush does not make separate placement offsets, terrain, flora or sessions identical.', 'Centre120x120 pixels are copied at native size and4x nearest. No mask, repositioning, exposure, silhouette edit or new camera/render.', 'The lineup preserves its input screenshot scale/neutral pose only; it is not a shared3D-stage scale calibration, new deformation test or animation coverage.', 'Far clear is the harness ground-line-to-centre result, not full-body/flora visibility. Full uncropped100m/200m captures and placement counters remain available.', 'Grayscale uses existing lineup.py Rec709 coefficients directly on captured PNG channels; no linear-light correction.']})
provenance_path = write('ulgani-review5-render-provenance.json', {'identity': cache['identity'], 'source_export_commit': 'ef78fa7fae8634912a210adc20b48139fd8e0de7', 'cpu_artifact_commit': '6f7c74886a7801b3f73c5712c84b2733df9bdc3a', 'browser_artifact_commit': 'd4f0dcb37094e8a32e17d480d2ea9298cc9bf0bc', 'cpu': {'device': ready['device'], 'threads': ready['threads'], 'quality': ready['quality'], 'stage_count': ready['stage_count'], 'ready': item(validation / 'ulgani-review5-cpu-ready.json'), 'stages': item(validation / 'ulgani-review5-cpu-stages.json')}, 'browser': {'api_wrapper': prepared['helpers'][2], 'capture_helper': prepared['helpers'][0], 'sampler': prepared['helpers'][1], 'harness': prepared['harness'], 'variants': variants, 'files': 130, 'raw_lighting_records': 30, 'page_errors': 0, 'sessions': sessions}, 'lineups': item(validation / 'ulgani-review5-lineup-generation.json'), 'dialogue': item(validation / 'ulgani-review5-dialogue.json'), 'dialogue_limit': 'Offline native-cell and160px-fit composition from full-resolution sheet. No integrated dialogue playback or fitness acceptance claim.', 'all_owned_jobs_drained': True})
lineup_helper = validation / 'ulgani-review5-lineup-helper.py'
assert not lineup_helper.exists()
shutil.copy2(stage / 'lineup_cpu_png.py', lineup_helper)
assert sha(lineup_helper) == read(validation / 'ulgani-review5-lineup-generation.json')['helper']['sha256']
support_paths = [root / x['path'] for x in ready['artifacts'] + ready['dialogue_support']['artifacts'] if root / x['path'] not in required]
support_paths += [validation / 'ulgani-review5-cpu-ready.json', validation / 'ulgani-review5-cpu-stages.json', validation / 'ulgani-review5-dialogue.json', validation / 'ulgani-review5-lineup-generation.json', lineup_helper, performance_path, placement_path, provenance_path]
support_paths += [lineups / f'lineup_far_lod2{suffix}.{ext}' for suffix in ('', '_grayscale') for ext in ('png', 'json')]
support_paths = list(dict.fromkeys(support_paths))
spec_refs = {'design': 'docs/DESIGN.md sections5 and19.2', 'art_bible': 'docs/art-bible.md', 'rubric': 'docs/IMPLEMENTATION_PLAN.md section0.10.2', 'grader_input_rules': 'docs/IMPLEMENTATION_PLAN.md section0.10.3'}
packet_path = write('ulgani-review5-grader-packet.json', {'read_only': True, 'purpose': 'Fresh independent FIFTH visual grade of current Ulgani. Use only task/spec/art bible/rubric/artifacts and factual provenance/limits. Do not edit assets or grade frozen peer context.', 'task': 'P1.E05.T01 (art) Shared skeleton and three base bodies · deps:E14.T02 · spec:DESIGN5,19.2 · done: assets/blend/characters/ with one skeleton, Thalune, Ixari and Ulgani bodies (LOD0 60–150k tris,4 LODs,4k PBR), facial blendshapes, six head or crest variants each, four suit sets each. verify: pnpm art:validate -- characters; turntables; review scene.', 'component': 'Ulgani', 'round': 5, 'worktree': str(root), 'spec_refs': spec_refs, 'spec_files': [item(root / name) for name in ('docs/DESIGN.md', 'docs/art-bible.md', 'docs/IMPLEMENTATION_PLAN.md')], 'source': {**item(source), 'commit': 'ef78fa7fae8634912a210adc20b48139fd8e0de7'}, 'export': {**item(export), 'commit': 'ef78fa7fae8634912a210adc20b48139fd8e0de7'}, 'artifact_commits': {'cpu': '6f7c74886a7801b3f73c5712c84b2733df9bdc3a', 'browser': 'd4f0dcb37094e8a32e17d480d2ea9298cc9bf0bc'}, 'inventory': {**item(inventory_path), 'artifact_count': 179}, 'validators': validators, 'performance_context': item(performance_path), 'placement_context': item(placement_path), 'render_provenance': item(provenance_path), 'required_artifacts': artifacts, 'supporting_artifacts': [item(p) for p in support_paths], 'capture_facts': {'variants': 10, 'lighting_records': 30, 'viewport': [1920, 1080], 'page_errors': 0, 'raw_reliable_false_records': uncertain, 'timing_qualification': 'T13 attribution unresolved; nominal flags do not qualify performance.'}, 'view_coverage': ['All six heads/four suits turntables/materials/standard engine sheets;three lights,LOD0/2,wireframes,overlays,100m/200m.', 'Family/closeup/detail/hands-feet/morph/native-FV-MBP/160px compositions and both deformation sheets.', 'Fresh Ulgani color/grayscale distance lineups and three-species lineups;peers are frozen context only.'], 'excluded_inputs': ['Worker reasoning/reports, operational handoffs and authoring rationale.', 'Prior verdict text or previous-round images as current Ulgani evidence.', 'A peer regrade, combined task-completion decision or unsupported performance conclusion.']})
print('ULGANI5_PACKET_READY', utc(), 'required', len(artifacts), 'supporting', len(support_paths), 'independent PNGs', sum('independent_png_decode' in x for x in artifacts), 'raw unreliable', len(uncertain), 'packet SHA', sha(packet_path), flush=True)
