"""Record a tool session or verify one completed bounded CPU stage."""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys
root = Path.cwd()
assert str(root) == '/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41'
assert subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip() == 'task/P1-E05-T01'
key, mode, session = sys.argv[1], sys.argv[2], int(sys.argv[3])
assert mode in ('start', 'finish')
stage = root / '.claude/pause/characters-resume'
jobpath = stage / f'ulgani4-cpu-{key}-job.json'
event = json.loads(jobpath.read_text())
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
event['session'] = session
if mode == 'start':
    for pid in (event['controller_pid'], event['pid'], event['caffeinate_pid']):
        print(subprocess.check_output(['ps', '-p', str(pid), '-o', 'pid=,ppid=,pgid=,state=,command='], text=True).strip())
        cwd = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True)
        assert '\nn' + str(root) + '\n' in cwd, (pid, cwd)
else:
    assert event['exit_code'] == 0 and event['caffeinate_exit_code'] == 0
    ps = subprocess.check_output(['ps', '-axo', 'pid=,pgid='], text=True)
    rows = [list(map(int, row.split())) for row in ps.splitlines()]
    owned = {event['controller_pid'], event['pid'], event['caffeinate_pid']}
    assert not any(pid in owned or pgid == event['controller_pgid'] for pid, pgid in rows), 'Owned process/group remains'
    for item in event['artifacts']:
        assert sha(root / item['path']) == item['sha256'], item['path']
    frozen = json.loads((stage / 'ulgani4-preflight-frozen-hashes.json').read_text())['hashes']
    for path, digest in frozen.items():
        assert sha(root / path) == digest, path
    event.update(status='complete; controller/render/idle assertion and owned group drained', drain_verified_utc=now, controller_exit_code=0)
jobpath.write_text(json.dumps(event, indent=2) + '\n')
indexpath = stage / 'ulgani4-cpu-session-index.json'
index = json.loads(indexpath.read_text()) if indexpath.exists() else []
index = [x for x in index if x['key'] != key]
index.append({'key': key, 'session': session, 'controller_pid': event['controller_pid'], 'pid': event['pid'], 'pgid': event['pgid'], 'caffeinate_pid': event['caffeinate_pid'], 'started_utc': event['utc'], 'completed_utc': event.get('completed_utc'), 'drain_verified_utc': event.get('drain_verified_utc'), 'job_record': str(jobpath.relative_to(root))})
indexpath.write_text(json.dumps(index, indent=2) + '\n')
activepath = stage / 'ACTIVE_SOL_RESUME.json'
active = json.loads(activepath.read_text())
active.update(observed_utc=now, head=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), live_jobs=[event] if mode == 'start' else [], ulgani_cpu_artifact_stage=event, cpu_art_authorized=True, gpu_art_authorized=False)
activepath.write_text(json.dumps(active, indent=2) + '\n')
if mode == 'finish':
    progress = root / 'assets/renders/characters/validate/ulgani-review4-cpu-stages.json'
    record = json.loads(progress.read_text())
    record['steps'] = [event if x['key'] == key else x for x in record['steps']]
    record['updated_utc'] = now
    progress.write_text(json.dumps(record, indent=2) + '\n')
    with (stage / 'characters-sol-decisions.tsv').open('a') as f:
        f.write('\t'.join([now, 'cpu-art', f'Accept the completed Ulgani fourth {key} CPU artifact stage', 'Current-source artifact and frozen source/export hashes pass; standard quality retained', str(jobpath.relative_to(stage)) + ';assets/renders/characters/validate/ulgani-review4-cpu-stages.json', 'render controller idle assertion exit0;owned group absent']) + '\n')
print('ULGANI_CPU_STAGE_' + mode.upper(), key, 'SESSION', session, event['status'])
