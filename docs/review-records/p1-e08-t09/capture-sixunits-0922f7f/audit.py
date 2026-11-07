import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

parent = Path(sys.argv[1]).resolve()
load = lambda p: json.loads(Path(p).read_text())
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
dispatch = load(parent / 'dispatch.json')
exit_record = load(parent / 'exit.json')
assert exit_record['exitCode'] == 0, exit_record
evidence = Path(dispatch['evidence'])
result = load(evidence / 'result.json')
consumed = load(dispatch['consumption'])
assert result['admission'] == consumed
assert consumed['head'] == dispatch['sourceHead']
assert consumed['readinessSha256'] == dispatch['readinessSha256']
assert consumed['grantSha256'] == dispatch['grantSha256'] == sha(dispatch['grant'])
assert result['checksPassed'] is True and result['accepted'] is False
assert result['publication'] == {'status': 'AWAITING_CALLER_COMPLETION', 'completeReceipt': None}
assert result['primaryFailure'] is None
for field in ('secondaryFailures', 'cleanupFailures', 'persistenceFailures'):
    assert result[field] == [], (field, result[field])
assert not os.path.lexists(evidence / 'failed-result.json')
raw = result['raw']
assert raw['outcome'] == 'completed' and raw['clean'] and raw['drained']
assert raw['exits']['capture'] == 0 and raw['exits']['caffeinate'] == 0
assert raw['profilesAbsent'] and raw['tmpAbsent'] and raw['terminalAudit']
assert raw['tmpRelease']['all_bytes_preserved'] and raw['tmpRelease']['namespace_removed']
terminal = raw['terminalAuditRecord']
assert terminal['kernel_terminal']['coalition_absent'] and terminal['kernel_terminal']['live'] == 0
assert terminal['registration_absent'] and terminal['namespace_absent'] and terminal['scratch_absent']
inspection = raw['inspection']
spec = consumed['spec']
assert inspection['accepted'] and inspection['unit'] == consumed['unit']
assert inspection['decodedImages'] == spec['budget']['imageCount']
assert inspection['scope'] == 'OFFLINE_VISUAL_REPLAY_ONLY' and not inspection['realTimeOrServerQualification']
output = Path(dispatch['output'])
manifest = raw['outputManifest']
assert len(manifest) == spec['budget']['fileCount']
actual = {str(p.relative_to(output)) for p in output.rglob('*') if p.is_file()}
assert actual == {r['path'] for r in manifest}
for row in manifest:
    f = output / row['path']
    assert f.is_relative_to(output) and not f.is_symlink() and f.is_file()
    assert f.stat().st_size == row['bytes'] and sha(f) == row['sha256']
assert sum(r['bytes'] for r in manifest) == inspection['outputBytes']
boundary = load(evidence / 'owned-job/boundary.json')
assert boundary['clean'] and boundary['drained'] and boundary['remaining'] == [] and boundary['errors'] == []
started = load(parent / 'started.json')
pids = sorted({int(p) for p in terminal['known_births_absent']} | {started['pid'], started['wrapperPid']})
ps = subprocess.run(['/bin/ps', '-p', ','.join(map(str, pids)), '-o', 'pid=,ppid=,pgid=,comm='], capture_output=True, text=True)
assert ps.returncode == 1 and not ps.stdout.strip(), ps.stdout
registration = subprocess.run(['/bin/launchctl', 'print', boundary['target']], capture_output=True, text=True)
assert registration.returncode == 113, registration
paths = [boundary['scratch'], raw['profiles']['namespace'], *raw['profiles']['all_owned_profiles']]
assert all(not os.path.lexists(p) for p in paths), paths
cwd = dispatch['cwd']
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cwd, text=True).strip() == dispatch['sourceHead']
assert subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=cwd, text=True).strip() == dispatch['tree']
subprocess.run(['git', 'diff', '--quiet'], cwd=cwd, check=True)
subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=cwd, check=True)
assert sha(dispatch['readiness']) == dispatch['readinessSha256']
receipt = {'callerExitCode': 0, 'result': {'path': str(evidence / 'result.json'), 'sha256': sha(evidence / 'result.json')},
           'consumption': {'path': dispatch['consumption'], 'sha256': sha(dispatch['consumption'])}}
record = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'slot': dispatch['slot'],
          'outcome': 'PASS_OFFLINE_CAPTURE_UNIT', 'released': True, 'unit': consumed['unit'], 'exit': exit_record,
          'head': dispatch['sourceHead'], 'tree': dispatch['tree'], 'receipt': receipt, 'inspection': inspection,
          'knownPidsAbsent': pids, 'registration': {'exit': registration.returncode, 'stdout': registration.stdout, 'stderr': registration.stderr},
          'ownedPathsAbsent': paths, 'output': str(output), 'manifestSha256': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
          'scope': 'One offline capture and physical release only; no visual, live-server, performance or whole-task acceptance.'}
with (parent / 'parent-terminal-audit.json').open('x') as f:
    json.dump(record, f, indent=2)
    f.write('\n')
print(json.dumps(record))
