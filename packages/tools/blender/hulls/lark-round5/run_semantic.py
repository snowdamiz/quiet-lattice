"""Bounded CPU-only task runner; one Blender process, process-tree RSS watchdog."""
import os,sys,subprocess,time,shutil,json
from pathlib import Path
out=Path(__file__).resolve().parent
scratch=out/'scratch';scratch.mkdir(exist_ok=True)
env=dict(os.environ,OMP_NUM_THREADS='2',OPENBLAS_NUM_THREADS='2',VECLIB_MAXIMUM_THREADS='2',MKL_NUM_THREADS='2',ART_KTX_JOBS='1',TMPDIR=str(scratch),LARK_NODE='/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node',LARK_ATTEMPT_ID='r5b')
assert shutil.disk_usage(out).free>=12*1024**3
start=time.monotonic();peak=0
with (out/'semantic-stage.log').open('w') as log:
 p=subprocess.Popen(['/Applications/Blender.app/Contents/MacOS/Blender','-b','--factory-startup','-t','2','--python-exit-code','1',*sys.argv[1:]],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 while p.poll() is None:
  rows=[list(map(int,l.split())) for l in subprocess.check_output(['ps','-axo','pid=,ppid=,rss='],text=True).splitlines()]
  ids={p.pid}
  for _ in range(12):ids.update(pid for pid,ppid,rss in rows if ppid in ids)
  rss=sum(rss for pid,ppid,rss in rows if pid in ids)*1024;peak=max(peak,rss)
  size=sum(f.stat().st_size for f in scratch.rglob('*') if f.is_file())
  if rss>8*1024**3 or size>6*1024**3 or time.monotonic()-start>2700 or shutil.disk_usage(out).free<12*1024**3:
   os.killpg(p.pid,15);p.wait();raise RuntimeError('resource gate exceeded')
  time.sleep(1)
(out/'semantic-stage-resource.json').write_text(json.dumps(dict(exit=p.returncode,peak_rss=peak,seconds=time.monotonic()-start)))
sys.exit(p.returncode)
