import sys,os,ast,copy,json,subprocess,time,hashlib,signal,contextlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode=True
A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A))
import native189 as native,caller,resource_admission as resources,admission_json as meta
O=Path(__file__).resolve().parent/'adverse-v2';O.mkdir();READY=json.loads((A/'readiness.json').read_text());PLAN=json.loads((A/'native189-plan.json').read_text());RESULTS=[]
f=A/'retained-station/round4_job_boundary.py';nodes=ast.parse(f.read_text());nodes.body=[n for n in nodes.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='inert_exact',__file__=str(f),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(nodes,str(f),'exec'),core)
ID=dict(pid=100,birth=[11,22],uid=os.getuid(),status=1,ppid=99,pgid=100,sid=100)
def append(name,value):RESULTS.append(dict(name=name,**value));(O.parent/'adverse-results-v2.json').write_text(json.dumps(RESULTS,indent=2))
def combination(kind,break_write):
 name=kind+('-receipt-fail' if break_write else '-normal');root=O/name;root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir();events=[];handles=[];reads=0
 local={**READY,'captureSeconds':4,'cleanupSeconds':1,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof')};plan={**PLAN,'runRoot':str(root)}
 class Job:
  def __init__(self,out,*args,**kwargs):self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.coalition_id=123;self.target='inert';self.known={};self.state=dict(exits={},errors=[])
  def save(self):pass
  def start(self):events.append('start')
  def status(self):return {}
  def members(self):return [copy.deepcopy(ID)]
  wait=core['StationJob'].wait
  def drain(self,*args):events.append('drain');return dict(drained=True,clean=True)
  def archive(self,**kwargs):events.append('archive');self.scratch.rmdir();caller.write(self.out/'profile_release.json',dict(all_absent=True))
 def allocate(path):p=path.parent/'private';p.mkdir();return p,{'unknownAllocation':['keep',None]}
 def release(p,*args,**kwargs):p.rmdir();return dict(all_bytes_preserved=True,namespace_removed=True)
 adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=local;adapter.plan=plan;adapter.grant=dict(authorizationId='CPU-INERT')
 adapter.core=SimpleNamespace(StationJob=Job,deadline=core['deadline'],kernel_tasks=lambda _:dict(live=0,coalition_absent=True,unknown='keep'),coalition_members=lambda _:[],identity=lambda _:None)
 adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=release,executable_path=lambda _:'/inert')
 adapter.prepare=lambda *args:['/INERT'];adapter.inspect_native=lambda:None
 def observer(job,receipt):
  def read(pids):
   nonlocal reads
   reads+=1
   if reads==1:return dict(bytesByPid={100:1})
   if kind=='timeout':
    e=subprocess.TimeoutExpired(['inert-rss'],2,output=b'PARTIAL\x00\xff',stderr=b'ERR\x80');e.unknown={'keep':17};raise e
   if kind=='deadline':time.sleep(10)
   if kind=='missing':return dict(bytesByPid={},unknown=['keep',None])
   return dict(bytesByPid={100:resources.RSS_LIMIT+1})
  guard=resources.CohortRSS(SimpleNamespace(deadline=core['deadline'],identity=lambda _:copy.deepcopy(ID),kernel_tasks=lambda _:dict(live=1)),receipt.setdefault('rssObservations',[]),read=read)
  return lambda:guard.observe(job,force=True)
 adapter.resource_observer=observer;actual_run=adapter.run
 def run(definition,handle):handles.append(handle);return actual_run(definition,handle)
 adapter.run=run;actual_write=caller.write
 def write(path,value):
  if break_write and Path(path).name=='receipt.json' and 'outcome' in value and 'ownedAllocation' not in value:raise OSError('POST_WAIT_RECEIPT_FAILURE')
  return actual_write(path,value)
 with patch.object(caller,'write',write),patch.object(caller,'observe_executables',lambda *a,**k:None),patch.object(caller.subprocess,'run',lambda *a,**k:SimpleNamespace(returncode=1,stdout='raw registration',stderr='')):
  result=native.run_sequence(local,plan,{},adapter,lambda:None)
 receipt=handles[0]['receipt'];original=receipt['resourceFailures'][0]
 assert events.count('start')==1 and result['status']=='HOLD';assert signal.getitimer(signal.ITIMER_REAL)[0]==0
 if break_write:assert result['primaryFailure']['message']=='POST_WAIT_RECEIPT_FAILURE' and original['type']!='OSError'
 else:assert result['primaryFailure']==original
 append(name,dict(status='DEFECT_REPRODUCED' if break_write else 'PASS',original=original,primary=result['primaryFailure'],result=result,receipt=receipt,events=events))
for kind in ['timeout','missing','excess','deadline']:
 for break_write in [False,True]:combination(kind,break_write)
# Real RSS parser: no actual ps is invoked.
for name,output in [('missing','100 5\n'),('duplicate','100 5\n100 5\n'),('bad','100 -1\n101 2\n'),('happy','100 5\n101 2\n')]:
 with patch.object(resources.subprocess,'run',lambda *a,**k:SimpleNamespace(stdout=output,stderr='')):
  try:value=resources.rss_read([100,101])
  except BaseException as e:assert name!='happy';value=caller.error_receipt(e)
  else:assert name=='happy' and value['bytesByPid']=={100:5120,101:2048}
 append('rss-parser-'+name,dict(status='PASS',result=value))
for name in ['empty','duplicate-after','uid-after']:
 observations=[];member_calls=0;idcalls=0
 def members():
  global member_calls
  member_calls+=1
  if name=='empty':return []
  return [ID,ID] if name=='duplicate-after' and member_calls>1 else [ID]
 def identity(_):
  global idcalls
  idcalls+=1;return {**ID,'uid':ID['uid']+1} if name=='uid-after' and idcalls>1 else ID
 guard=resources.CohortRSS(SimpleNamespace(deadline=core['deadline'],kernel_tasks=lambda _:dict(live=0 if name=='empty' else 1),identity=identity),observations,read=lambda _:dict(bytesByPid={100:1}))
 try:guard.observe(SimpleNamespace(coalition_id=123,members=members))
 except BaseException as e:result=caller.error_receipt(e);assert name!='duplicate-after'
 else:assert name=='duplicate-after';result=dict(accepted=True)
 append('rss-'+name,dict(status='DEFECT_REPRODUCED' if name=='duplicate-after' else 'PASS',observations=observations,result=result))
# Exact cache byte cap, with instrumented real streaming reads.
root=O/'oversized-cache';root.mkdir();file=root/'large';f=file.open('wb');f.truncate(384*1024**2+1);f.close();read_bytes=0;opens=0;real_open=Path.open
class Stream:
 def __init__(self,s):self.s=s
 def __enter__(self):self.s.__enter__();return self
 def __exit__(self,*args):return self.s.__exit__(*args)
 def read(self,n=-1):
  global read_bytes
  b=self.s.read(n);read_bytes+=len(b);return b
 def __getattr__(self,key):return getattr(self.s,key)
def opened(path,*args,**kwargs):
 global opens
 s=real_open(path,*args,**kwargs)
 if Path(path)==file and args and args[0]=='rb':opens+=1;return Stream(s)
 return s
lease=resources.CacheLease([root],O,O/'unused-lock',O/'unused-archive',[],lambda *a:dict(owners=[]))
with patch.object(Path,'open',opened):
 try:lease.check()
 except AssertionError as e:assert str(e)=='Vite snapshot exceeds archive reserve';failure=caller.error_receipt(e)
 else:raise AssertionError('Oversize accepted')
assert read_bytes==384*1024**2+1
append('cache-over-limit-reads-to-eof',dict(status='DEFECT_REPRODUCED',readBytes=read_bytes,opens=opens,size=file.stat().st_size,failure=failure))
# Real cache is replaced with a FIFO at the hashing open, after lstat/is_file.
root=O/'fifo-cache';root.mkdir();file=root/'small';file.write_bytes(b'cache');swapped=False
real_sha=resources.sha
def raced_sha(p):
 global swapped
 if Path(p)==file and not swapped:
  swapped=True;file.unlink();os.mkfifo(file)
 return real_sha(p)
lease=resources.CacheLease([root],O,O/'fifo-lock',O/'fifo-archive',[],lambda *a:dict(owners=[]))
with patch.object(resources,'sha',raced_sha):
 try:
  with core['deadline'](.1):lease.check()
 except core['DeadlineExpired'] as e:failure=caller.error_receipt(e)
 else:raise AssertionError('FIFO did not block')
assert signal.getitimer(signal.ITIMER_REAL)[0]==0
append('cache-stat-open-FIFO',dict(status='DEFECT_REPRODUCED',failure=failure,observations=lease.observations))
print(json.dumps(dict(status='COMPLETE',cases=len(RESULTS),defectReproductions=sum(x['status']=='DEFECT_REPRODUCED' for x in RESULTS))))
