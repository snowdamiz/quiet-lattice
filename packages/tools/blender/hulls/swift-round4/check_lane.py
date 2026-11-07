"""Exercise cancellation against an ignoring grandchild and reject a concurrent claimant."""
import subprocess,sys,time,os,signal,json
from pathlib import Path
lane=Path(__file__).with_name('lane.py');root=lane.resolve().parents[5];lock=lane.with_name('.lane-lock')
label=sys.argv[1] if len(sys.argv)>1 else '07-cancellation-proof'
child="import subprocess,sys,time,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(120)']); print('grandchild started',flush=True); time.sleep(120)"
p=subprocess.Popen([sys.executable,str(lane),'--label',label,'--timeout','30','--',sys.executable,'-c',child],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
job=root/'assets/renders/hulls/swift-round4-current'/label
for _ in range(80):
 if (job/'process.log').exists() and 'grandchild started' in (job/'process.log').read_text():break
 time.sleep(.1)
else:raise RuntimeError('test did not start')
second=subprocess.run([sys.executable,str(lane),'--label',label+'-contender','--timeout','20','--',sys.executable,'-c','print(1)'],capture_output=True,text=True)
assert second.returncode!=0 and not (job.parent/(label+'-contender')).exists()
p.send_signal(signal.SIGTERM);time.sleep(.05);p.send_signal(signal.SIGINT);time.sleep(.05);p.send_signal(signal.SIGINT)
out,err=p.communicate(timeout=20);assert p.returncode!=0
receipt=json.loads((job/'receipt.json').read_text());assert receipt['childGroupEmpty'] and not lock.exists()
result={'status':'PASS','cancelExit':p.returncode,'contenderExit':second.returncode,'contenderCreatedLog':False,'childGroupEmpty':receipt['childGroupEmpty'],'lockReleased':not lock.exists(),'repeatedSIGINT':2,'parentSIGTERM':True}
# The lane has ended; this result has exclusive creation and does not modify its receipt.
with (job/'test-result.json').open('x') as f:json.dump(result,f,indent=2)
print(json.dumps(result))
