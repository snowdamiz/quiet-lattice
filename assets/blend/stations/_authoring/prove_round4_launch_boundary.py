"""CPU-only installed launcher and responsibility ABI proofs. Never starts Chromium."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from round4_job_boundary import StationJob, coalition, identity, write

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=False)


def waitfor(predicate):
    until = time.monotonic() + 6
    while time.monotonic() < until:
        value = predicate()
        if value:
            return value
        time.sleep(.01)
    raise AssertionError('CPU proof fixture wait expired')


def execute(name, argv, trigger, prepare=None):
    job = StationJob(OUT / name, argv, ROOT, env={'PATH': os.environ['PATH']})
    try:
        job.start()
        payload = waitfor(lambda: json.loads(trigger.read_text()) if trigger.exists() else None)
        rows = {row['pid']: row for row in job.members()}
        assert all(pid in rows for pid in payload['pids'])
        if 'profile' in payload:
            assert Path(payload['profile']).name.startswith('playwright_chromiumdev_profile-')
            job.state['profiles'] = [payload['profile']]
            job.save()
        write(OUT / (name + '_before_exit.json'), {'job_root': job.root, 'coalition': job.coalition_id,
              'fixture_pids': payload['pids'], 'kernel_identities': [rows[pid] for pid in payload['pids']]})
        if prepare:
            prepare()
        outcome = job.wait(6)
        assert outcome == 'completed', job.state
        assert job.status()['exits']['capture'] == 0, job.status()
        assert job.drain(3)['clean'], job.state
    finally:
        if not job.state['drained']:
            assert job.drain(4)['drained'], job.state
        job.archive()
    return {'outcome': outcome, 'boundary': job.coalition_id, 'exits': job.state['exits'],
            'all_owned_pids_and_registration_absent': True}


# Execute pnpm/tsx and the installed Playwright launch path with an executable CPU stub.
# No executable named Chromium/Chrome is used. The stub cannot implement a browser protocol.
ready = OUT / 'stub_ready.json'
go = OUT / 'stub_exit'
child_release = OUT / 'orphan_release'
late = OUT / 'orphan_late_write'
stub = OUT / 'owned_cpu_executable'
child_code = f"import os,time;os.setsid();\nwhile not os.path.exists({str(child_release)!r}):time.sleep(.01)\nopen({str(late)!r},'w').write('late');time.sleep(10)"
stub.write_text(f'''#!{sys.executable}
import json,os,subprocess,sys,time
p=subprocess.Popen([sys.executable,'-c',{child_code!r}])
profile=next(a.split('=',1)[1] for a in sys.argv if a.startswith('--user-data-dir='))
open({str(ready)!r},'w').write(json.dumps({{'pids':[os.getpid(),p.pid],'profile':profile}}))
while not os.path.exists({str(go)!r}):time.sleep(.01)
''')
stub.chmod(0o755)
script = """(async()=>{const {createRequire}=await import('node:module'); const r=createRequire(process.cwd()+'/packages/tools/package.json'); const {chromium}=r('@playwright/test'); try {await chromium.launch({executablePath:STUB,timeout:5000}); throw Error('CPU stub must not connect');}catch(e){if(e.name!=='TimeoutError'&&!String(e).includes('Target page, context or browser has been closed'))throw e; console.log('EXPECTED_CPU_STUB_PROTOCOL_REJECTION');}})().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});""".replace('STUB', json.dumps(str(stub)))
result = {'installed_pnpm_tsx_playwright_cpu_stub': execute('installed_launcher', ['pnpm', 'exec', 'tsx', '--eval', script], ready, go.touch)}
profile_release = json.loads((OUT / 'installed_launcher/profile_release.json').read_text())
assert len(profile_release['owned_logged_profiles']) == 1 and profile_release['all_absent']
result['installed_pnpm_tsx_playwright_cpu_stub']['profile_release'] = profile_release
child_release.touch()
time.sleep(.1)
assert not late.exists(), 'Late-writing separate-group CPU descendant escaped'

# Same installed ABI used by Chromium's launch_mac.cc, without a browser/native capture.
ready = OUT / 'disclaim_ready.json'
go = OUT / 'disclaim_exit'
fixture = OUT / 'disclaim_fixture.py'
fixture.write_text(f'''import ctypes,json,os,sys,time
lib=ctypes.CDLL(None)
attr=ctypes.c_void_p()
assert lib.posix_spawnattr_init(ctypes.byref(attr))==0
assert lib.responsibility_spawnattrs_setdisclaim(ctypes.byref(attr),1)==0
pid=ctypes.c_int()
args=(ctypes.c_char_p*4)(os.fsencode(sys.executable),b'-c',b'import time;time.sleep(20)',None)
env=(ctypes.c_char_p*2)(b'PATH=/usr/bin:/bin',None)
assert lib.posix_spawn(ctypes.byref(pid),os.fsencode(sys.executable),None,ctypes.byref(attr),args,env)==0
assert lib.posix_spawnattr_destroy(ctypes.byref(attr))==0
open({str(ready)!r},'w').write(json.dumps({{'pids':[os.getpid(),pid.value]}}))
while not os.path.exists({str(go)!r}):time.sleep(.01)
''')
result['responsibility_disclaim_same_abi'] = execute('responsibility_disclaim', [sys.executable, str(fixture)], ready, go.touch)
bundle = next((ROOT / 'node_modules/.pnpm').glob('playwright-core@*/node_modules/playwright-core/lib/coreBundle.js'))
result.update(actual_chromium_or_native_capture_run=False, actual_capture_boundary_qualified=False,
              source_sha256={str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in
                  (ROOT / 'packages/tools/src/capture/capture.ts', ROOT / 'assets/blend/stations/_authoring/review_assembled.ts', bundle)},
              limitation='Owned executable stub and same-ABI CPU proof do not establish actual Chromium/native family inheritance')
write(OUT / 'result.json', result)
print(json.dumps(result, indent=2))
