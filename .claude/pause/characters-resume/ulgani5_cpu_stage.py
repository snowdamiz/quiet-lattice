"""One bounded review-artifact stage; never opens GPU/browser gates or saves a source."""
from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess, sys, time

root = Path.cwd()
assert str(root) == '/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41'
assert subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip() == 'task/P1-E05-T01'
stage = root / '.claude/pause/characters-resume'
validation = root / 'assets/renders/characters/validate'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
source = root / 'assets/blend/characters/ulgani.blend'
export = root / 'packages/client/public/models/characters/ulgani.glb'
frozen = json.loads((stage / 'ulgani5-preflight-frozen-hashes.json').read_text())['hashes']
def verify_frozen():
    for path, digest in frozen.items():
        assert sha(root / path) == digest, path
    assert not (stage / 'gpu-review-release-ulgani').exists()
    assert not (stage / 'gpu-review-release-ixari5').exists()
    assert not (stage / 'gpu-release-ulgani5-bake').exists()
    assert not (stage / 'hold-ulgani5-cpu').exists(), 'Parent CPU boundary hold is active'

verify_frozen()
key = sys.argv[1]
binary = '/Applications/Blender.app/Contents/MacOS/Blender'
detail = [binary, '-b', str(source), '-t', '2', '--python-exit-code', '1', '-P', 'packages/tools/blender/characters/render_details.py', '--']
table = [binary, '-b', '--factory-startup', '-t', '2', '--python-exit-code', '1', '-P', 'packages/tools/blender/characters/cpu_turntables.py', '--']
out = root / 'assets/renders/characters/ulgani-review5'
out.mkdir(parents=True,exist_ok=True)
manifest = None
render_input = source
if key == 'portraits':
    command = detail + ['portraits', 'CPU', 'ulgani', str(out)]
    artifacts = [out / f'ulgani_{suffix}' for suffix in ('heads_closeup.png', 'blendshapes.png', 'blendshapes.txt', 'hands_feet.png')]
elif key in ('bend-head1', 'bend-suit3'):
    variant = key.split('-')[1]
    artifacts = [out / f'ulgani_bendtest_{variant}.png']
    command = detail + ['bendtest', 'CPU', 'ulgani', variant, str(artifacts[0])]
elif key in [f'{kind}{n}' for kind, count in (('head', 6), ('suit', 4)) for n in range(1, count + 1)]:
    manifest = validation / f'ulgani-review5-cpu-{key}-turntable.json'
    command = table + [str(source), str(out), '--samples', '48', '--variant', f'ulgani_{key}', '--manifest', str(manifest)]
    artifacts = [out / f'ulgani_ulgani_ulgani_{key}_{suffix}' for suffix in ('turntable.png', 'materials.png', 'materials.txt')]
elif key == 'grid':
    manifest = validation / 'ulgani-review5-grid-turntables.json'
    command = table + [str(source), str(out), '--samples', '48', '--grid', '10', '--manifest', str(manifest)]
    artifacts = [out / f'ulgani_{suffix}' for suffix in ('turntable.png', 'materials.png', 'materials.txt')]
elif key in ('heads', 'suits'):
    render_input = stage / 'ulgani5-review-cache' / f'ulgani_{key}.blend'
    info = json.loads(render_input.with_suffix('.json').read_text())
    assert info['source_sha256'] == sha(source) and info['copy_sha256'] == sha(render_input)
    manifest = validation / f'ulgani-review5-{key}-family.json'
    command = table + [str(render_input), str(out), '--samples', '48', '--family', '--manifest', str(manifest)]
    artifacts = [out / f'ulgani_{key}_family.{ext}' for ext in ('png', 'txt')]
else:
    raise ValueError(key)
if manifest:
    artifacts.append(manifest)
scripts = {p: sha(root / p) for p in ('packages/tools/blender/characters/render_details.py', 'packages/tools/blender/characters/cpu_turntables.py', 'packages/tools/blender/turntable.py')}
progress = validation / 'ulgani-review5-cpu-stages.json'
record = json.loads(progress.read_text()) if progress.exists() else {'source_commit': 'ef78fa7fae8634912a210adc20b48139fd8e0de7', 'source_sha256': sha(source), 'export_sha256': sha(export), 'device': 'CPU', 'threads': 2, 'quality': 'Unchanged standard cameras/resolution/lighting; turntables48, portraits48/morphs32, bends24 samples from embedded scripts.', 'steps': []}
assert record['source_sha256'] == sha(source) and record['export_sha256'] == sha(export)
prior = next((x for x in record['steps'] if x['key'] == key), None)
if prior:
    assert prior['exit_code'] == 0 and prior['scripts'] == scripts
    assert all(sha(root / p['path']) == p['sha256'] for p in prior['artifacts'])
    print('ULGANI_CPU_STAGE_VERIFIED_COMPLETE', key, flush=True)
    sys.exit(0)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = stage / 'ulgani5-prior-artifacts' / f'{key}-{stamp}'
backup.mkdir(parents=True, exist_ok=False)
old = []
for path in artifacts:
    if path.exists():
        dest = backup / path.name
        shutil.copy2(path, dest)
        assert sha(dest) == sha(path)
        old.append({'path': str(path.relative_to(root)), 'sha256': sha(path), 'backup': str(dest.relative_to(root))})
(backup / 'manifest.json').write_text(json.dumps(old, indent=2) + '\n')
tmp = out / f'.{render_input.stem}_tmp'
if tmp.exists():
    shutil.move(str(tmp), str(backup / 'interrupted-ulgani-tmp'))
log = stage / f'ulgani5-cpu-{key}-{stamp}.log'
jobpath = stage / f'ulgani5-cpu-{key}-job.json'
assert not jobpath.exists(), 'Preserve any prior failed job record before retrying'
event = {'key': key, 'utc': now(), 'controller_pid': os.getpid(), 'controller_pgid': os.getpgrp(), 'command': command, 'cwd': str(root), 'source_sha256': sha(source), 'export_sha256': sha(export), 'render_input': str(render_input.relative_to(root)), 'render_input_sha256': sha(render_input), 'device': 'CPU', 'threads': 2, 'scripts': scripts, 'runner_sha256': sha(Path(__file__)), 'log': str(log.relative_to(root)), 'backup': str(backup.relative_to(root)), 'status': 'starting', 'timeout_seconds': 900}
def save():
    jobpath.write_text(json.dumps(event, indent=2) + '\n')
    apath=stage/'ACTIVE_SOL_RESUME.json'
    active=json.loads(apath.read_text());active['updated_utc']=now();active['status']='Ulgani fifth CPU '+key+': '+event['status'];active['live_jobs']=[{'job':str(jobpath),'controller_pid':os.getpid(),'event':event}] if event['status'] in ('starting','running') else [];active['ulgani5_cpu_current_stage']=event;apath.write_text(json.dumps(active,indent=2)+'\n')
save()
env = {**os.environ, 'OPENBLAS_NUM_THREADS': '2', 'OMP_NUM_THREADS': '2'}
env.pop('ONLY_HF', None)
start = time.monotonic()
with log.open('w') as output:
    child = subprocess.Popen(command, cwd=root, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    event.update(pid=child.pid, pgid=os.getpgid(child.pid), status='running')
    assertion = subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(child.pid)], start_new_session=True)
    event['caffeinate_pid'] = assertion.pid
    event['caffeinate_pgid'] = os.getpgid(assertion.pid)
    save()
    print('ULGANI_CPU_STAGE_BEGIN', json.dumps(event), flush=True)
    try:
        code = child.wait(timeout=900)
    except subprocess.TimeoutExpired:
        import signal
        event['timeout_utc'] = now()
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        code = 124
    event['render_end_utc'] = now()
    event['exit_code'] = code
    event['caffeinate_exit_code'] = assertion.wait(timeout=30)
event['completed_utc'] = now()
event['duration_seconds'] = round(time.monotonic() - start, 2)
event['timing_scope'] = 'Scheduling record only; functional art generation, no performance claim.'
event['log_sha256'] = sha(log)
event['status'] = 'failed' if code else 'render complete; verifying'
save()
assert code == 0, f'Render failed; see {log}'
verify_frozen()
event['artifacts'] = []
for path in artifacts:
    assert path.stat().st_mtime >= datetime.datetime.fromisoformat(event['utc']).timestamp(), path
    event['artifacts'].append({'path': str(path.relative_to(root)), 'sha256': sha(path), 'bytes': path.stat().st_size})
event['status'] = 'complete; renderer and idle assertion exited; controller draining'
save()
record['steps'].append(event)
record['updated_utc'] = now()
progress.write_text(json.dumps(record, indent=2) + '\n')
print('ULGANI_CPU_STAGE_END', key, event['completed_utc'], flush=True)
