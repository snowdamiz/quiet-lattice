"""Real supported spawn/exit timing falsifies process-list classification as emptiness."""
import ctypes
import json
import os
from pathlib import Path
import sys
import time
from unittest.mock import patch
import round4_job_boundary as boundary

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=False)


def waitfor(predicate):
    until = time.monotonic() + 4
    while time.monotonic() < until:
        value = predicate()
        if value:
            return value
        time.sleep(.01)
    raise AssertionError('bounded replacement fixture wait expired')


fork, child_ready, parent_exit = (OUT / name for name in ('fork', 'child.json', 'parent_exit'))
child_code = 'import time;time.sleep(20)'
parent_code = f'''import json,os,subprocess,sys,time
while not os.path.exists({str(fork)!r}):time.sleep(.01)
p=subprocess.Popen([sys.executable,'-c',{child_code!r}],start_new_session=True)
open({str(child_ready)!r},'w').write(json.dumps({{'pid':p.pid}}))
while not os.path.exists({str(parent_exit)!r}):time.sleep(.01)
'''
job = boundary.StationJob(OUT / 'job', [sys.executable, '-c', parent_code], ROOT)
record = {}
try:
    job.start()
    original = job.status()['capture_launch_identity']
    record['before_enumeration'] = {'parent': original, 'job_root': job.root, 'coalition': job.coalition_id}
    boundary.write(OUT / 'before_exit.json', record)
    real_list = boundary.user_pids
    calls = 0
    def enumerate_then_replace():
        global calls
        calls += 1
        if calls > 1:
            return real_list()
        pids = real_list()  # Actual kernel PID list, captured before the supported spawn.
        fork.touch()
        waitfor(child_ready.exists)
        pid = json.loads(child_ready.read_text())['pid']
        child = boundary.identity(pid)
        assert boundary.coalition(pid)[0] == job.coalition_id
        record['before_parent_exit'] = {'child': child, 'parent': boundary.identity(original['pid'])}
        boundary.write(OUT / 'before_exit.json', record)  # Durable birth/UID/cohort receipts before exit.
        parent_exit.touch()
        waitfor(lambda: 'caffeinate' in job.status()['exits'])
        assert boundary.identity(original['pid']) is None
        return pids
    if '--cleanup' in sys.argv:
        with patch('round4_job_boundary.user_pids', enumerate_then_replace):
            result = job.drain(3)
        assert result['drained'], result
        assert result['incomplete_scan_receipts'][0]['kernel']['live'] == 2
        assert result['kernel_before_root_release']['live'] == 1
        assert result['kernel_terminal']['live'] == 0
        record.update(exact_cleanup_rejected_missed_replacement=True, terminal_receipt=json.loads(json.dumps(result)))
        boundary.write(OUT / 'result.json', record)
    else:
        with patch('round4_job_boundary.user_pids', enumerate_then_replace):
            sampled = job.members()
    if '--cleanup' in sys.argv:
        # The terminal receipt is the after-control; no live survivor is expected.
        sampled = []
    else:
        pid = json.loads(child_ready.read_text())['pid']
        current = boundary.identity(pid)
        assert current and current['ppid'] == 1 and current['pgid'] == pid
        assert [row['pid'] for row in sampled] == [job.root['pid']], sampled
        record['sampled_members'] = sampled
        record['live_missed_child'] = current
    lib = ctypes.CDLL(None, use_errno=True)
    read = lib.coalition_info_resource_usage
    read.argtypes = [ctypes.c_uint64, ctypes.c_void_p, ctypes.c_size_t]
    read.restype = ctypes.c_int
    counters = (ctypes.c_uint64 * 2)()
    if '--cleanup' not in sys.argv:
        assert read(job.coalition_id, ctypes.byref(counters), 16) == 0
        record['atomic_kernel_tasks'] = {'started': counters[0], 'exited': counters[1], 'live': counters[0] - counters[1]}
        assert record['atomic_kernel_tasks']['live'] == 2
    record['process_list_alone_is_not_terminal_proof'] = True
finally:
    if not job.state['drained']:
        assert job.drain(3)['drained'], job.state
    job.archive()
    record['all_fixture_resources_absent'] = True
    boundary.write(OUT / 'result.json', record)
print(json.dumps(record, indent=2))
