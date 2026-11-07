"""One browser capture after parent GPU GO; --verify-only launches no runtime.

All16 CPU stages must already be complete and hash-bound. Never calls Blender,
bakes, authors geometry, saves .blend, exports, or renders a cached CPU stage.
"""
from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess, sys, time

root = Path.cwd()
assert str(root) == '/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41'
assert subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip() == 'task/P1-E05-T01'
stage = root / '.claude/pause/characters-resume'
validation = root / 'assets/renders/characters/validate'
release = stage / 'gpu-review-release-ulgani5'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
source = root / 'assets/blend/characters/ulgani.blend'
export = root / 'packages/client/public/models/characters/ulgani.glb'
ready_path = validation / 'ulgani-review5-cpu-ready.json'
expected_keys = ['portraits'] + [f'{kind}{n}' for kind, count in (('head', 6), ('suit', 4)) for n in range(1, count + 1)] + ['grid', 'heads', 'suits', 'bend-head1', 'bend-suit3']

def verify():
    ready = json.loads(ready_path.read_text())
    assert ready['stage_count'] == 16 and ready['required_cpu_keys'] == expected_keys and len(ready['artifacts']) == 61
    assert not (stage / 'gpu-review-release-ulgani').exists()
    assert not (stage / 'gpu-release-ulgani5-bake').exists()
    support=ready['dialogue_report_binding'];assert sha(root/support['path'])==support['sha256']
    for item in ready['dialogue_support']['artifacts']:assert sha(root/item['path'])==item['sha256']
    assert ready['source_sha256'] == sha(source) == '06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b'
    assert ready['export_sha256'] == sha(export) == '9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682'
    cache = ready['cpu_stage_record']
    assert sha(root / cache['path']) == cache['sha256']
    cpu = json.loads((root / cache['path']).read_text())
    assert [x['key'] for x in cpu['steps']] == expected_keys
    for event in cpu['steps']:
        assert event['exit_code'] == event['controller_exit_code'] == event['caffeinate_exit_code'] == 0
        assert event['drain_verified_utc'] and event['device'] == 'CPU' and event['threads'] == 2
        for item in event['artifacts']:
            assert sha(root / item['path']) == item['sha256'], item['path']
    for item in ready['artifacts']:
        assert sha(root / item['path']) == item['sha256'], item['path']
    assert not (stage / 'gpu-review-release-ixari5').exists()
    return ready, cpu

assert sys.argv[1:] in ([], ['--verify-only'])
ready, cpu = verify()
if sys.argv[1:] == ['--verify-only']:
    print('ULGANI_CAPTURE_ONLY_VERIFIED', len(cpu['steps']), 'cached CPU stages;', len(ready['artifacts']), 'artifact hashes; no render/browser process launched', flush=True)
    sys.exit(0)
print('WAITING_FOR_ULGANI_REVIEW_GPU', release, flush=True)
gate_deadline=time.monotonic()+900
while not release.exists():
    assert time.monotonic()<gate_deadline,'GPU gate was not released within900seconds;no browser started'
    time.sleep(1)
ready, cpu = verify()
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = stage / f'ulgani5-before-browser-{stamp}'
backup.mkdir(exist_ok=False)
old = root / 'assets/renders/review/characters/ulgani'
if old.exists():
    shutil.copytree(old, backup / 'ulgani')
manifest = validation / 'ulgani-review5-run.json'
if manifest.exists():
    shutil.copy2(manifest, backup / manifest.name)
evidence = {'source_sha256': ready['source_sha256'], 'export_sha256': ready['export_sha256'], 'cpu_ready_sha256': sha(ready_path), 'cpu_stage_record_sha256': ready['cpu_stage_record']['sha256'], 'note': 'All16 CPU stages reused by verified hashes. Only one browser capture runs in this window; raw timing has unresolved pass/query attribution and proves no scene-budget or performance repair.', 'steps': cpu['steps'].copy(), 'prior_capture_backup': str(backup.relative_to(root))}
event = {'utc': now(), 'command': ['pnpm', 'capture', '--', '--review', 'characters/ulgani']}
print('ULGANI5_GPU_BEGIN', event['utc'], flush=True)
print('ULGANI5_BROWSER_CAPTURE_BEGIN', event['utc'], flush=True)
try:
    child = subprocess.Popen(event['command'], cwd=root, env={**os.environ, 'OPENBLAS_NUM_THREADS': '2', 'OMP_NUM_THREADS': '2'})
    event.update(pid=child.pid, pgid=os.getpgid(child.pid))
    print(json.dumps(event), flush=True)
    try:
        event['exit_code'] = child.wait(timeout=2400)
    except subprocess.TimeoutExpired:
        event['timeout_utc']=now();child.terminate()
        try:child.wait(timeout=15)
        except subprocess.TimeoutExpired:child.kill();child.wait()
        event['exit_code']=124
finally:
    event['completed_utc'] = now()
    evidence['steps'].append(event)
    manifest.write_text(json.dumps(evidence, indent=2) + '\n')
    print('ULGANI5_GPU_END', event['completed_utc'], flush=True)
assert event.get('exit_code') == 0, 'Capture failed; preserve all errors and drain the owned browser/sampler/assertion before releasing GPU'
assert sha(source) == ready['source_sha256'] and sha(export) == ready['export_sha256']
