"""Harmless finite process fixture; no art, network, or dependency imports."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

folder = Path(sys.argv[1])
role = sys.argv[2]
if role == 'leaf':
    signal.signal(signal.SIGTERM, lambda *_: (folder / 'leaf-term').touch())
    (folder / 'leaf.json').write_text(json.dumps(dict(pid=os.getpid(), pgid=os.getpgrp())))
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        time.sleep(.03)
elif role == 'late-leaf':
    # TERM-resistant same-group orphan used by late_same_group_fork.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    (folder / 'leaf.json').write_text(json.dumps(dict(pid=os.getpid(), ppid=os.getppid(), pgid=os.getpgrp())))
    time.sleep(12)
elif role == 'late-leader':
    (folder / 'leader.json').write_text(json.dumps(dict(pid=os.getpid(), pgid=os.getpgrp())))
    deadline = time.monotonic() + 7
    while not (folder / 'fork-now').exists():
        if time.monotonic() > deadline:
            raise TimeoutError('no fork barrier')
        time.sleep(.005)
    leaf = subprocess.Popen([sys.executable, __file__, str(folder), 'late-leaf'])
    (folder / 'spawned.json').write_text(json.dumps(dict(leader=os.getpid(), leaf=leaf.pid, pgid=os.getpgrp())))
    # Same group, ordinary Popen, no daemonization or setsid.
    os._exit(0)
else:
    leaf = subprocess.Popen([sys.executable, __file__, str(folder), 'leaf'], start_new_session=True)
    (folder / 'worker.json').write_text(json.dumps(dict(pid=os.getpid(), leaf=leaf.pid)))
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if (folder / 'leader-exit').exists():
            sys.exit(0)
        time.sleep(.03)
