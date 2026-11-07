"""Reap the owned command group if the lane runner vanishes, including a harness hard interruption."""
import json,os,select,signal,subprocess,sys,time
from pathlib import Path
fd,pgid,parent,wall=map(int,sys.argv[1:]);job=Path(os.environ['SWIFT_JOB'])
for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,signal.SIG_IGN)
def members():
 return [r for r in subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,rss='],text=True).splitlines() if int(r.split()[2])==pgid]
ready,_,_=select.select([fd],[],[],wall+30)
message=os.read(fd,64) if ready else b'watchdog timeout';os.close(fd)
reason='normal runner completion' if message==b'complete' else 'runner disappeared' if not message else 'watchdog timeout'
actions=[]
for sig,limit in [(signal.SIGTERM,5),(signal.SIGKILL,10)]:
 if not members():break
 try:os.killpg(pgid,sig);actions.append(signal.Signals(sig).name)
 except ProcessLookupError:pass
 until=time.monotonic()+limit
 while members() and time.monotonic()<until:time.sleep(.1)
remaining=members()
alias=Path(os.environ['SWIFT_TEMP_ALIAS']) if os.environ.get('SWIFT_TEMP_ALIAS') else None
if not remaining and alias is not None and alias.is_symlink():
 assert os.readlink(alias)==str(job/'scratch')
 alias.unlink()
with (job/'guardian.json').open('x') as f:json.dump({'reason':reason,'parentPid':parent,'commandGroup':pgid,'signals':actions,'childGroupEmpty':not remaining,'remaining':remaining},f,indent=2)
sys.exit(1 if remaining else 0)
