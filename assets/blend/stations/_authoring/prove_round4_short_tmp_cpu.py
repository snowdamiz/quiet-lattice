"""Real pinned pnpm→tsx CPU fixtures: long-path failure and short live IPC success."""
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

from round4_job_boundary import StationJob, deadline, kernel_tasks, write
from run_round4_browser_proof import create_private_tmp, tmp_admission, preserve_private_tmp, PRIVATE_TMP_POLICY

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=False)
RESULTS = []


def fixture(name, short):
    out = OUT / name; out.mkdir()
    if short:
        namespace, admission = create_private_tmp(out / 'private_tmp_admission.json')
    else:
        namespace = (out / 'long_private_temporary_namespace').resolve(); namespace.mkdir(mode=0o700)
        admission = tmp_admission(namespace); write(out / 'private_tmp_admission.json', admission)
    ready, release = out / 'body_ready.json', out / 'body_release'
    script = """(async()=>{const fs=require('node:fs'),os=require('node:os');fs.writeFileSync(READY,JSON.stringify({pid:process.pid,TMPDIR:process.env.TMPDIR,tmpdir:os.tmpdir(),browser:false}));while(!fs.existsSync(RELEASE))await new Promise(r=>setTimeout(r,10));console.log('CPU_ONLY_TSX_BODY_COMPLETED');})().catch(e=>{console.error(e);process.exit(1)});""".replace('READY', json.dumps(str(ready))).replace('RELEASE', json.dumps(str(release)))
    argv = ['pnpm', 'exec', 'tsx', '--eval', script]
    job = StationJob(out / 'owned_job', argv, ROOT, capture_seconds=5,
                     env={'PATH': os.environ['PATH'], 'TMPDIR': str(namespace) + os.sep})
    record = {'mode': 'CPU_ONLY_NO_BROWSER', 'argv': argv, 'namespace_admission': admission,
              'expected': 'short IPC success' if short else 'long IPC EINVAL before body'}
    try:
        job.start()
        if short:
            with deadline(5):
                while not ready.exists():
                    assert 'capture' not in job.status().get('exits', {}), 'CPU body exited before IPC receipt'
                    time.sleep(.01)
                sockets = []
                while not sockets:
                    sockets = [p for p in namespace.glob(f'tsx-{os.getuid()}/*.pipe') if stat.S_ISSOCK(p.lstat().st_mode)]
                    time.sleep(.01)
            body = json.loads(ready.read_text())
            assert Path(body['tmpdir']).resolve() == namespace and body['browser'] is False
            record['actual_live_sockets'] = [{'path': str(p), 'bytes': len(os.fsencode(p)),
                'uid': p.lstat().st_uid, 'type': 'AF_UNIX socket'} for p in sockets]
            assert all(r['bytes'] < PRIVATE_TMP_POLICY['unix_socket_capacity'] and r['uid'] == os.getuid() for r in record['actual_live_sockets'])
            record['body'] = body
            record['live_kernel_members'] = job.members()
            write(out / 'live_IPC_receipt.json', record)
            release.touch()
        assert job.wait(5) == 'completed', job.state
        with deadline(3):
            while 'caffeinate' not in job.status()['exits']: time.sleep(.01)
        record['exits'] = job.status()['exits']
        assert record['exits']['capture'] == (0 if short else 1), record
        assert record['exits']['caffeinate'] == 0, record
        if not short:
            log = (job.scratch / 'capture_stdout.txt').read_text()
            assert 'listen EINVAL' in log and not ready.exists(), log
            address = re.search(r'Error: listen EINVAL: invalid argument ([^\n]+)', log)[1]
            record['actual_failed_socket'] = {'path': address, 'bytes': len(os.fsencode(address))}
            assert record['actual_failed_socket']['bytes'] >= PRIVATE_TMP_POLICY['unix_socket_capacity']
        assert job.drain(3)['drained'], job.state
        assert kernel_tasks(job.coalition_id)['live'] == 0
        job.archive(profile_namespace=namespace, profile_prefixes=('playwright_chromiumdev_profile-',))
        record['tmp_release'] = preserve_private_tmp(namespace, admission, out / 'preserved_nonprofile_tmp', job=job)
        assert record['tmp_release']['all_bytes_preserved'] and not namespace.exists()
        record.update(kernel_terminal=kernel_tasks(job.coalition_id), all_owned_resources_drained=True,
                      namespace_removed=True, browser_started=False)
        write(out / 'result.json', record)
        RESULTS.append(record)
    finally:
        release.touch()
        if not job.state['drained']:
            assert job.drain(3)['drained'], job.state
        if job.scratch.exists():
            job.archive(profile_namespace=namespace, profile_prefixes=('playwright_chromiumdev_profile-',))
        if namespace.exists():
            record['failure_recovery_tmp_release'] = preserve_private_tmp(namespace, admission, out / 'failure_preserved_nonprofile_tmp', job=job)
            write(out / 'failure_recovery.json', record)


fixture('long_path_reproduction', False)
fixture('short_path_success', True)
write(OUT / 'result.json', {'mode': 'CPU_ONLY_ACTUAL_PACKAGE_LAUNCHER', 'fixtures': RESULTS,
                          'browser_GPU_native_capture_performed': False, 'all_owned_resources_drained': True})
print(json.dumps({'long_capture_exit': RESULTS[0]['exits']['capture'],
                  'short_capture_exit': RESULTS[1]['exits']['capture'],
                  'long_socket_bytes': RESULTS[0]['actual_failed_socket']['bytes'],
                  'short_socket_bytes': RESULTS[1]['actual_live_sockets'][0]['bytes'],
                  'all_owned_resources_drained': True, 'browser_started': False}, indent=2))
