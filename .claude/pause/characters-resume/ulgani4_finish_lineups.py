"""Bounded CPU PNG lineups, then the existing complete-artifact inventory."""
from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess, sys, time

root = Path.cwd()
stage = root / '.claude/pause/characters-resume'
validation = root / 'assets/renders/characters/validate'
review = root / 'assets/renders/review/characters'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
assert str(root) == '/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41'
assert subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip() == 'task/P1-E05-T01'
assert not (stage / 'gpu-review-release-ulgani').exists()
assert not (stage / 'gpu-review-release-ixari5').exists()
session = json.loads((validation / 'ulgani-review4-capture-session.json').read_text())
assert session['status'].startswith('Complete;')
variants = [f'{kind}{n}' for kind, count in (('head', 6), ('suit', 4)) for n in range(1, count + 1)]
paths = lambda species, choices: [review / species / species / f'{species}_{variant}' / 'far_lod2.png' for variant in choices]
ulgani = paths('ulgani', variants)
shared = [paths(species, ['head1'])[0] for species in ('thalune', 'ixari', 'ulgani')]
jobs = []
python = stage / 'ulgani4-lineup-env/bin/python'
for name, inputs in (('ulgani_lineup_far_lod2', ulgani), ('lineup_far_lod2', shared)):
    for gray in (False, True):
        output = review / (name + ('_grayscale' if gray else '') + '.png')
        command = [str(python), str(stage / 'lineup_cpu_png.py')] + (['--grayscale'] if gray else []) + [str(output)] + [str(p) for p in inputs]
        jobs.append((command, inputs, [output, output.with_suffix('.json')]))
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = stage / f'ulgani4-before-lineups-{stamp}'
backup.mkdir()
old = []
for _, _, outputs in jobs:
    for path in outputs:
        if path.exists():
            target = backup / path.name
            shutil.copy2(path, target)
            assert sha(target) == sha(path)
            old.append({'path': str(path.relative_to(root)), 'sha256': sha(path), 'backup': str(target.relative_to(root))})
(backup / 'manifest.json').write_text(json.dumps(old, indent=2) + '\n')
record = {'started_utc': now(), 'controller_pid': os.getpid(), 'controller_pgid': os.getpgrp(), 'scope': 'CPU PNG pixel composition and hash inventory only; no Blender/browser/renderer/source/export work.', 'threads': 2, 'helper_sha256': sha(stage / 'lineup_cpu_png.py'), 'backup': str(backup.relative_to(root)), 'steps': []}
record_path = validation / 'ulgani-review4-lineup-generation.json'
log = stage / f'ulgani4-lineups-{stamp}.log'
env = {**os.environ, 'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2'}
with log.open('w') as output_log:
    for command, inputs, outputs in jobs:
        event = {'utc': now(), 'command': command, 'inputs': [{'path': str(p.relative_to(root)), 'sha256': sha(p)} for p in inputs]}
        child = subprocess.Popen(command, cwd=root, env=env, stdout=output_log, stderr=subprocess.STDOUT)
        event.update(pid=child.pid, pgid=os.getpgid(child.pid), exit_code=child.wait(), completed_utc=now())
        record['steps'].append(event)
        record_path.write_text(json.dumps(record, indent=2) + '\n')
        assert event['exit_code'] == 0, log
        for item in event['inputs']:
            assert sha(root / item['path']) == item['sha256']
        event['artifacts'] = [{'path': str(p.relative_to(root)), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in outputs]
    command = ['python3', 'packages/tools/blender/characters/review_inventory.py', 'ulgani', '4']
    event = {'utc': now(), 'command': command}
    child = subprocess.Popen(command, cwd=root, env=env, stdout=output_log, stderr=subprocess.STDOUT)
    event.update(pid=child.pid, pgid=os.getpgid(child.pid), exit_code=child.wait(), completed_utc=now())
    record['steps'].append(event)
    assert event['exit_code'] == 0, log
record.update(completed_utc=now(), log=str(log.relative_to(root)), log_sha256=sha(log), exit_code=0)
record_path.write_text(json.dumps(record, indent=2) + '\n')
print('ULGANI_LINEUPS_INVENTORY_COMPLETE', record['completed_utc'], flush=True)
