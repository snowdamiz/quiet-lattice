"""One owned CPU process group; immutable attempt logs, bounded resources, reap before unlock."""
import argparse, json, os, signal, subprocess, sys, time, shutil, hashlib, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
EVIDENCE = ROOT / 'assets/renders/hulls/swift-round4-current'
LOCK = Path(__file__).with_name('.lane-lock')

def processes():
    rows = subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,rss=,stat='], text=True)
    return [line.split() for line in rows.splitlines() if line.strip()]

def resources():
    rows = processes()
    vm = subprocess.check_output(['vm_stat'],text=True)
    counts = {line.split(':')[0]: int(line.split(':')[1].strip().strip('.')) for line in vm.splitlines()[1:] if ':' in line}
    return {'diskFree': shutil.disk_usage(ROOT).free,
            'memoryFreeInactive': (counts['Pages free']+counts['Pages inactive'])*16384,
            'allRssKiB': sum(int(row[3]) for row in rows), 'vmStat': vm}

def existing_sizes(paths):
    for path in paths:
        try:
            size=path.stat().st_size
        except FileNotFoundError:
            continue  # Blender/encoder scratch files can disappear after enumeration.
        if path.is_file():
            yield path,size

def output_usage():
    total=count=image_bytes=0
    for folder,dirs,names in os.walk(EVIDENCE):
        for path,size in existing_sizes(Path(folder)/name for name in names):
            total+=size
            if path.suffix.lower() in ('.png','.jpg','.jpeg','.webp') and 'scratch' not in path.relative_to(EVIDENCE).parts:
                count+=1;image_bytes+=size
    return total,count,image_bytes

def main():
    p=argparse.ArgumentParser();p.add_argument('--label',required=True);p.add_argument('--timeout',type=int,default=600)
    p.add_argument('--rss-mib',type=int,default=10000);p.add_argument('command',nargs=argparse.REMAINDER);a=p.parse_args()
    command=a.command[1:] if a.command[:1]==['--'] else a.command
    assert command and '/' not in a.label and a.timeout <= 3600
    if Path(__file__).with_name('HEAVY_HOLD.json').exists():
        raise SystemExit('Parent resource hold active: no new lane admissions until explicit parent release.')
    LOCK.mkdir()  # Acquire ownership before creating any attempt log/receipt.
    child=None; guardian=None; guardian_write=None; temp_alias=None; receipt=None; reason=None; code=1; start=time.monotonic(); peak=0; job=None
    def cancel(sig,frame):
        nonlocal reason
        reason=reason or f'cancelled signal {sig}'
    for sig in (signal.SIGTERM,signal.SIGINT): signal.signal(sig,cancel)
    try:
        (LOCK/'owner.json').write_text(json.dumps({'pid':os.getpid(),'cwd':str(ROOT),'label':a.label}))
        job=EVIDENCE/a.label;job.mkdir(parents=True,exist_ok=False)
        receipt={'inputs':{str(p.relative_to(ROOT)):{'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest(),'bytes':p.stat().st_size} for p in [ROOT/'assets/blend/hulls/swift.blend',ROOT/'packages/client/public/models/hulls/swift.glb'] if p.exists()},'command':command,'cwd':str(ROOT),'preflight':resources(),'timeout':a.timeout,'rssLimitMiB':a.rss_mib}
        if receipt['preflight']['diskFree']<8*1024**3 or receipt['preflight']['memoryFreeInactive']<2*1024**3:
            raise RuntimeError('preflight resource floor')
        env=os.environ.copy()
        env.update({k:'2' for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','NUMEXPR_NUM_THREADS','BLENDER_THREADS','ART_KTX_THREADS']})
        scratch=job/'scratch';scratch.mkdir()
        temp_alias=Path('/tmp')/f'swift-r4-{os.getpid()}'
        temp_alias.symlink_to(scratch,target_is_directory=True)
        receipt['temporaryAlias']={'path':str(temp_alias),'target':str(scratch)}
        env.update({'ART_KTX_JOBS':'1','PYTHONDONTWRITEBYTECODE':'1','SWIFT_JOB':str(job),'TMPDIR':str(temp_alias),'SWIFT_TEMP_ALIAS':str(temp_alias)})
        with (job/'launch.json').open('x') as f: json.dump(receipt,f,indent=2)
        with (job/'process.log').open('xb') as log:
            child=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            receipt['pid']=child.pid
            guardian_read,guardian_write=os.pipe()
            guardian=subprocess.Popen([sys.executable,str(Path(__file__).with_name('guardian.py')),str(guardian_read),str(child.pid),str(os.getpid()),str(a.timeout)],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,pass_fds=(guardian_read,),start_new_session=True)
            os.close(guardian_read)
            receipt['guardianPid']=guardian.pid
            while child.poll() is None:
                rows=processes();rss=sum(int(r[3]) for r in rows if int(r[2])==child.pid);peak=max(peak,rss)
                if rss>a.rss_mib*1024: reason=reason or 'RSS limit'
                if time.monotonic()-start>a.timeout: reason=reason or 'wall limit'
                total,picture_count,picture_bytes=output_usage()
                if picture_count>48 or picture_bytes>512*1024**2: reason=reason or 'image budget'
                if total>8*1024**3: reason=reason or 'output size limit'
                if log.tell()>16*1024**2 or (job/'process.log').stat().st_size>16*1024**2: reason=reason or 'log limit'
                if shutil.disk_usage(ROOT).free<6*1024**3: reason=reason or 'disk floor'
                if reason: break
                time.sleep(.5)
            if not reason: code=child.wait()
    except BaseException as exc:
        reason=reason or f'{type(exc).__name__}: {exc}';traceback.print_exc()
    finally:
        for sig in (signal.SIGTERM,signal.SIGINT): signal.signal(sig,signal.SIG_IGN)
        group_empty=True
        if child:
            for sig,limit in ((signal.SIGTERM,5),(signal.SIGKILL,10)):
                try: os.killpg(child.pid,sig)
                except ProcessLookupError: pass
                until=time.monotonic()+limit
                while time.monotonic()<until:
                    child.poll()
                    members=[r for r in processes() if int(r[2])==child.pid]
                    if not members: break
                    time.sleep(.1)
                if not members: break
            child.wait()
            group_empty=not [r for r in processes() if int(r[2])==child.pid]
        if guardian_write is not None:
            try: os.write(guardian_write,b'complete')
            except BrokenPipeError: pass
            os.close(guardian_write)
        if guardian is not None:
            guardian.wait(timeout=20)
            group_empty=group_empty and guardian.returncode==0
        if group_empty and temp_alias is not None and temp_alias.is_symlink():
            assert os.readlink(temp_alias)==str(job/'scratch')
            temp_alias.unlink()
        if receipt:
            receipt.update(exit=code if not reason else 1,reason=reason,seconds=round(time.monotonic()-start,2),peakRssKiB=peak,childGroupEmpty=group_empty,postflight=resources())
            with (job/'receipt.json').open('x') as f: json.dump(receipt,f,indent=2)
            print(json.dumps({k:receipt[k] for k in ['exit','reason','seconds','peakRssKiB','childGroupEmpty']}),flush=True)
        if group_empty:
            (LOCK/'owner.json').unlink(missing_ok=True);LOCK.rmdir()
        else:
            print('GROUP STILL PRESENT: LOCK RETAINED',file=sys.stderr);code=1
    return 1 if reason else code

if __name__=='__main__': sys.exit(main())
