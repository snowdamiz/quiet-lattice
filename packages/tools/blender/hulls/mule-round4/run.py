"""One Mule CPU lane; exclusive evidence and bounded process-group lifetime."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[5]
EVIDENCE = ROOT / 'assets/renders/hulls/mule-round4-current'
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'


def resources():
    vm = subprocess.check_output(['vm_stat'], text=True, timeout=3)
    page = int(re.search(r'page size of (\d+)', vm)[1])
    counts = dict((k, int(v)) for k, v in re.findall(r'^(Pages [\w ]+):\s+(\d+)', vm, re.M))
    ps = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,rss='], text=True, timeout=3)
    rows = [list(map(int, line.split())) for line in ps.splitlines()]
    return {'disk_free': shutil.disk_usage(ROOT).free,
            'memory_reclaimable': page * sum(counts.get(k, 0) for k in ['Pages free', 'Pages inactive', 'Pages speculative']),
            'system_rss_kib': sum(r[3] for r in rows), 'processes': rows}


def size_tree(path):
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())


def group_alive(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False


def reap_group(proc):
    """No external probes here: a broken ps/vm_stat cannot skip kill or wait."""
    errors=[]
    reaped=False
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        try:
            os.killpg(proc.pid,sig)
        except ProcessLookupError:
            pass
        except OSError as exc:
            errors.append({'phase':'send '+sig.name,'error':repr(exc)})
        until=time.monotonic()+8
        while time.monotonic()<until:
            try:
                proc.poll()
                if not group_alive(proc.pid):break
            except OSError as exc:
                errors.append({'phase':'group probe after '+sig.name,'error':repr(exc)});time.sleep(.2)
            time.sleep(.2)
    try:
        proc.wait(timeout=2)
        reaped=True
    except (OSError,subprocess.TimeoutExpired) as exc:
        errors.append({'phase':'leader wait','error':repr(exc)})
    try:
        alive=group_alive(proc.pid)
    except OSError as exc:
        errors.append({'phase':'final group probe','error':repr(exc)});alive=True
    return reaped,alive,errors


def final_bounds(args,start,cancelled,temp):
    files=[f for f in EVIDENCE.rglob('*') if f.is_file() and 'scratch' not in f.relative_to(EVIDENCE).parts]
    counts={'elapsed_seconds':time.time()-start,'images':sum(f.suffix.lower() in ['.png','.jpg','.jpeg','.webp'] for f in files),
            'evidence_bytes':sum(f.stat().st_size for f in files),'scratch_bytes':size_tree(temp)}
    reason=('signal '+str(cancelled) if cancelled else
            'wall limit' if counts['elapsed_seconds']>args.wall else
            'scratch limit' if counts['scratch_bytes']>4096*1024**2 else
            'image/evidence limit' if counts['images']>args.image_limit or counts['evidence_bytes']>args.evidence_mib*1024**2 else None)
    return reason,counts


def publish_receipt(out,receipt,args):
    """Publish once, after the on-disk receipt itself passes retained-byte accounting."""
    pending=out/'receipt.pending.json'
    cap=args.evidence_mib*1024**2
    def retained():
        return sum(f.stat().st_size for f in EVIDENCE.rglob('*') if f.is_file() and 'scratch' not in f.relative_to(EVIDENCE).parts)
    before=retained()
    # The count is in its own serialized payload; converge its decimal width.
    receipt['persisted_evidence_bytes']=before
    receipt['receipt_included_in_budget']=True
    for _ in range(8):
        data=json.dumps(receipt,indent=2).encode()
        total=before+len(data)
        if total>cap:
            receipt['status']='FAIL'
            receipt['reason']=receipt.get('reason') or 'receipt exceeds evidence limit'
            receipt['receipt_budget_exceeded']=True
        if receipt['persisted_evidence_bytes']==total and data==json.dumps(receipt,indent=2).encode():break
        receipt['persisted_evidence_bytes']=total
    else:raise RuntimeError('receipt accounting did not converge')
    with pending.open('xb') as f:f.write(data)
    # Keep tentative PASS out of the published name until actual disk bytes agree.
    actual=retained()
    if actual!=total:
        receipt['status']='FAIL'
        receipt['reason']=receipt.get('reason') or 'evidence changed while publishing receipt'
        receipt['observed_evidence_bytes_before_failure_rewrite']=actual
        receipt['persisted_evidence_bytes']=None  # concurrent writes invalidate a stable self-count
        pending.write_text(json.dumps(receipt,indent=2))
    assert receipt['status']!='PASS' or actual<=cap
    destination=out/'receipt.json'
    assert not destination.exists()
    pending.rename(destination)


def controller_lost(fd):
    if fd is None:return False
    try:return os.read(fd,1)==b''
    except BlockingIOError:return False


def main(controller_fd=None):
    p = argparse.ArgumentParser()
    p.add_argument('attempt')
    p.add_argument('--wall', type=int, default=900)
    p.add_argument('--rss-mib', type=int, default=8192)
    p.add_argument('--image-limit',type=int,default=48)
    p.add_argument('--evidence-mib',type=int,default=512)
    p.add_argument('command', nargs=argparse.REMAINDER)
    a = p.parse_args()
    command = a.command[1:] if a.command[:1] == ['--'] else a.command
    assert command
    assert 1<=a.image_limit<=48 and 1<=a.evidence_mib<=512
    # Never truncate the lock inode: every process locks the same file.
    with open('/tmp/p1-e12-t02-mule-r4.cpu.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ownership=Path('/tmp/p1-e12-t02-mule-r4.cpu.ownership')
        ownership.mkdir()  # crash/failed reap leaves a persistent hold, never auto-cleared
        (ownership/'owner.json').write_text(json.dumps({'pid':os.getpid(),'cwd':str(ROOT),'attempt':a.attempt}))
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        out = EVIDENCE / a.attempt
        try:
            out.mkdir()  # an attempt is immutable; even a failed retry gets a new name
        except BaseException:
            shutil.rmtree(ownership)
            raise
        temp = out / 'scratch'
        temp.mkdir()
        receipt = {'supervisor_pid':os.getpid(),'controller_pipe_monitored':controller_fd is not None,'command': command, 'cwd': str(ROOT), 'limits': {'wall_seconds': a.wall, 'rss_mib': a.rss_mib, 'scratch_mib': 4096, 'evidence_mib': 512, 'images': 48},
                   'start': time.time(), 'status': 'STARTING'}
        receipt['limits'].update(evidence_mib=a.evidence_mib,images=a.image_limit)
        receipt['tools_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')}
        receipt['input_assets']={str(p.relative_to(ROOT)):{'size':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()} for p in [ROOT/'assets/blend/hulls/mule.blend',ROOT/'packages/client/public/models/hulls/mule.glb'] if p.exists()}
        proc = None
        cancelled = []
        def cancel(sig, frame):
            cancelled.append(sig)
        for sig in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]:
            signal.signal(sig, cancel)
        code = 1
        reason = None
        peak = 0
        try:
            before=resources();receipt['before']=before
            assert before['disk_free'] > 12 * 1024**3, 'disk preflight below 12 GiB'
            assert before['memory_reclaimable'] > 3 * 1024**3, 'memory preflight below 3 GiB reclaimable'
            if controller_lost(controller_fd):raise RuntimeError('controller lost before launch')
            if cancelled:raise RuntimeError('cancelled before launch '+str(cancelled))
            env = dict(os.environ, OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2', VECLIB_MAXIMUM_THREADS='2', NUMEXPR_NUM_THREADS='2', BLIS_NUM_THREADS='2', TBB_NUM_THREADS='2', RAYON_NUM_THREADS='2', UV_THREADPOOL_SIZE='2', BLENDER_THREADS='2', ART_KTX_JOBS='1', ART_KTX_THREADS='2', TMPDIR=str(temp), MULE_ATTEMPT=str(out), PYTHONDONTWRITEBYTECODE='1')
            with (out / 'output.log').open('x') as log:
                # A child can execute before Popen returns; publish immutable limits first.
                (out / 'launch-limits.json').write_text(json.dumps(receipt['limits'], indent=2))
                proc = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                receipt['pid'] = receipt['pgid'] = proc.pid
                receipt['status'] = 'RUNNING'
                (out / 'started.json').write_text(json.dumps(receipt, indent=2))
                while proc.poll() is None:
                    if controller_lost(controller_fd):
                        reason='controller lost';break
                    state = resources()
                    rss = sum(r[3] for r in state['processes'] if r[2] == proc.pid)
                    peak = max(peak, rss)
                    reason,_=final_bounds(a,receipt['start'],cancelled,temp)
                    reason=reason or ('RSS limit' if rss>a.rss_mib*1024 else 'disk reserve' if state['disk_free']<8*1024**3 else None)
                    if reason:
                        break
                    time.sleep(1)
                code = proc.poll() if proc.poll() is not None else 124
        except BaseException as exc:
            reason = repr(exc)
        finally:
            # Signals only set a flag; repeated INT cannot interrupt the reap/unlock order.
            if proc:
                reaped,alive,errors=reap_group(proc)
                receipt.update(leader_reaped=reaped,leader_reap_method='waitpid by owning supervisor',descendant_settlement='process group absence; adopted descendants are not claimed as waitpid reaped',remaining_group=[proc.pid] if alive else [],cleanup_errors=errors)
                if not reaped or alive:
                    reason=reason or 'failed to terminate/reap group';code=125
            try:
                if controller_lost(controller_fd):
                    receipt['controller_lost']=True
                    reason=reason or 'controller lost'
                last_reason,counts=final_bounds(a,receipt['start'],cancelled,temp)
                receipt['final_bounds']=counts
                receipt['final_bounds_reason']=last_reason
                reason=reason or last_reason
            except BaseException as exc:
                receipt['final_bounds_error']=repr(exc)
                reason=reason or 'final bounds probe failed: '+repr(exc)
            receipt.update(end=time.time(), exit=code, reason=reason, peak_group_rss_kib=peak, status='PASS' if code == 0 and not reason else 'FAIL')
            publish_receipt(out,receipt,a)
            print(json.dumps({k: receipt[k] for k in ['status', 'exit', 'reason', 'peak_group_rss_kib']}), flush=True)
            if proc is None or (receipt.get('leader_reaped') and not receipt.get('remaining_group')):
                shutil.rmtree(ownership)
        return 0 if receipt['status'] == 'PASS' else 1


def launch():
    # The isolated supervisor owns both the lock and workload. A pipe whose only
    # writer is this foreground controller closes even when the harness SIGKILLs
    # the controller, so cleanup does not depend on its signal handler surviving.
    reader,writer=os.pipe()
    os.set_blocking(reader,False)
    stopped=[]
    def stop(sig,frame):
        nonlocal writer
        stopped.append(sig)
        if writer is not None:os.close(writer);writer=None
    for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP]:signal.signal(sig,stop)
    child=None
    try:
        child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--worker',str(reader),*sys.argv[1:]],
            stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
            pass_fds=(reader,),start_new_session=True)
        os.close(reader);reader=None
        # Worker owns finite wall/resource bounds; the controller only waits.
        code=child.wait()
        print(json.dumps({'supervisor_pid':child.pid,'supervisor_exit':code,'controller_signals':stopped}),flush=True)
        return code
    finally:
        if reader is not None:os.close(reader)
        if writer is not None:os.close(writer)
        if child is not None and child.poll() is None:
            # Never SIGKILL the cleanup owner. EOF triggers its bounded teardown.
            try:child.wait(timeout=35)
            except subprocess.TimeoutExpired:print('Supervisor did not settle in 35 seconds; ownership hold must be inspected',file=sys.stderr)


if __name__ == '__main__':
    if sys.argv[1:2]==['--worker']:
        fd=int(sys.argv[2]);del sys.argv[1:3]
        sys.exit(main(fd))
    sys.exit(launch())
