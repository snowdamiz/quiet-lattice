"""Fault/barrier instrumentation for the real supervisor, in copied fixtures only."""
import errno
import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
import time
sys.dont_write_bytecode = True

script = Path(sys.argv[1])
folder = Path(sys.argv[2])
mode = sys.argv[3]
base = sys.argv[4] == 'base'
command = sys.argv[5:]
sys.path.insert(0, str(script.parent))


def barrier(name):
    (folder / name).touch()
    until = time.monotonic() + 7
    while not (folder / (name + '-release')).exists():
        if time.monotonic() > until:
            raise TimeoutError('test barrier deadline: ' + name)
        time.sleep(.02)


if mode == 'finalize_publication':
    import finalize
    original_final_write = finalize.write_json
    def final_write(path, *args, **kwargs):
        if path.name == 'PUBLISHED.json':
            barrier('publishing')
        return original_final_write(path, *args, **kwargs)
    finalize.write_json = final_write
    finalize.main()
    sys.exit(0)

if base:
    # Inject at the real OS/persistence boundaries; execute byte-identical base.
    original_ps = subprocess.check_output
    original_write = Path.write_text
    def ps(*args, **kwargs):
        if args[0][:2] == ['ps', '-axo'] and (folder / 'inject').exists():
            raise OSError(errno.EIO, 'injected process observation failure')
        return original_ps(*args, **kwargs)
    def write(path, *args, **kwargs):
        if path == script.parent / 'reports' / 'work.json':
            if mode in ('receipt_failure', 'publication_failure'):
                raise OSError(errno.EIO, 'injected terminal receipt persistence failure')
            if mode.startswith('publication_'):
                barrier('publishing')
        return original_write(path, *args, **kwargs)
    if mode in ('exception', 'observation_failure', 'uncertain_cleanup'):
        subprocess.check_output = ps
    Path.write_text = write
    sys.argv = [str(script), 'work', *command]
    runpy.run_path(str(script), run_name='__main__')
else:
    import stage
    import stage_ownership
    import stage_processes
    original_progress = stage.progress
    original_snapshot = stage_processes.snapshot
    original_publish = stage.publish_terminal
    original_write = stage.write_json
    original_settle = stage.settle
    original_journal_write = stage_ownership.write_json
    def progress(directory, owned):
        original_progress(directory, owned)
        if mode == 'exception' and (folder / 'inject').exists():
            raise RuntimeError('injected exception after ownership acquisition')
        if mode == 'waiter_loss' and (folder / 'inject').exists():
            os.kill(owned.child.pid, signal.SIGKILL)
            os.waitpid(owned.child.pid, 0)  # Real competing reap, not a fake handle.
    def snapshot():
        if mode == 'observation_failure' and (folder / 'inject').exists():
            raise OSError(errno.EIO, 'injected process observation failure')
        return original_snapshot()
    def publish(directory, record, cancellation):
        if mode == 'publication_before':
            barrier('publishing')
        return original_publish(directory, record, cancellation)
    def write(path, value, **kwargs):
        if path == stage.REPORTS / 'work.json':
            if mode == 'receipt_failure':
                raise OSError(errno.EIO, 'injected terminal receipt persistence failure')
            if mode in ('publication_during', 'publication_failure'):
                barrier('publishing')
        return original_write(path, value, **kwargs)
    def settle(*args):
        if mode in ('seal_failure', 'publication_failure'):
            raise OSError(errno.EIO, 'injected settlement persistence failure')
        result = original_settle(*args)
        if mode == 'publication_after':
            barrier('publishing')
        return result
    def journal_write(path, *args, **kwargs):
        if mode == 'admission_failure' and path.name == 'admitted.json':
            raise OSError(errno.EIO, 'injected admission persistence failure')
        return original_journal_write(path, *args, **kwargs)
    if mode == 'uncertain_cleanup':
        def refuse_signal(*args):
            raise PermissionError(errno.EPERM, 'injected termination refusal')
        stage_processes.OwnedProcesses.signal_all = refuse_signal
    if mode == 'watch_failure':
        def fail_watch(child):
            (folder / 'watch-child.json').write_text(json.dumps({'pid': child.pid}))
            until = time.monotonic() + 3
            while not (folder / 'command-ran').exists():
                if time.monotonic() > until: raise TimeoutError('child startup')
                time.sleep(.02)
            raise RuntimeError('injected watch acquisition failure after Popen')
        stage.OwnedProcesses = fail_watch
    stage.progress = progress
    stage_processes.snapshot = snapshot
    stage.publish_terminal = publish
    stage.write_json = write
    stage.settle = settle
    stage_ownership.write_json = journal_write
    sys.exit(stage.main(['work', *command]))
