import os,sys,time,json,signal,subprocess
from pathlib import Path
F=Path(sys.argv[1]);role=sys.argv[2]
if role=='leaf':
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 (F/'leaf.json').write_text(json.dumps(dict(pid=os.getpid(),ppid=os.getppid(),pgid=os.getpgrp())))
 time.sleep(12)
else:
 (F/'leader.json').write_text(json.dumps(dict(pid=os.getpid(),pgid=os.getpgrp())))
 end=time.monotonic()+7
 while not (F/'fork-now').exists():
  if time.monotonic()>end:raise TimeoutError('no fork barrier')
  time.sleep(.005)
 leaf=subprocess.Popen([sys.executable,__file__,str(F),'leaf'])
 (F/'spawned.json').write_text(json.dumps(dict(leader=os.getpid(),leaf=leaf.pid,pgid=os.getpgrp())))
 # Same group, ordinary Popen, no daemonization or setsid.
 os._exit(0)
