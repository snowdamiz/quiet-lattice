"""One CPU Blender process in this task lane; exclusive receipts and bounded descendants."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import re
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[5]
EVIDENCE = ROOT / 'assets/renders/hulls/lark-round3-current/density-20261107'
RSS_CAP_MIB = 8192
GROWTH_CAP_MIB = 6144
DISK_FLOOR = 12 * 1024**3
WALL_CAP = 2700
FAUNA_RESERVE = 0  # Parent confirmed physical GPU release at 2026-11-07T12:37:23Z.
ADMISSION_FREE = DISK_FLOOR + GROWTH_CAP_MIB*1024**2 + FAUNA_RESERVE


def checked(command, **kwargs):
    return subprocess.check_output(command, timeout=10, **kwargs)


def guarded_dispatch(cmd, env, log, prefix, seconds):
    """The group exists but cannot exec Blender/Node until its guardian is ready."""
    read_fd,write_fd=os.pipe()
    proc=watchdog=None
    terminal=prefix.with_suffix('.watchdog.json')
    registration=prefix.with_suffix('.guardian-registration.json')
    try:
        proc=subprocess.Popen([sys.executable,str(Path(__file__).with_name('density_dispatch.py')),str(read_fd),json.dumps(cmd)],
             cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,pass_fds=(read_fd,))
        os.close(read_fd);read_fd=-1
        watchdog=subprocess.Popen([sys.executable,str(Path(__file__).with_name('density_guardian.py')),
             str(os.getpid()),str(proc.pid),str(seconds+10),str(terminal),str(registration)],
             env=env,start_new_session=True,stdout=log,stderr=subprocess.STDOUT)
        deadline=time.monotonic()+10
        while not registration.exists():
            if proc.poll() is not None or watchdog.poll() is not None or time.monotonic()>deadline:
                raise RuntimeError('Guardian registration failed; heavy dispatch refused')
            time.sleep(.05)
        registered=json.loads(registration.read_text())
        assert registered['guardian_pid']==watchdog.pid and registered['process_group']==proc.pid
        os.write(write_fd,b'RUN\n')
        return proc,watchdog,terminal,registered
    except BaseException:
        if proc is not None:
            if proc.poll() is None:os.killpg(proc.pid,signal.SIGKILL)
            proc.wait(timeout=10)
        if watchdog is not None:watchdog.wait(timeout=15)
        raise
    finally:
        if read_fd>=0:os.close(read_fd)
        os.close(write_fd)


def digest(path):
    p = ROOT / path
    return {'path': path, 'bytes': p.stat().st_size, 'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()} if p.exists() else None


def directory_bytes(path):
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())


def latest_resource_control():
    """Only append-only scheduling directives can release a parent hold."""
    controls = sorted(
        p for p in (EVIDENCE / 'resource-controls').glob('*.json')
        if re.fullmatch(r'\d{8}T\d{12}Z-(hold|release)\.json', p.name)
    )
    if not controls:
        return None, None
    path = controls[-1]
    control = json.loads(path.read_text())
    expected = 'held' if path.name.endswith('-hold.json') else 'released'
    if control.get('state') != expected:
        raise ValueError(f'Invalid resource directive; no child admitted: {path}')
    return path, control


def canonical_output_sizes(assets):
    """Include replacement-save temporaries beside the two authorized assets."""
    sizes = {}
    for asset in assets:
        path = ROOT / asset
        for candidate in path.parent.glob(path.name + '*'):
            try:
                if candidate.is_file():
                    sizes[str(candidate.relative_to(ROOT))] = candidate.stat().st_size
            except FileNotFoundError:
                pass  # A completed atomic save may retire its temporary path.
    return sizes


def capacity(rss_mib,growth_mib):
    disk=shutil.disk_usage(ROOT)
    vm=checked(['vm_stat'],text=True)
    pressure=int(checked(['sysctl','-n','kern.memorystatus_vm_pressure_level'],text=True))
    total=int(checked(['sysctl','-n','hw.memsize'],text=True))
    rows=checked(['ps','-axo','pid=,ppid=,pgid=,rss=,command='],text=True)
    tree=[(int(v[0]),int(v[1]),int(v[2]),int(v[3]),v[4]) for r in rows.splitlines() if len(v:=r.strip().split(None,4))==5]
    roots={p for p,pp,pg,rss,c in tree if c.startswith('/Applications/Blender.app/Contents/MacOS/Blender')}
    ids=set(roots)
    while True:
        more={p for p,pp,pg,rss,c in tree if pp in ids}
        if more <= ids:break
        ids |= more
    cohort=sum(rss for p,pp,pg,rss,c in tree if p in ids)
    return {'admitted':pressure==1 and not roots and rss_mib<=RSS_CAP_MIB and disk.free>=ADMISSION_FREE,
      'time_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'disk_free_bytes':disk.free,'disk_reserve_bytes':DISK_FLOOR,
      'fauna_reserved_bytes':FAUNA_RESERVE,'required_free_before_every_stage':ADMISSION_FREE,
      'host_ram_bytes':total,'vm_pressure_level':pressure,'vm_stat':vm,'cohort_rss_kib':cohort,'cohort_cap_mib':RSS_CAP_MIB,
      'requested_tree_mib':rss_mib,'requested_growth_mib':growth_mib,'evidence_bytes':directory_bytes(EVIDENCE),
      'cohort_processes':[{'pid':p,'ppid':pp,'pgid':pg,'rss_kib':rss,'command':c} for p,pp,pg,rss,c in tree if p in ids],
      'basis':'Parent r3 release: reserve full 6 GiB stage growth plus 12 GiB floor before EVERY stage; fauna reservation explicitly released at 12:37:23Z; no history cleanup'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('label')
    ap.add_argument('--node',action='store_true')
    ap.add_argument('--seconds', type=int, default=1800)
    ap.add_argument('--rss-mib', type=int, required=True)
    ap.add_argument('--growth-mib', type=int, default=768)
    ap.add_argument('args', nargs=argparse.REMAINDER)
    a = ap.parse_args()
    if not (0<a.seconds<=WALL_CAP and 0<a.rss_mib<=RSS_CAP_MIB and 0<a.growth_mib<=GROWTH_CAP_MIB):
        ap.error('Stage exceeds parent wall/RSS/disk-growth bounds')
    args = a.args[1:] if a.args[:1] == ['--'] else a.args
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    control_path, control = latest_resource_control()
    if control and control['state']=='held':
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        refusal={'admitted':False,'reason':'parent heavy-resource hold','control':str(control_path.relative_to(ROOT)),'label':a.label,'child_started':False}
        with (EVIDENCE/(stamp+'-'+a.label+'.admission-denied.json')).open('x') as f:json.dump(refusal,f,indent=2)
        print(json.dumps(refusal,indent=2))
        return 125
    lock = (EVIDENCE.parent / '.lane.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    prefix = EVIDENCE / (stamp + '-' + a.label)
    log = prefix.with_suffix('.log').open('xb')
    scratch = Path(tempfile.mkdtemp(prefix='lr3-',dir='/tmp'))
    scratch.chmod(0o700)
    node = Path('/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node')
    assert checked([str(node),'--version'],text=True).strip()=='v22.23.3'
    env = dict(os.environ, OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2', VECLIB_MAXIMUM_THREADS='2', NUMEXPR_NUM_THREADS='2', BLIS_NUM_THREADS='2', ART_KTX_JOBS='1', PYTHONDONTWRITEBYTECODE='1', TMPDIR=str(scratch), KTX='/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx', LARK_NODE=str(node), LARK_ATTEMPT_ID=prefix.name, PATH=str(node.parent)+os.pathsep+os.environ['PATH'])
    cmd = ([str(node)] if a.node else ['/Applications/Blender.app/Contents/MacOS/Blender', '-b', '-t', '2', '--factory-startup', '--python-exit-code', '1']) + args
    assets = ['assets/blend/hulls/lark.blend', 'packages/client/public/models/hulls/lark.glb']
    before = [digest(p) for p in assets]
    canonical_sizes_before = canonical_output_sizes(assets)
    code_inputs = [digest(p) for p in args if p.endswith('.py') and (ROOT/p).is_file()]
    for i,entry in enumerate(code_inputs):
        snapshot=Path(str(prefix)+f'.input-{i}.py')
        snapshot.write_bytes((ROOT/entry['path']).read_bytes())
        entry['snapshot']=str(snapshot.relative_to(ROOT))
    head = checked(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    admission = capacity(a.rss_mib, a.growth_mib)
    prefix.with_suffix('.admission.json').write_text(json.dumps(admission,indent=2)+'\n')
    if not admission['admitted']:
        log.close()
        print(json.dumps(admission,indent=2))
        return 125
    start = time.monotonic()
    peak_cohort=0
    peak_growth=0
    proc,watchdog,watchdog_path,registration = guarded_dispatch(cmd,env,log,prefix,a.seconds)
    peak = 0
    peak_codecs = 0
    observed = {}
    reason = None
    def signal_group(sig):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            pass
        except PermissionError:
            # macOS may report EPERM for an already-dead process group. Do not
            # lose the receipt after a successful interrupt and reap.
            if proc.poll() is None:
                proc.send_signal(sig)
    def stop(signum=None, frame=None):
        nonlocal reason
        reason = reason or f'interrupted:{signum}'
        signal_group(signal.SIGTERM)
    old = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        while proc.poll() is None:
            rows = checked(['ps', '-axo', 'pid=,ppid=,pgid=,rss=,command='], text=True)
            tree = [(int(v[0]),int(v[1]),int(v[2]),int(v[3]),v[4]) for r in rows.splitlines() if len(v:=r.strip().split(None,4))==5]
            ids = {proc.pid}
            while True:
                more = {p for p, pp, pg, rss, command in tree if pp in ids or pg==proc.pid}
                if more <= ids:
                    break
                ids |= more
            tree_rss = sum(row_rss for p, pp, pg, row_rss, command in tree if p in ids or p in (os.getpid(),watchdog.pid))
            for p,pp,pg,row_rss,command in tree:
                if p in ids and not command.startswith('('):observed[p]={'pid':p,'ppid':pp,'pgid':pg,'command':command}
            peak = max(peak, tree_rss)
            cohort_ids={p for p,pp,pg,rss,c in tree if c.startswith('/Applications/Blender.app/Contents/MacOS/Blender')}
            while True:
                more={p for p,pp,pg,rss,c in tree if pp in cohort_ids}
                if more <= cohort_ids: break
                cohort_ids |= more
            cohort=sum(rss for p,pp,pg,rss,c in tree if p in cohort_ids)
            peak_cohort=max(peak_cohort,cohort)
            canonical_growth = sum(canonical_output_sizes(assets).values()) - sum(canonical_sizes_before.values())
            growth=directory_bytes(EVIDENCE)+directory_bytes(scratch)-admission['evidence_bytes']+max(0, canonical_growth)
            peak_growth=max(peak_growth,growth)
            if cohort>RSS_CAP_MIB*1024:reason='cohort RSS limit'
            if shutil.disk_usage(ROOT).free < DISK_FLOOR+FAUNA_RESERVE:reason='disk/fauna reserve'
            if growth>a.growth_mib*1024**2:reason='job disk growth limit'
            codecs=[p for p,pp,pg,row_rss,command in tree if p in ids and '/ktx ' in command]
            peak_codecs=max(peak_codecs,len(codecs))
            image_sizes = []
            for path in list(EVIDENCE.rglob('*'))+list(scratch.rglob('*')):
                if path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.exr'):
                    continue
                try:
                    image_sizes.append(path.stat().st_size)
                except FileNotFoundError:
                    pass
            if time.monotonic() - start > a.seconds:
                reason = 'wall limit'
            if tree_rss > a.rss_mib * 1024:
                reason = 'RSS limit'
            blender_roots=[p for p,pp,pg,rss,c in tree if p in ids and c.startswith('/Applications/Blender.app/Contents/MacOS/Blender')]
            if len(blender_roots)>1:
                reason = 'Blender concurrency limit'
            if len(codecs)>1:
                reason = 'codec concurrency limit'
            if log.tell() > 16 * 1024**2:
                reason = 'log limit'
            if len(list(EVIDENCE.rglob('*.png'))) > 12 or sum(p.stat().st_size for p in EVIDENCE.rglob('*.png')) > 128*1024**2:
                reason = 'image budget'
            if reason:
                stop()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    signal_group(signal.SIGKILL)
                break
            time.sleep(.1)
        code = proc.wait()
    finally:
        signal_group(signal.SIGKILL)
        proc.wait(timeout=10)
        watchdog.wait(timeout=15)
        log.close()
        for s, handler in old.items():
            signal.signal(s, handler)
        receipt = {'command': cmd, 'cwd': str(ROOT), 'head_at_start':head, 'code_inputs':code_inputs, 'lane': 'lark-t2', 'thread_environment': {k: env[k] for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','NUMEXPR_NUM_THREADS','BLIS_NUM_THREADS','ART_KTX_JOBS']}, 'wall_limit_seconds': a.seconds, 'rss_limit_mib': a.rss_mib, 'elapsed_seconds': round(time.monotonic()-start, 3), 'peak_tree_rss_kib': peak, 'exit_code': proc.returncode, 'termination_reason': reason, 'before': before, 'after': [digest(p) for p in assets], 'log': str(prefix.with_suffix('.log').relative_to(ROOT)), 'private_tmpdir':str(scratch),'tmpdir_mode':oct(scratch.stat().st_mode&0o777),'node':str(node),'node_version':'22.23.3','observed_processes':list(observed.values()),'watchdog_receipt':str(watchdog_path.relative_to(ROOT)),'cleanup':json.loads(watchdog_path.read_text()),'private_tmpdir_preserved':True}
        receipt['peak_codec_processes']=peak_codecs
        receipt['supervisor_pid']=os.getpid()
        receipt['child_process_group']=proc.pid
        receipt['guardian']={'pid':watchdog.pid,'process_group':watchdog.pid,'exit_code':watchdog.returncode,'wait_completed':True}
        receipt['guardian_registration_before_dispatch']=registration
        receipt['admission']=admission
        receipt['peak_cohort_rss_kib']=peak_cohort
        receipt['peak_new_disk_bytes']=peak_growth
        receipt['canonical_output_sizes_before']=canonical_sizes_before
        receipt['canonical_output_sizes_after']=canonical_output_sizes(assets)
        receipt['disk_growth_scope']='New evidence and private scratch plus positive growth of canonical files and adjacent replacement-save temporaries; existing history preserved'
        receipt['process_sample_interval_seconds']=.1
        receipt['rss_scope']='Dispatched process group and descendants plus supervisor and registered guardian; aggregate sum'
        prefix.with_suffix('.json').write_text(json.dumps(receipt, indent=2)+'\n')
        print(json.dumps(receipt, indent=2))
    return code if not reason else 124


if __name__ == '__main__':
    raise SystemExit(main())
