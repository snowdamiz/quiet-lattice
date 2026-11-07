"""Exclusive, bounded CPU jobs with immutable receipts. No art or validation overrides."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
EVIDENCE = ROOT / 'assets/blend/flora/trees/evidence'
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
KINDS = ('round','conifer','palm','mushroom','spiral','coral','blob','cactus')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def group(pid):
    rows = subprocess.check_output(['ps','-axo','pid=,pgid=,rss='],text=True).splitlines()
    return [(int(p),int(r)) for line in rows for p,g,r in [line.split()] if int(g)==pid]


def stop(pid):
    for sig in (signal.SIGTERM,signal.SIGKILL):
        if not group(pid): break
        try: os.killpg(pid,sig)
        except ProcessLookupError: pass
        until=time.monotonic()+3
        while group(pid) and time.monotonic()<until: time.sleep(.1)
    return group(pid)


def main():
    interrupted=[]
    def interrupt(signum, _frame):
        interrupted.append(signum)
    signal.signal(signal.SIGTERM,interrupt)
    signal.signal(signal.SIGINT,interrupt)
    ap=argparse.ArgumentParser()
    ap.add_argument('action',choices=('author','seal','export','validate','preview','audit','packet'))
    ap.add_argument('kind',choices=KINDS)
    ap.add_argument('--deadline',type=int,default=900)
    args=ap.parse_args()
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    with open(EVIDENCE/'.lane.lock','a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: print('T04 lane already owned'); return 75
        # Acquire ownership before creating logs or touching output identities.
        run=EVIDENCE/(time.strftime('%Y%m%dT%H%M%S')+'_'+args.action+'_'+args.kind+'_'+uuid.uuid4().hex[:8])
        run.mkdir()
        source=ROOT/'assets/blend/flora'/f'tree_{args.kind}_t04.blend'
        export=ROOT/'packages/client/public/models/flora'/f'tree_{args.kind}_t04.glb'
        resources={
            'load':os.getloadavg(),'free_disk':shutil.disk_usage(ROOT).free,
            'memory':subprocess.check_output(['memory_pressure'],text=True).splitlines()[-1],
            'processes':subprocess.check_output(['ps','-axo','pid,pcpu,rss,comm'],text=True).splitlines()
        }
        resources['processes']=sorted(resources['processes'][1:],key=lambda s:float(s.split()[1]),reverse=True)[:15]
        receipt={'action':args.action,'kind':args.kind,'cwd':str(ROOT),
                 'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                 'resources':resources,'source':str(source.relative_to(ROOT)),
                 'output':str(export.relative_to(ROOT)),'source_before':sha(source),
                 'deadline_s':args.deadline,'rss_limit_mib':6144,'log_limit_mib':32}
        script={'author':HERE/'author.py','seal':HERE/'seal.py','export':HERE/'export_saved.py',
                'validate':HERE.parent/'validate.py','preview':HERE/'preview.py','audit':HERE/'audit.py','packet':HERE/'packet.py'}[args.action]
        extra={
            'author':[args.kind],
            'seal':[args.kind],
            'export':[args.kind,str(run)],
            'validate':['--family','flora','--report-dir',str(run/'reports'),str(source),str(export)],
            'preview':[args.kind,str(run)],
            'audit':[args.kind,str(run)],
            'packet':[str(run)]
        }[args.action]
        cmd=[BLENDER,'-b','--factory-startup','-t','2','--python-exit-code','1','--python',str(script),'--',*extra]
        env=os.environ.copy()
        for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS','VECLIB_MAXIMUM_THREADS'):
            env[key]='2'
        env.update(ART_KTX_JOBS='1',PYTHONDONTWRITEBYTECODE='1',CUDA_VISIBLE_DEVICES='',
                   KTX=str(HERE/'ktx_one.py'),
                   T04_CODEC_LOCK=str(EVIDENCE/'.codec.lock'),
                   T04_KTX_REAL='/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx')
        receipt['command']=cmd
        receipt['tool_hashes']={str(p.relative_to(ROOT)):sha(p) for p in HERE.iterdir() if p.suffix in ('.py','.mjs')}
        receipt['environment']={k:env[k] for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS','VECLIB_MAXIMUM_THREADS','ART_KTX_JOBS','PYTHONDONTWRITEBYTECODE','CUDA_VISIBLE_DEVICES','KTX','T04_KTX_REAL','T04_CODEC_LOCK')}
        receipt['codec_threads']=1
        rc=75; reason='admission'; peak=0; survivors=[]; start=time.monotonic()
        if resources['load'][0]>20 or resources['free_disk']<12*1024**3:
            receipt['reason']='contention; no Blender launched'
        else:
            candidate=EVIDENCE.parent/'candidate.json'
            if args.action in ('author','seal','export') and candidate.exists():
                shutil.move(str(candidate),str(run/'previous-candidate.json'))
            if (args.action in ('author','seal') or (args.action=='export' and export.exists())) and source.exists():
                shutil.copyfile(source,run/'previous-source.blend')
            if args.action in ('author','seal','export') and export.exists():
                # A new attempt invalidates the old authoritative export before starting.
                shutil.move(str(export),str(run/'previous-historical.glb'))
            with open(run/'process.log','xb') as log:
                child=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                receipt['pid']=child.pid
                try:
                    while child.poll() is None:
                        rss=sum(r for _,r in group(child.pid)); peak=max(peak,rss)
                        if interrupted: reason='interrupted'; break
                        if time.monotonic()-start>args.deadline: reason='deadline'; break
                        if rss>6144*1024: reason='RSS limit'; break
                        if log.tell()>32*1024**2: reason='log limit'; break
                        time.sleep(.2)
                    else: reason='exit'
                    if child.poll() is None: stop(child.pid)
                    rc=child.wait(timeout=10)
                finally:
                    survivors=stop(child.pid)
                    if child.poll() is None: child.wait(timeout=10)
            receipt['reason']=reason
            if args.action=='export' and (rc!=0 or reason!='exit') and export.exists():
                shutil.move(str(export),str(run/'failed-historical.glb'))
        receipt.update(exit=rc,elapsed_s=round(time.monotonic()-start,3),peak_group_rss_kib=peak,
                       remaining_owned_children=survivors,source_after=sha(source),export_sha256=sha(export))
        if args.action not in ('author','seal') and receipt['source_before']!=receipt['source_after']:
            receipt['source_mutation']=True; rc=1
        receipt['source_unchanged']=receipt['source_before']==receipt['source_after']
        with open(run/'receipt.json','x') as f: json.dump(receipt,f,indent=2); f.write('\n')
        print(json.dumps({'receipt':str((run/'receipt.json').relative_to(ROOT)),'exit':rc,'reason':receipt['reason'],'peak_rss_mib':round(peak/1024,1)}),flush=True)
        return rc


if __name__=='__main__': sys.exit(main())
