import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

base = Path(__file__).parent
data = json.loads(Path('/private/tmp/p1-e08-t09-attempt3-evidence-_ajfvph8/launch-data.json').read_text())
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
previous = [Path(p).resolve() for p in sys.argv[1:]]
assert 1 <= len(previous) < len(data['unitOrder'])
receipts = {}
allowed_untracked = set()
for i, p in enumerate(previous):
    audit = json.loads((p / 'parent-terminal-audit.json').read_text())
    unit = data['unitOrder'][i]
    assert audit['unit'] == unit and audit['released'] and audit['outcome'] == 'PASS_OFFLINE_CAPTURE_UNIT'
    assert audit['exit']['exitCode'] == 0 and audit['head'] == data['head'] and audit['tree'] == data['tree']
    receipt = audit['receipt']
    for k in ('result', 'consumption'):
        assert sha(receipt[k]['path']) == receipt[k]['sha256']
    receipts[unit] = receipt
    result = json.loads(Path(receipt['result']['path']).read_text())
    for row in result['raw']['outputManifest']:
        allowed_untracked.add(str((Path(audit['output']) / row['path']).relative_to(data['cwd'])))
unit = data['unitOrder'][len(previous)]
spec = data['units'][unit]
cwd = Path(data['cwd'])
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cwd, text=True).strip() == data['head']
assert subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=cwd, text=True).strip() == data['tree']
subprocess.run(['git', 'diff', '--quiet'], cwd=cwd, check=True)
subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=cwd, check=True)
untracked = set(subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=cwd, text=True).splitlines())
assert untracked == allowed_untracked, (len(untracked), len(allowed_untracked), sorted(untracked - allowed_untracked)[:5])
assert sha(data['readiness']['path']) == data['readiness']['sha256']
report = Path('/private/tmp/fauna-c2-position-review-0k14whev/APPENDIX-C2.md')
assert sha(report) == 'fc8943afec9baae133524ceae48e51543f7458620a0946ca1a76e6c329d2fa54'
for name in data['unitOrder'][len(previous):]:
    for key in ('grant', 'consumption', 'output', 'evidence'):
        assert not os.path.lexists(data['units'][name][key]), data['units'][name][key]
p = Path(tempfile.mkdtemp(prefix='space-fauna-parent-unit' + str(len(previous) + 1) + '-r4-', dir='/private/tmp'))
processes = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,comm='], text=True)
(p / 'processes-before.txt').write_text(processes)
competing = [r for r in processes.splitlines() if any(x in r for x in ('chrome-headless-shell', 'Chromium.app', 'Google Chrome for Testing.app'))]
assert not competing, competing
env = {**data['requiredEnvironment'], 'FAUNA_CAPTURE_GRANT': spec['authorizationId']}
caller = cwd / 'packages/tools/src/capture/fauna_packet/caller.py'
start = time.monotonic()
with (p / 'check.stdout').open('xb') as out, (p / 'check.stderr').open('xb') as err:
    check = subprocess.run([data['firstUnitArgv'][0], '-I', '-B', str(caller), '--check'], cwd=cwd,
                           env={**os.environ, **env}, stdout=out, stderr=err, timeout=60)
free = shutil.disk_usage(cwd).free
extra = 6 * 1024**3 + 64 * 1024**2
preflight = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'selectedUnit': unit,
             'actualCheckExit': check.returncode, 'checkWallSeconds': time.monotonic() - start,
             'head': data['head'], 'tree': data['tree'], 'freeBytes': free,
             'unitAdmissionBytes': spec['budget']['oneUnitAdmissionBytes'], 'otherReservedBytes': extra,
             'predecessorAudits': [str(x / 'parent-terminal-audit.json') for x in previous],
             'competingBrowserCount': 0, 'allowedUntrackedOutputFiles': len(untracked)}
with (p / 'preflight.json').open('x') as f:
    json.dump(preflight, f, indent=2)
assert check.returncode == 0 and free >= spec['budget']['oneUnitAdmissionBytes'] + extra
now = datetime.datetime.now(datetime.timezone.utc)
grant = {**data['grantExampleOnly'], 'authorizationId': spec['authorizationId'], 'unit': unit,
         'callerReview': {'verdict': 'PASS', 'path': str(report), 'sha256': sha(report)},
         'previousUnitsAccepted': data['unitOrder'][:len(previous)], 'previousUnitReceipts': receipts,
         'expiresUtc': (now + datetime.timedelta(minutes=45)).isoformat()}
with Path(spec['grant']).open('x') as f:
    json.dump(grant, f, indent=2)
    f.write('\n')
    f.flush()
    os.fsync(f.fileno())
dispatch = {'slot': 'parent:fauna-0922f7f-unit' + str(len(previous) + 1) + '-r4-20261107',
            'kind': 'fauna-unit-r4', 'released': False, 'phase': 'grant-issued', 'parentEvidence': str(p),
            'sourceHead': data['head'], 'tree': data['tree'], 'readiness': data['readiness']['path'],
            'readinessSha256': data['readiness']['sha256'], 'grant': spec['grant'], 'grantSha256': sha(spec['grant']),
            'output': spec['output'], 'evidence': spec['evidence'], 'consumption': spec['consumption'],
            'argv': [data['firstUnitArgv'][0], '-I', '-B', str(caller), '--execute', unit, '--grant', spec['grant']],
            'cwd': str(cwd), 'env': env, 'freeBytes': free, 'admissionBytes': spec['budget']['oneUnitAdmissionBytes'],
            'additionalParentAndCpuReserveBytes': extra, 'assignedAt': now.isoformat()}
with (p / 'dispatch.json').open('x') as f:
    json.dump(dispatch, f, indent=2)
with (p / 'run.py').open('xb') as f:
    f.write((base / 'run.py').read_bytes())
print(json.dumps({'parentEvidence': str(p), 'unit': unit, 'grant': spec['grant'], 'freeBytes': free,
                  'admissionBytes': spec['budget']['oneUnitAdmissionBytes']}))
