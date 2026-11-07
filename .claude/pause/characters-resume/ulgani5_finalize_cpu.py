"""Consolidate current-source CPU review evidence without launching Blender or a browser."""
from pathlib import Path
import datetime, hashlib, json, shutil, struct, subprocess
root = Path.cwd()
assert str(root) == '/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41'
assert subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip() == 'task/P1-E05-T01'
stage = root / '.claude/pause/characters-resume'
validation = root / 'assets/renders/characters/validate'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
frozen = json.loads((stage / 'ulgani5-preflight-frozen-hashes.json').read_text())['hashes']
for path, digest in frozen.items():
    assert sha(root / path) == digest, path
for people in ('thalune', 'ixari'):
    inv = json.loads((validation / f'{people}-review5-inventory.json').read_text())
    for item in inv['artifacts']:
        assert sha(root / item['path']) == item['sha256'], item['path']
active = json.loads((stage / 'ACTIVE_SOL_RESUME.json').read_text())
assert active['live_jobs'] == []
for item in active['preserved_textures']:
    assert sha(root / item['path']) == item['sha256'], item['path']
for path, digest in {'ulgani_before_bake.blend': 'ac217344d5aa07b28f133045b0357506c0d0693b5223bed1b83fbbf0f16247be', 'ulgani.blend': '9e3f5218c9ba897cb99fd662682aad1b4530759085d9c8b0d96579869a71a437'}.items():
    assert sha(stage / path) == digest, path
variants = [f'{kind}{n}' for kind, count in (('head', 6), ('suit', 4)) for n in range(1, count + 1)]
studio_keys = variants + ['grid', 'heads', 'suits']
keys = ['portraits'] + studio_keys + ['bend-head1', 'bend-suit3']
progress = validation / 'ulgani-review5-cpu-stages.json'
record = json.loads(progress.read_text())
assert len(record['steps']) == len(keys) == 16
steps = {event['key']: event for event in record['steps']}
assert set(steps) == set(keys)
artifacts = {}
for key in keys:
    event = steps[key]
    assert event['device'] == 'CPU' and event['threads'] == 2
    assert event['exit_code'] == event['controller_exit_code'] == event['caffeinate_exit_code'] == 0
    assert event['drain_verified_utc']
    assert key == 'portraits' or event.get('visual_inspected_utc'), key
    assert event['source_sha256'] == record['source_sha256'] and event['export_sha256'] == record['export_sha256']
    assert sha(root / event['render_input']) == event['render_input_sha256']
    assert sha(root / event['log']) == event['log_sha256']
    for path, digest in event['scripts'].items():
        assert sha(root / path) == digest, path
    for item in event['artifacts']:
        path = root / item['path']
        assert sha(path) == item['sha256'] and path.stat().st_size == item['bytes'], path
        assert path.stat().st_mtime >= datetime.datetime.fromisoformat(event['utc']).timestamp(), path
        artifacts[item['path']] = item
        if path.suffix == '.png':
            data = path.read_bytes()
            assert data[:8] == b'\x89PNG\r\n\x1a\n'
            item['dimensions'] = list(struct.unpack('>II', data[16:24]))
assert not (stage / 'gpu-review-release-ulgani').exists()
assert not (stage / 'gpu-review-release-ixari5').exists()
backup = stage / 'ulgani5-prior-artifacts' / ('consolidation-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir()
backup_items = []
def write(name, value):
    path = validation / name
    if path.exists():
        target = backup / name
        shutil.copy2(path, target)
        backup_items.append({'path': str(path.relative_to(root)), 'sha256': sha(path), 'backup': str(target.relative_to(root))})
    path.write_text(json.dumps(value, indent=2) + '\n')
    artifacts[str(path.relative_to(root))] = {'path': str(path.relative_to(root)), 'sha256': sha(path), 'bytes': path.stat().st_size}
sheets = []
for variant in variants:
    data = json.loads((validation / f'ulgani-review5-cpu-{variant}-turntable.json').read_text())
    assert Path(data['source']) == root / 'assets/blend/characters/ulgani.blend' and len(data['sheets']) == 1
    assert data['sheets'][0]['target'] == ['ulgani', f'ulgani_{variant}']
    sheets.extend(data['sheets'])
write('ulgani-review5-turntables.json', {'source': str(root / 'assets/blend/characters/ulgani.blend'), 'source_sha256': record['source_sha256'], 'targets': [['ulgani', f'ulgani_{v}'] for v in variants], 'sheets': sheets})
base = {'source_commit': record['source_commit'], 'source_sha256': record['source_sha256'], 'export_sha256': record['export_sha256'], 'device': 'CPU', 'threads': 2, 'quality': record['quality'], 'completed_utc': steps['bend-suit3']['completed_utc'], 'verified_utc': now, 'note': 'Current-source CPU artifacts only; no visual grade or performance conclusion. All owned processes drained at each recorded boundary.'}
write('ulgani-review5-cpu-studio.json', {**base, 'samples': 48, 'steps': [steps[k] for k in studio_keys]})
write('ulgani-review5-cpu-details.json', {**base, 'steps': [steps[k] for k in ('portraits', 'bend-head1', 'bend-suit3')], 'artifacts': [a for k in ('portraits', 'bend-head1', 'bend-suit3') for a in steps[k]['artifacts']]})
for kind in ('blend', 'glb'):
    path = validation / {'blend':'ulgani-review5-source-validation-final.json','glb':'ulgani-review5-export-validation.json'}[kind]
    data = json.loads(path.read_text())
    assert data['status'] == 'PASS' and data['summary']['fail'] == data['summary']['warn'] == 0
    assert data['summary']['checks'] == dict.fromkeys(('naming', 'triangles', 'lods', 'materials', 'scale'), 'PASS')
    artifacts[str(path.relative_to(root))] = {'path': str(path.relative_to(root)), 'sha256': sha(path), 'bytes': path.stat().st_size}
ready = {**base, 'round': 5, 'required_cpu_keys': keys, 'stage_count': 16, 'studio_stage_count': 13, 'detail_stage_count': 3, 'cpu_stage_record': {'path': str(progress.relative_to(root)), 'sha256': sha(progress)}, 'artifacts': list(artifacts.values()), 'frozen_peer_inventory_hashes_verified': {'thalune': 179, 'ixari': 179}, 'raw_checkpoint_maps_verified': True, 'live_jobs': [], 'gpu_browser_authorized': False, 'remaining': ['fresh browser capture under all standard lighting/LOD/wire/overlay/distance cases', 'per-species and shared current-source distance lineups', 'actual load context and qualified interpretation of raw capture records', 'complete179-artifact inventory', 'fresh independent fifth Ulgani grade', 'final code review and parent orchestration']}
assert len(artifacts) == 61
ready['dialogue_support'] = json.loads((validation / 'ulgani-review5-dialogue.json').read_text())
for item in ready['dialogue_support']['artifacts']:
    assert sha(root / item['path']) == item['sha256']
ready['dialogue_report_binding'] = {'path': str((validation / 'ulgani-review5-dialogue.json').relative_to(root)), 'sha256': sha(validation / 'ulgani-review5-dialogue.json')}
ready['source_export_proof'] = {'path': str((validation / 'ulgani-review5-source-export.json').relative_to(root)), 'sha256': sha(validation / 'ulgani-review5-source-export.json')}
ready['review_copies'] = {}
for kind in ('heads', 'suits'):
    path = stage / 'ulgani5-review-cache' / f'ulgani_{kind}.json'
    info = json.loads(path.read_text())
    assert info['source_sha256'] == record['source_sha256'] and sha(Path(info['copy'])) == info['copy_sha256']
    ready['review_copies'][kind] = info
bake_report = json.loads((validation / 'ulgani-review5-material-bake2.json').read_text())
for step in bake_report['steps']:
    assert sha(Path(step['checkpoint'])) == step['checkpoint_sha256']
    for item in step['maps']:
        assert sha(Path(item['path'])) == item['sha256'] and item['decoded_finite'] and item['size'] == [4096, 4096]
ready['fifth_bake_maps_and_checkpoints_reverified'] = True
ready['bake_proof'] = {'path': str((validation / 'ulgani-review5-material-bake2-boundary.json').relative_to(root)), 'sha256': sha(validation / 'ulgani-review5-material-bake2-boundary.json')}
ready['rendered_cpu_root'] = 'assets/renders/characters/ulgani-review5'
ready['limitations'] = 'CPU functional artifacts only;worker appearance observations are separate;no fifth visual verdict,engine dialogue playback,60fps,budget or performance regression claim. Old fourth CPU pixels were not reused.'
(validation / 'ulgani-review5-cpu-ready.json').write_text(json.dumps(ready, indent=2) + '\n')
(backup / 'manifest.json').write_text(json.dumps(backup_items, indent=2) + '\n')
print('ULGANI_REVIEW5_CPU_READY', len(keys), 'stages', len(artifacts), 'artifact hashes; frozen peers179/179 each; no runtime started')
