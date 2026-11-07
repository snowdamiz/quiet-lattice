"""Run one serial CPU measurement, enforcing the authorized RSS/time/output caps."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import os
import signal
import shutil

ap = argparse.ArgumentParser()
ap.add_argument('--receipt', required=True)
ap.add_argument('--output-dir', required=True)
ap.add_argument('--profile', choices=['node', 'blender'], default='node')
ap.add_argument('--private-tmp')
ap.add_argument('command', nargs=argparse.REMAINDER)
a = ap.parse_args()
command = a.command[1:] if a.command[0] == '--' else a.command
limits = dict(rss_bytes=2*1024**3, wall_seconds=600, output_bytes=512*1024**2)
env = os.environ.copy()
if a.profile == 'blender':
    if not a.private_tmp:
        raise SystemExit('Blender requires a private TMP')
    limits = dict(rss_bytes=8*1024**3, wall_seconds=2700,
                  output_bytes=6*1024**3, min_free_bytes=12*1024**3)
    for key in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                'VECLIB_MAXIMUM_THREADS', 'NUMEXPR_NUM_THREADS', 'BLIS_NUM_THREADS']:
        env[key] = '2'
    env['TMPDIR'] = str(Path(a.private_tmp).resolve())
    env['BLENDER_USER_CONFIG'] = str(Path(a.private_tmp).resolve()/'blender-config')
    env['BLENDER_USER_SCRIPTS'] = str(Path(a.private_tmp).resolve()/'blender-scripts')
    if shutil.disk_usage(a.private_tmp).free < limits['min_free_bytes']:
        raise SystemExit('Insufficient free disk for Blender admission')
start = time.monotonic()
p = subprocess.Popen(command, start_new_session=True, env=env)
peak = 0
peak_size = 0
owned = {p.pid}
reason = None
while p.poll() is None:
    rows = [list(map(int,row.split())) for row in subprocess.check_output(
        ['ps','-axo','pid=,ppid=,pgid=,rss='],text=True).splitlines()]
    previous = set()
    while previous != owned:
        previous = owned.copy()
        owned.update(pid for pid,ppid,pgid,rss in rows if ppid in owned or pgid == p.pid)
    rss = sum(rss*1024 for pid,ppid,pgid,rss in rows if pid in owned)
    peak = max(peak, rss)
    size = sum(f.stat().st_size for f in Path(a.output_dir).rglob('*') if f.is_file())
    if a.private_tmp:
        size += sum(f.stat().st_size for f in Path(a.private_tmp).rglob('*') if f.is_file())
    peak_size = max(peak_size, size)
    elapsed = time.monotonic()-start
    if rss > limits['rss_bytes']: reason = 'RSS_LIMIT'
    if size > limits['output_bytes']: reason = 'OUTPUT_LIMIT'
    if elapsed > limits['wall_seconds']: reason = 'WALL_LIMIT'
    if a.profile == 'blender' and shutil.disk_usage(a.private_tmp).free < limits['min_free_bytes']:
        reason = 'FREE_DISK_LIMIT'
    if reason:
        os.killpg(p.pid, signal.SIGKILL)
        for pid,ppid,pgid,rss in rows:
            if pid in owned and pgid != p.pid:
                try: os.kill(pid,signal.SIGKILL)
                except ProcessLookupError: pass
        break
    time.sleep(.25)
code = p.wait()
remaining = [list(map(int,row.split())) for row in subprocess.check_output(
    ['ps','-axo','pid=,pgid='],text=True).splitlines()]
remaining = [pid for pid,pgid in remaining if pid in owned or pgid == p.pid]
if remaining:
    reason = reason or 'CHILD_PROCESS_REMAINED'
    for pid in remaining:
        try: os.kill(pid,signal.SIGKILL)
        except ProcessLookupError: pass
    code = code or 1
receipt = dict(command=command, exit_code=code, termination_reason=reason,
               wall_seconds=time.monotonic()-start, sampled_peak_group_rss_bytes=peak,
               sampled_peak_output_and_tmp_bytes=peak_size,
               sampling_seconds=.25, limits=limits, profile=a.profile,
               process_group=p.pid, leader_reaped=True, private_tmp=a.private_tmp)
receipt['remaining_owned_processes_at_leader_exit'] = remaining
Path(a.receipt).write_text(json.dumps(receipt, indent=2)+'\n')
raise SystemExit(code if code >= 0 else 1)
