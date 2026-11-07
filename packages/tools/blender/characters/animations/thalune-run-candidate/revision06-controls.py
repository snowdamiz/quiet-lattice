import sys,os,ast,json,hashlib,signal,time,tempfile,traceback,copy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import contextlib
sys.dont_write_bytecode=True
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args()
A=Path(__file__).parent;sys.path.insert(0,str(A))
import caller,native189 as native,resource_admission as res
O=Path(tempfile.mkdtemp(prefix='t02-r6-controls-',dir='/private/tmp')); W=O/'fixtures';W.mkdir();RESULTS=[]
assert not args.report.exists()
ready=json.loads((A/'readiness.json').read_text()); plan=json.loads((A/'native189-plan.json').read_text())
f=A/'retained-station/round4_job_boundary.py';t=ast.parse(f.read_text());t.body=[n for n in t.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='exact_inert',__file__=str(f),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(t,str(f),'exec'),core)
def save(name,status,**value):
 RESULTS.append(dict(name=name,status=status,**value));args.report.write_text(json.dumps(dict(scratch=str(W),cases=RESULTS),indent=2));print(name,status,flush=True)
def refused(fn):
 try:fn()
 except BaseException as e:return e
 raise AssertionError('Expected refusal')

class FilePorts:
 def __init__(self):self.paths={};self.events=[];self.readBytes=0
 def install(self,stack,before=lambda path,flags:None,read=lambda path,data:None,close=lambda path:None):
  original_open,original_read,original_close=os.open,os.read,os.close
  def opened(name,flags,*args,**kwargs):
   parent=kwargs.get('dir_fd');path=Path(name) if Path(name).is_absolute() else self.paths[parent]/name
   before(path,flags)
   event=dict(path=str(path),name=str(name),dirFd=parent,flags=flags);self.events.append(event)
   fd=original_open(name,flags,*args,**kwargs);self.paths[fd]=path;event.update(fd=fd,ino=os.fstat(fd).st_ino);return fd
  def reading(fd,n):
   value=original_read(fd,n);self.readBytes+=len(value);read(self.paths[fd],value);return value
  def closing(fd):
   original_close(fd);close(self.paths.get(fd))
  for port in [patch.object(os,'open',opened),patch.object(os,'read',reading),patch.object(os,'close',closing)]:stack.enter_context(port)
 def closed(self):
  for fd in self.paths:
   try:os.fstat(fd)
   except OSError:continue
   raise AssertionError('FD survived')


def ancestor(mode):
 root=W/('ancestor-'+mode);root.mkdir();parent=root/'parent';parent.mkdir();cache=parent/'cache';cache.mkdir();(cache/'nested').mkdir();file=cache/'nested/data';file.write_bytes(b'abcdefgh');obs=[]
 lease=res.CacheLease([cache],root,root/'lock',root/'archive',obs,lambda *a:dict(owners=[]))
 copying=mode.startswith('copy-')
 if copying:lease.acquire()
 destination='destination' in mode;held='held' in mode
 target=(root/'archive') if destination else (cache/'nested' if 'descendant' in mode else parent)
 moved=root/'moved';ports=FilePorts();swapped=False;restored=False;read_link=[]
 def opening(path,flags):
  nonlocal swapped
  hit=(path==file and not flags&os.O_DIRECTORY) if held else path==target and flags&os.O_DIRECTORY
  if hit and not swapped:
   swapped=True;target.rename(moved);target.symlink_to(moved,target_is_directory=True)
 def reading(path,value):
  if path==file:read_link.append(dict(bytes=len(value),ancestorLink=target.is_symlink()))
 def closing(path):
  nonlocal restored
  if held and path==file and swapped and not restored:target.unlink();moved.rename(target);restored=True
 with contextlib.ExitStack() as stack:
  ports.install(stack,opening,reading,closing)
  try:
   if copying:lease.copy('tested',lease.initial)
   else:lease.check()
   error=None
  except BaseException as e:error=e
 ports.closed();assert swapped
 if held:
  assert error is None and restored and any(r['ancestorLink'] and r['bytes']==8 for r in read_link)
  # Reads used a held original directory FD, never the transient absolute alias.
  assert all(e['name']=='data' and e['dirFd'] is not None for e in ports.events if e['path']==str(file))
 else:assert error is not None and ports.readBytes==0 and target.is_symlink()
 if copying:assert (root/'lock').is_dir() and (root/'archive/before/0/nested/data').read_bytes()==b'abcdefgh'
 save('ancestor-'+mode,'PASS',failure=None if error is None else caller.error_receipt(error),opens=ports.events,reads=read_link,observations=obs,anchoredRead=held)
for mode in ['check','check-descendant','copy-source','copy-source-descendant','copy-destination','check-held','copy-source-held','copy-destination-held']:ancestor(mode)

def copy_failure(mode):
 root=W/('copy-'+mode);root.mkdir();cache=root/'cache';cache.mkdir();(cache/'data').write_bytes(b'abcdefgh');obs=[]
 lease=res.CacheLease([cache],root,root/'lock',root/'archive',obs,lambda *a:dict(owners=[]));lease.acquire()
 real_open,real_write,real_read,real_close=os.open,os.write,os.read,os.close;fds={};seen=[]
 def opening(p,flags,*a,**kw):
  shown=Path(p) if Path(p).is_absolute() else Path(fds[kw['dir_fd']]['path'])/p
  fd=real_open(p,flags,*a,**kw);fds[fd]=dict(path=str(shown),write=bool(flags&os.O_WRONLY));return fd
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
 assert len(json.dumps(obs))<256*1024,'Descriptor unwind duplicated attached observations'
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
  if mode=='bootstrap-cancel':raise KeyboardInterrupt()
  if mode=='bootstrap-deadline':time.sleep(1)
  if mode=='bootstrap-timeout':
   e=__import__('subprocess').TimeoutExpired(argv,3,output=b'BOOT\xff',stderr=b'ERR\x80');e.unknown={'keep':17};raise e
  cp=SimpleNamespace(returncode=0 if mode=='bootstrap-0' else 17,stdout='BOOTSTRAP_STDOUT_UNKNOWN\0',stderr='BOOTSTRAP_STDERR_UNKNOWN',unknown={'opaque':91});captured.append(vars(cp));return cp
 core['write']=writer;core['subprocess']=SimpleNamespace(run=command);core['tempfile']=SimpleNamespace(mkdtemp=lambda **kw:tempfile.mkdtemp(dir=root,**kw))
 try:
  active_port=core['subprocess'];result=native.run_sequence(local,pl,{},adapter,lambda:None);assert core['subprocess'] is active_port
 finally:core['write']=original_write;core['subprocess']=original_subprocess;core['tempfile']=original_tempfile
 assert len(handles)==1 and result['status']=='HOLD' and signal.getitimer(signal.ITIMER_REAL)[0]==0
 receipt=handles[0]['receipt'];job=handles[0]['job'];assert Path(receipt['ownedAllocation']['scratch'])==job.scratch and job.scratch.exists() and (root/'private').exists()
 files={str(p.relative_to(root)):p.read_text() for p in root.rglob('*.json')}
 if mode=='constructor':assert not events and result['primaryFailure']['message']=='REQUEST_WRITE_FAILURE';status='PASS'
 elif mode=='bootstrap-control':assert json.loads((job.out/'bootstrap.json').read_text())['exit']==17;status='PASS'
 else:
  observation=receipt['bootstrapObservations'][0];assert observation['registrationUncertain'] is True and receipt['bootstrapPortRestored'] is True
  assert len(events)==1 and not (job.out/'bootstrap.json').exists()
  if mode in ['bootstrap-0','bootstrap-17']:
   assert observation['result']==captured[0] and observation['result']['returncode']==(0 if mode=='bootstrap-0' else 17)
   assert result['primaryFailure']['message']=='BOOTSTRAP_RECEIPT_FAILURE'
  else:
   assert observation['failure']['type']=={'bootstrap-cancel':'KeyboardInterrupt','bootstrap-deadline':'DeadlineExpired','bootstrap-timeout':'TimeoutExpired'}[mode]
  status='PASS'
 save('lifecycle-'+mode,status,result=result,receipt=receipt,observedPortResults=captured,events=events,persistedFiles=list(files),privateRetained=True)
for mode in ['constructor','bootstrap-control','bootstrap-17','bootstrap-0','bootstrap-timeout','bootstrap-cancel','bootstrap-deadline']:lifecycle(mode)

def artifact(mode,name):
 root=W/('artifact-'+name+'-'+mode);root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir();pl={**plan,'runRoot':str(root)}
 for relative in plan['packetFilesBeforeTerminal']:
  p=root/'packet'/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'{}')
 directory=root/'packet/captures/motion-thalune-run-lod0';video=directory/'primary.mp4';mapping=directory/'frame-map.json';file=directory/name
 if mode=='combined-budget':
  for target,size in [(video,native.contract.VIDEO_BYTES),(mapping,32*1024**2)]:
   with target.open('wb') as f:f.truncate(size)
 val=root/'packet/inspections/native-189-validate/validation.json';val.write_text(json.dumps(dict(accepted=True,frames=189,everyRgbAndRgbaHash=True,videoSha256=hashlib.sha256(video.read_bytes()).hexdigest(),frameMapSha256=hashlib.sha256(mapping.read_bytes()).hexdigest(),unknown={'preserved':7})))
 (val.parent/'surplus-refusal.json').write_text(json.dumps(dict(accepted=False,expectedRefusal=True,frames=190)))
 adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.plan=pl;calls=[];ports=FilePorts();fired=False;timers=[]
 def deadline(seconds):
  assert seconds==30;return core['deadline'](.025 if mode=='deadline' else 1)
 adapter.core=SimpleNamespace(deadline=deadline)
 def run(d,h):
  calls.append(d['id']);p=Path(h['path']);p.parent.mkdir(parents=True)
  r=dict(name=d['id'],primaryFailure=None,cleanupFailure=None,persistenceFailures=[],outcome='completed',exits={'capture':0},terminal=dict(registrationAbsent=True,scratchAndTmpAbsent=True,kernel=dict(live=0,coalition_absent=True)))
  h['receipt']=r;caller.write(p,r);return r
 adapter.run=run;adapter.audit=lambda h:dict(attemptPath=h['path'],releaseProved=True,kernel=dict(live=0,coalition_absent=True))
 if mode=='oversized':
  with file.open('wb') as f:f.truncate((native.contract.VIDEO_BYTES if name=='primary.mp4' else 64*1024**2)+1)
 if mode in ['static-fifo','static-link']:
  file.rename(root/'original')
  if mode=='static-fifo':os.mkfifo(file)
  else:file.symlink_to(root/'original')
 def opening(path,flags):
  nonlocal fired
  if path!=file or flags&os.O_DIRECTORY or fired:return
  fired=True;timers.append(signal.getitimer(signal.ITIMER_REAL));assert timers[-1][0]>0
  if mode in ['fifo','link','replacement']:
   file.rename(root/'original')
   if mode=='fifo':os.mkfifo(file)
   elif mode=='link':file.symlink_to(root/'original')
   else:file.write_bytes(b'{}')
 def reading(path,data):
  if path!=file:return
  if mode=='growth' and data:
   with file.open('ab') as f:f.write(b'EXTRA')
  if mode=='truncate' and data:file.write_bytes(b'x')
  if mode=='deadline':time.sleep(.2)
  if mode=='cancel':raise KeyboardInterrupt()
  if mode=='unknown':
   e=OSError('ARTIFACT_READ_ERROR');e.unknown={'partial':str(b'\x00\xff'),'kept':None};raise e
 with contextlib.ExitStack() as stack:
  ports.install(stack,opening,reading)
  result=native.run_sequence(ready,pl,{},adapter,lambda:None)
 ports.closed();assert calls==native.JOBS and signal.getitimer(signal.ITIMER_REAL)[0]==0
 if mode in ['normal','combined-budget']:assert result['status']=='NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT',result
 else:
  assert result['status']=='HOLD',result
  if mode in ['static-fifo','static-link','oversized']:assert ports.readBytes==0
  if mode=='growth':assert ports.readBytes<=5
  if mode=='deadline':assert result['primaryFailure']['type']=='DeadlineExpired'
  if mode=='cancel':assert result['primaryFailure']['type']=='KeyboardInterrupt'
  if mode=='unknown':assert result['primaryFailure']['details']['unknown']['kept'] is None
 save('artifact-'+name+'-'+mode,'PASS',result=result,events=calls,opens=ports.events,contentReadBytes=ports.readBytes,timers=timers)
for name in ['primary.mp4','frame-map.json']:
 for mode in (['combined-budget'] if name=='primary.mp4' else [])+['normal','static-fifo','static-link','oversized','fifo','link','replacement','growth','truncate','deadline','cancel','unknown']:artifact(mode,name)

def actual_prepare(mode):
 root=Path(tempfile.mkdtemp(prefix='adapter-cache-',dir=O)).resolve();(root/'packet').mkdir();(root/'proof').mkdir();parent=root/'parent';parent.mkdir();cache=parent/'cache';cache.mkdir();file=cache/'data';file.write_bytes(b'abcdefgh')
 ready=json.loads((A/'readiness.json').read_text());pl=json.loads((A/'native189-plan.json').read_text());pl.update(viteCachePaths=[str(cache)],cacheLeasePath=str(root/'spent-lock'));p=root/'native189-plan.json';p.write_text(json.dumps(pl))
 local={**ready,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof'),'captureSeconds':600,'cleanupSeconds':60,'bindings':[*ready['bindings'],dict(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest())]}
 f=A/'retained-station/round4_job_boundary.py';t=ast.parse(f.read_text());t.body=[n for n in t.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='inert_exact',__file__=str(f),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(t,str(f),'exec'),core)
 a=caller.StationAdapter.__new__(caller.StationAdapter);a.ready=local;a.grant={'authorizationId':'INERT'};a.resourceControls=True;a.cacheLease=None;a.core=SimpleNamespace(deadline=core['deadline'],identity=lambda p:dict(pid=p,birth=[1,2],uid=os.getuid()))
 events=[];handles=[]
 def reached(*args):events.append('PRIVATE_ALLOCATION_BOUNDARY_REACHED');raise RuntimeError('REVIEW_STOP_BEFORE_PRIVATE_ALLOCATION')
 a.temp=SimpleNamespace(create_private_tmp=reached);actual_run=a.run
 def run(d,h):handles.append(h);return actual_run(d,h)
 a.run=run;real_open,real_close=os.open,os.close;live=set();opens=[];moved=root/'moved'
 fds={}
 def opening(p,flags,*args,**kw):
  shown=Path(p) if Path(p).is_absolute() else fds[kw['dir_fd']]/p
  target=parent if mode=='source' else Path(handles[0]['path']).parent/'vite-cache-retention'
  if shown==target and flags&os.O_DIRECTORY:
   target.rename(moved);target.symlink_to(moved,target_is_directory=True);opens.append(dict(path=str(shown),ancestorLink=True));return real_open(p,flags,*args,**kw)
  fd=real_open(p,flags,*args,**kw);fds[fd]=shown;return fd
 def closing(fd):
  real_close(fd)
  if fd in live:parent.unlink();moved.rename(parent);live.remove(fd)
 with patch.object(caller,'HERE',root),patch.object(res,'open_owners',lambda *args:dict(owners=[])),patch.object(os,'open',opening),patch.object(os,'close',closing):
  result=caller.run_sequence(local,a,root/'packet',root/'proof')
 assert not events and opens and len(handles)==1 and not live
 receipt=handles[0]['receipt'];assert receipt['primaryFailure'] is not None and receipt['primaryFailure']['message']!='REVIEW_STOP_BEFORE_PRIVATE_ALLOCATION'
 assert (root/'spent-lock').exists()==(mode=='destination')
 save('actual-prepare-ancestor-'+mode,'PASS',result=result,receipt=receipt,events=events,opens=opens,nativeAllocations=0)

actual_prepare('source')
actual_prepare('destination')
print(json.dumps(dict(status="PASS",controls=len(RESULTS),nativeJobs=0,scratch=str(W))))
