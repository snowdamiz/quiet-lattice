"""One bounded CPU saved-source patch then validation, with owned job records."""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys

root = Path.cwd()
assert str(root) == '/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41'
assert subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip() == 'task/P1-E05-T01'
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == 'd15bc22d0256498a48a9e1d13da0414c489eedf8'
stage = root / '.claude/pause/characters-resume'
work = stage / 'ulgani5'
work.mkdir(exist_ok=True)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
patch = root / 'packages/tools/blender/characters/restore_ulgani5_head2.py'
source = work / 'ulgani5-source-clean.blend'
output = work / 'ulgani5-source-head2.blend'
assert sha(patch) == 'ba4a3c9f2c70bd4c5e16ef6116faca2eff545277a1d1f7bd2f53c138879fced5'
assert sha(source) == 'b332440a309c2c555ca5c8726ed05ab572e7e788e0fffa0938cd9ee018a4c919'
assert not output.exists() and not (work / 'source-head2.json').exists()
record_path = stage / 'ulgani5-head2-stage-job.json'
assert not record_path.exists()
frozen = {str(p.relative_to(root)): sha(p) for p in [root / f'{directory}/{people}.{suffix}' for people in ('thalune', 'ixari', 'ulgani') for directory, suffix in (('assets/blend/characters', 'blend'), ('packages/client/public/models/characters', 'glb'))]}
record = {'started_utc': now(), 'controller_pid': os.getpid(), 'controller_pgid': os.getpgrp(), 'scope': 'ONE CPU-only existing Head2 nodule LOD restoration and staging-source validation;no body/jaw/morph replay;no bake/export/render/browser/GPU.', 'threads': 2, 'patch_sha256': sha(patch), 'frozen_canonical_hashes': frozen, 'steps': [], 'status': 'running'}
save = lambda: record_path.write_text(json.dumps(record, indent=2) + '\n')
save()
binary = '/Applications/Blender.app/Contents/MacOS/Blender'
base = [binary, '-b', '--factory-startup', '-t', '2', '--python-exit-code', '1', '-P']
jobs = [('head2', base + [str(patch), '--', str(source), str(output), str(work / 'source-head2.json')]), ('validation-head2', base + ['packages/tools/blender/validate.py', '--', '--family', 'characters', '--report', str(work / 'source-validation-head2.json'), str(output)])]
env = {**os.environ, 'OPENBLAS_NUM_THREADS': '2', 'OMP_NUM_THREADS': '2'}
failed = False
for key, command in jobs:
    log = work / f'{key}.log'
    assert not log.exists()
    event = {'key': key, 'utc': now(), 'command': command, 'log': str(log.relative_to(root)), 'threads': 2}
    record['steps'].append(event)
    with log.open('w') as stream:
        child = subprocess.Popen(command, cwd=root, env=env, stdout=stream, stderr=subprocess.STDOUT)
        assertion = subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(child.pid)])
        event.update(pid=child.pid, pgid=os.getpgid(child.pid), caffeinate_pid=assertion.pid, caffeinate_pgid=os.getpgid(assertion.pid))
        save()
        print('ULGANI5_CPU_STAGE_BEGIN', json.dumps(event), flush=True)
        try:
            event['exit_code'] = child.wait(timeout=600)
        except subprocess.TimeoutExpired:
            event['timeout_seconds'] = 600
            child.terminate()
            try:
                event['exit_code'] = child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.kill()
                event['exit_code'] = child.wait()
        event['completed_utc'] = now()
        event['caffeinate_exit_code'] = assertion.wait(timeout=30)
    event['log_sha256'] = sha(log)
    save()
    print('ULGANI5_CPU_STAGE_END', key, event['exit_code'], event['completed_utc'], flush=True)
    if event['exit_code']:
        failed = True
        break
for path, digest in frozen.items():
    assert sha(root / path) == digest, path
record.update(completed_utc=now(), exit_code=1 if failed else 0, status='failed;preserve source checkpoints/logs;no later job launched' if failed else 'source checkpoint and validation complete;controller draining', artifacts=[{'path': str(p.relative_to(root)), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(work.iterdir()) if p.is_file()])
save()
print('ULGANI5_CPU_SOURCE_BOUNDARY', json.dumps({'status': record['status'], 'exit_code': record['exit_code'], 'utc': record['completed_utc']}), flush=True)
sys.exit(record['exit_code'])
