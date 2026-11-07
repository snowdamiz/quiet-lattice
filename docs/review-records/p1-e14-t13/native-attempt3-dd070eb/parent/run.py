import os,json,subprocess,datetime,time
from pathlib import Path
p=Path(__file__).parent; d=json.loads((p/'dispatch.json').read_text()); start=time.monotonic()
with (p/'stdout.txt').open('xb') as out,(p/'stderr.txt').open('xb') as err:
 child=subprocess.Popen(d['argv'],cwd=d['cwd'],env={**os.environ,**d['env']},stdout=out,stderr=err)
 with (p/'started.json').open('x') as f:json.dump({'pid':child.pid,'wrapperPid':os.getpid(),'at':datetime.datetime.now(datetime.timezone.utc).isoformat()},f)
 rc=child.wait()
r={'exitCode':rc,'wallSeconds':time.monotonic()-start,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
with (p/'exit.json').open('x') as f:json.dump(r,f,indent=2)
print(json.dumps(r),flush=True)
raise SystemExit(rc)
