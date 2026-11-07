import sys,os,json,ast,hashlib,tempfile,stat,signal,contextlib,subprocess,time,copy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode=True
O=Path(__file__).parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';sys.path.insert(0,str(A))
import caller,native189 as native,resource_admission as res,release_accounting as accounting,packet_budget as budget
READY=json.loads((A/'readiness.json').read_text());PLAN=json.loads((A/'native189-plan.json').read_text());RESULTS=[]
f=A/'retained-station/round4_job_boundary.py';t=ast.parse(f.read_text());t.body=[n for n in t.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='inert_exact',__file__=str(f),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(t,str(f),'exec'),core)
def save(name,**value):
 RESULTS.append(dict(name=name,**value));(O/'independent-results.json').write_text(json.dumps(RESULTS,indent=2));print(name,value.get('status'),flush=True)
def root(name):p=O/name;p.mkdir();return p
class IO:
 def __init__(self):self.fds={};self.opens=[];self.reads=[]
 def install(self,s,before=lambda p,f:None):
  op,rd,cl=os.open,os.read,os.close
  def opening(n,flags,*a,**k):
   p=Path(n) if Path(n).is_absolute() else self.fds[k['dir_fd']]/n
   before(p,flags);fd=op(n,flags,*a,**k);self.fds[fd]=p;self.opens.append(dict(path=str(p),name=str(n),dirFd=k.get('dir_fd'),flags=flags));return fd
  def reading(fd,n):b=rd(fd,n);self.reads.append(dict(path=str(self.fds[fd]),requested=n,bytes=len(b)));return b
  for v in [patch.object(os,'open',opening),patch.object(os,'read',reading)]:s.enter_context(v)
 def closed(self):
  for fd in self.fds:
   try:os.fstat(fd)
   except OSError:pass
   else:raise AssertionError('leaked descriptor')

def cache(mode):
 p=root('cache-'+mode);c=p/'cache';c.mkdir();a=c/'a';b=c/'b';a.write_bytes(b'abcd');b.write_bytes(b'efgh');obs=[];io=IO();error=None;fired=False
 lease=res.CacheLease([c],p,p/'lock',p/'archive',obs,lambda *a:dict(owners=[]))
 if mode=='copy-charge':lease.acquire()
 if mode=='unreadable':
  hidden=c/'hidden';hidden.mkdir();(hidden/'extra').write_bytes(b'x'*16);hidden.chmod(0)
  try:list(os.scandir(hidden))
  except PermissionError:permission=True
  else:raise AssertionError('mode000 did not deny real scandir')
 def before(path,flags):
  nonlocal fired
  if mode in ['hash-charge','copy-charge'] and path in [a,b] and not flags&os.O_DIRECTORY and not fired:
   fired=True;a.write_bytes(b'A'*8);b.write_bytes(b'B'*8)
 try:
  with contextlib.ExitStack() as s:
   s.enter_context(patch.object(res,'CACHE_BYTES',8));io.install(s,before)
   try:
    if mode=='copy-charge':lease.copy('later',lease.initial)
    else:lease.check()
   except BaseException as e:error=e
  assert error is not None
  if mode!='unreadable':assert fired and sum(x['bytes'] for x in io.reads)==0
  else:assert isinstance(error,PermissionError)
  io.closed();save('cache-'+mode,status='PASS',failure=caller.error_receipt(error),opens=io.opens,reads=io.reads,observations=obs)
 finally:
  if mode=='unreadable':hidden.chmod(0o700)
for m in ['hash-charge','copy-charge','unreadable']:cache(m)

def final_fixture(name):
 p=root(name);(p/'packet').mkdir();(p/'proof').mkdir();plan={**PLAN,'runRoot':str(p)}
 for rel in plan['packetFilesBeforeTerminal']:
  q=p/'packet'/rel;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(b'{}')
 video=p/'packet/captures/motion-thalune-run-lod0/primary.mp4';mapping=video.with_name('frame-map.json')
 val=p/'packet/inspections/native-189-validate/validation.json';val.write_text(json.dumps(dict(accepted=True,frames=189,everyRgbAndRgbaHash=True,videoSha256=hashlib.sha256(video.read_bytes()).hexdigest(),frameMapSha256=hashlib.sha256(mapping.read_bytes()).hexdigest())))
 (val.parent/'surplus-refusal.json').write_text(json.dumps(dict(accepted=False,frames=190,expectedRefusal=True)))
 adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.plan=plan;adapter.core=SimpleNamespace(deadline=core['deadline']);events=[]
 def run(d,h):
  events.append(d['id']);rp=Path(h['path']);rp.parent.mkdir(parents=True)
  receipt=dict(name=d['id'],primaryFailure=None,cleanupFailure=None,persistenceFailures=[],outcome='completed',exits={'capture':0},terminal=dict(registrationAbsent=True,scratchAndTmpAbsent=True,kernel=dict(live=0,coalition_absent=True)))
  h['receipt']=receipt;caller.write(rp,receipt);return receipt
 adapter.run=run;adapter.audit=lambda h:dict(attemptPath=h['path'],releaseProved=True,kernel=dict(live=0,coalition_absent=True))
 return p,plan,adapter,events,video,mapping
for mode in ['normal','hidden-unreadable','hidden-readable','hash-charge','mapping-charge']:
 p,plan,a,events,video,mapping=final_fixture('final-'+mode);io=IO();fired=False;permission=False;hidden=None
 if mode.startswith('hidden'):
  hidden=p/'packet/extra-hidden';hidden.mkdir();extra=hidden/'extra.bin'
  with extra.open('wb') as s:s.truncate(64*1024**2+1)
  if mode=='hidden-unreadable':
   hidden.chmod(0)
   try:list(os.scandir(hidden))
   except PermissionError:permission=True
   else:raise AssertionError('real scandir unexpectedly succeeded')
 target=video if mode=='hash-charge' else mapping
 def before(path,flags):
  global fired
  if mode.endswith('charge') and path==target and not flags&os.O_DIRECTORY and not fired:fired=True;target.write_bytes(b'x'*8)
 try:
  with contextlib.ExitStack() as s:
   io.install(s,before);result=native.run_sequence(READY,plan,{},a,lambda:None)
  io.closed();assert events==native.JOBS and signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
  if mode=='normal':assert result['status']=='NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT',result
  else:assert result['status']=='HOLD',result
  if mode.endswith('charge'):assert fired and not any(r['path']==str(target) for r in io.reads)
  if mode=='hidden-unreadable':
   assert permission and result['primaryFailure']['type']=='PermissionError'
   assert result['outputInventory']['complete'] is False and 'outputBytes' not in result
   assert json.loads((p/'proof/result.json').read_text())['status']=='HOLD'
   assert result['terminalDelivery']['packet']['status']=='failed'
  save('final-'+mode,status='PASS',result=result,events=events,opens=io.opens,reads=io.reads,realScandirPermissionError=permission,hiddenStatBytes=extra.stat().st_size if hidden and not permission else 67108865 if hidden else None)
 finally:
  if hidden:hidden.chmod(0o700)
print('complete',len(RESULTS))
