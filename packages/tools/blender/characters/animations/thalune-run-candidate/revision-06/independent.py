import sys,os,ast,json,hashlib,signal,time,tempfile,traceback,copy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import contextlib
sys.dont_write_bytecode=True
A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A))
import caller,native189 as native,resource_admission as res
O=Path(__file__).resolve().parent; W=Path(tempfile.mkdtemp(prefix='independent-',dir=O)).resolve(); RESULTS=[]
ready=json.loads((A/'readiness.json').read_text()); plan=json.loads((A/'native189-plan.json').read_text())
f=A/'retained-station/round4_job_boundary.py';t=ast.parse(f.read_text());t.body=[n for n in t.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='exact_inert',__file__=str(f),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(t,str(f),'exec'),core)
def save(name,status,**value):
 RESULTS.append(dict(name=name,status=status,**value));(O/'independent-results.json').write_text(json.dumps(dict(scratch=str(W),cases=RESULTS),indent=2));print(name,status,flush=True)
def refused(fn):
 try:fn()
 except BaseException as e:return e
 raise AssertionError('Expected refusal')

def ancestor(mode):
 root=W/('ancestor-'+mode);root.mkdir();parent=root/'parent';parent.mkdir();cache=parent/'cache';cache.mkdir();file=cache/'data';file.write_bytes(b'abcdefgh');obs=[]
 lease=res.CacheLease([cache],root,root/'lock',root/'archive',obs,lambda *a:dict(owners=[]))
 if mode=='static':
  moved=root/'moved';parent.rename(moved);parent.symlink_to(moved,target_is_directory=True)
  error=refused(lease.check);assert str(error)=='Cache path alias refused'
  save('ancestor-static','PASS',failure=caller.error_receipt(error));return
 if mode in ['copy-source','copy-destination']:lease.acquire()
 target_parent=(root/'archive') if mode=='copy-destination' else parent
 moved=root/'moved';opened=[];reads=[];live={};real_open,real_read,real_close=os.open,os.read,os.close
 def opening(p,flags,*a,**kw):
  path=Path(p);hit=(path==file and not flags&os.O_DIRECTORY) if mode!='copy-destination' else path==root/'archive/tested/0' and flags&os.O_DIRECTORY
  if not hit:return real_open(p,flags,*a,**kw)
  assert not target_parent.is_symlink();target_parent.rename(moved);target_parent.symlink_to(moved,target_is_directory=True)
  observed=dict(requested=str(path),resolved=str(path.resolve()),ancestorIsSymlink=target_parent.is_symlink(),flags=flags)
  fd=real_open(p,flags,*a,**kw);observed.update(fd=fd,actualInode=os.fstat(fd).st_ino);opened.append(observed);live[fd]=observed;return fd
 def reading(fd,n):
  value=real_read(fd,n)
  if fd in live:reads.append(dict(bytes=len(value),ancestorIsSymlink=target_parent.is_symlink()))
  return value
 def closing(fd):
  real_close(fd)
  if fd in live:
   target_parent.unlink();moved.rename(target_parent);live.pop(fd)
 with patch.object(os,'open',opening),patch.object(os,'read',reading),patch.object(os,'close',closing):
  if mode=='check':result=lease.check()
  else:lease.copy('tested',lease.initial);result={'copyAccepted':True}
 assert opened and not live and not target_parent.is_symlink()
 if mode=='check':assert obs[-1]['accepted'] is True
 else:assert (root/'archive/tested/0/data').read_bytes()==b'abcdefgh'
 save('ancestor-'+mode,'DEFECT_REPRODUCED',opened=opened,reads=reads,result=result,observations=obs,spentLeaseRetained=(root/'lock').exists())
for mode in ['static','check','copy-source','copy-destination']:ancestor(mode)

def copy_failure(mode):
 root=W/('copy-'+mode);root.mkdir();cache=root/'cache';cache.mkdir();(cache/'data').write_bytes(b'abcdefgh');obs=[]
 lease=res.CacheLease([cache],root,root/'lock',root/'archive',obs,lambda *a:dict(owners=[]));lease.acquire()
 real_open,real_write,real_read,real_close=os.open,os.write,os.read,os.close;fds={};seen=[]
 def opening(p,flags,*a,**kw):
  fd=real_open(p,flags,*a,**kw);fds[fd]=dict(path=str(p),write=bool(flags&os.O_WRONLY));return fd
 def writing(fd,data):
  if fd in fds and fds[fd]['write']:
   seen.append('write')
   if mode=='write-error':e=OSError('COPY_DEST_WRITE_ERROR');e.unknown={'kept':[None,False,5]};raise e
   if mode=='short-write':return real_write(fd,data[:2])
  return real_write(fd,data)
 def reading(fd,n):
  if mode=='read-and-close' and fds.get(fd,{}).get('path')==str(cache/'data'):
   e=OSError('COPY_SOURCE_READ_ERROR');e.unknown={'partial':str(b'\x00\xff')};raise e
  if mode=='signal' and fds.get(fd,{}).get('path')==str(cache/'data'):time.sleep(.2)
  return real_read(fd,n)
 def closing(fd):
  info=fds.get(fd,{});real_close(fd);seen.append('close '+str(fd))
  if info.get('write') and mode in ['dest-close','read-and-close']:raise OSError('COPY_DEST_CLOSE_ERROR')
 with contextlib.ExitStack() as stack:
  for p in [patch.object(os,'open',opening),patch.object(os,'write',writing),patch.object(os,'read',reading),patch.object(os,'close',closing)]:stack.enter_context(p)
  if mode=='signal':stack.enter_context(core['deadline'](.025))
  error=refused(lambda:lease.copy('tested',lease.initial))
 for fd in fds:
  try:os.fstat(fd)
  except OSError:pass
  else:raise AssertionError('Open FD survived')
 assert (root/'lock').is_dir() and (root/'archive/before/0/data').read_bytes()==b'abcdefgh' and (cache/'data').read_bytes()==b'abcdefgh'
 assert (root/'archive/tested/0/data').exists() and signal.getitimer(signal.ITIMER_REAL)[0]==0
 if mode=='read-and-close':assert str(error)=='COPY_SOURCE_READ_ERROR' and error.descriptorCloseFailures[0]['message']=='COPY_DEST_CLOSE_ERROR'
 if mode=='signal':assert isinstance(error,core['DeadlineExpired'])
 save('copy-'+mode,'PASS',failure=caller.error_receipt(error),observations=obs,events=seen,partialBytes=(root/'archive/tested/0/data').stat().st_size)
for mode in ['write-error','short-write','dest-close','read-and-close','signal']:copy_failure(mode)

def lifecycle(mode):
 root=W/('lifecycle-'+mode);root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir();handles=[];events=[];captured=[]
 local={**ready,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof'),'captureSeconds':.15,'cleanupSeconds':.1};pl={**plan,'runRoot':str(root)}
 adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=local;adapter.plan=pl;adapter.grant={'authorizationId':'INERT'}
 adapter.core=SimpleNamespace(StationJob=core['StationJob'],deadline=core['deadline'],identity=lambda _:None,kernel_tasks=lambda _:dict(live=0,coalition_absent=True),coalition_members=lambda _:[])
 def allocate(p):d=root/'private';d.mkdir();return d,dict(path=str(d),unknown={'kept':7})
 adapter.temp=SimpleNamespace(create_private_tmp=allocate);adapter.prepare=lambda *a:['/INERT'];adapter.resource_observer=lambda *a:None
 adapter.inspect_native=lambda:(_ for _ in ()).throw(AssertionError('Unexpected inspection'))
 actual_run=adapter.run
 def run(d,h):handles.append(h);return actual_run(d,h)
 adapter.run=run
 original_write=core['write'];original_subprocess=core['subprocess'];original_tempfile=core['tempfile']
 def writer(p,v):
  if mode=='constructor' and Path(p).name=='request.json':raise OSError('REQUEST_WRITE_FAILURE')
  if mode.startswith('bootstrap-') and mode!='bootstrap-control' and Path(p).name=='bootstrap.json':raise OSError('BOOTSTRAP_RECEIPT_FAILURE')
  return original_write(p,v)
 def command(argv,**kw):
  assert argv[:2]==['/bin/launchctl','bootstrap'];events.append(argv)
  cp=SimpleNamespace(returncode=0 if mode=='bootstrap-0' else 17,stdout='BOOTSTRAP_STDOUT_UNKNOWN\0',stderr='BOOTSTRAP_STDERR_UNKNOWN',unknown={'opaque':91});captured.append(vars(cp));return cp
 core['write']=writer;core['subprocess']=SimpleNamespace(run=command);core['tempfile']=SimpleNamespace(mkdtemp=lambda **kw:tempfile.mkdtemp(dir=root,**kw))
 try:result=native.run_sequence(local,pl,{},adapter,lambda:None)
 finally:core['write']=original_write;core['subprocess']=original_subprocess;core['tempfile']=original_tempfile
 assert len(handles)==1 and result['status']=='HOLD' and signal.getitimer(signal.ITIMER_REAL)[0]==0
 receipt=handles[0]['receipt'];job=handles[0]['job'];assert Path(receipt['ownedAllocation']['scratch'])==job.scratch and job.scratch.exists() and (root/'private').exists()
 files={str(p.relative_to(root)):p.read_text() for p in root.rglob('*.json')}
 if mode=='constructor':assert not events and result['primaryFailure']['message']=='REQUEST_WRITE_FAILURE';status='PASS'
 elif mode=='bootstrap-control':assert json.loads((job.out/'bootstrap.json').read_text())['exit']==17;status='PASS'
 else:
  evidence=json.dumps(dict(result=result,receipt=receipt,files=files));assert 'BOOTSTRAP_STDOUT_UNKNOWN' not in evidence and 'BOOTSTRAP_STDERR_UNKNOWN' not in evidence
  assert len(events)==1 and not (job.out/'bootstrap.json').exists() and receipt['ownedAllocation']['registered']=='False'
  status='DEFECT_REPRODUCED'
 save('lifecycle-'+mode,status,result=result,receipt=receipt,observedPortResults=captured,events=events,persistedFiles=list(files),privateRetained=True)
for mode in ['constructor','bootstrap-control','bootstrap-17','bootstrap-0']:lifecycle(mode)

class HarnessCutoff(BaseException):pass
def artifact(mode):
 root=W/('artifact-'+mode);root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir();pl={**plan,'runRoot':str(root)}
 for relative in plan['packetFilesBeforeTerminal']:
  p=root/'packet'/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'{}')
 video=root/'packet/captures/motion-thalune-run-lod0/primary.mp4';mapping=video.with_name('frame-map.json');vhash=hashlib.sha256(video.read_bytes()).hexdigest();mhash=hashlib.sha256(mapping.read_bytes()).hexdigest()
 val=root/'packet/inspections/native-189-validate/validation.json';val.write_text(json.dumps(dict(accepted=True,frames=189,everyRgbAndRgbaHash=True,videoSha256=vhash,frameMapSha256=mhash)))
 (val.parent/'surplus-refusal.json').write_text(json.dumps(dict(accepted=False,expectedRefusal=True,frames=190)))
 adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.plan=pl;calls=[];trace=[]
 def run(d,h):
  calls.append(d['id']);p=Path(h['path']);p.parent.mkdir(parents=True)
  r=dict(name=d['id'],primaryFailure=None,cleanupFailure=None,persistenceFailures=[],outcome='completed',exits={'capture':0},terminal=dict(registrationAbsent=True,scratchAndTmpAbsent=True,kernel=dict(live=0,coalition_absent=True)))
  h['receipt']=r;caller.write(p,r);return r
 adapter.run=run;adapter.audit=lambda h:dict(attemptPath=h['path'],releaseProved=True,kernel=dict(live=0,coalition_absent=True))
 actual_open=Path.open
 def opening(p,*a,**kw):
  if p==video and a and a[0]=='rb' and mode=='fifo':
   before=signal.getitimer(signal.ITIMER_REAL);assert before[0]==0
   video.rename(root/'preserved-primary.mp4');os.mkfifo(video)
   trace.append(dict(beforeTimer=before,path=str(p),fifo=True))
   previous=signal.getsignal(signal.SIGALRM)
   def expired(*_):trace.append(dict(stack=traceback.format_stack()));raise HarnessCutoff('reviewer interrupted unbounded artifact open')
   signal.signal(signal.SIGALRM,expired);signal.setitimer(signal.ITIMER_REAL,.1)
   try:return actual_open(p,*a,**kw)
   finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous)
  return actual_open(p,*a,**kw)
 with patch.object(Path,'open',opening):result=native.run_sequence(ready,pl,{},adapter,lambda:None)
 assert calls==native.JOBS and signal.getitimer(signal.ITIMER_REAL)[0]==0
 if mode=='normal':assert result['status']=='NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT',result;status='PASS'
 else:assert result['status']=='HOLD' and result['primaryFailure']['type']=='HarnessCutoff' and trace;status='DEFECT_REPRODUCED'
 save('artifact-'+mode,status,result=result,events=calls,trace=trace)
for mode in ['normal','fifo']:artifact(mode)
print(json.dumps(dict(cases=len(RESULTS),defectReproductions=sum(r['status']=='DEFECT_REPRODUCED' for r in RESULTS))))
