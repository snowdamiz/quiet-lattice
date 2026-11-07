import sys,os,ast,json,hashlib,subprocess,signal,tempfile,copy,contextlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode=True
O=Path(__file__).parent;A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A))
import caller,native189 as native
READY=json.loads((A/'readiness.json').read_text());PLAN=json.loads((A/'native189-plan.json').read_text());RESULTS=[]
f=A/'retained-station/round4_job_boundary.py';t=ast.parse(f.read_text());t.body=[n for n in t.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='inert_exact',__file__=str(f),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(t,str(f),'exec'),core)
for mode in ['permission','permission-save']:
 p=O/('observer-'+mode);p.mkdir();(p/'packet').mkdir();(p/'proof').mkdir();binary=p/'binary';binary.write_bytes(b'fixture never executed');made=[];handles=[];events=[];observed=[]
 row=dict(pid=214000001,birth=[1,2],uid=os.getuid(),status=1,ppid=os.getpid(),pgid=214000001,sid=214000001)
 def ended():return bool(made and (made[-1].scratch/'release').exists())
 def identity(pid):return dict(row) if pid==row['pid'] and not ended() else None
 def members(_):return [] if ended() else [dict(row)]
 def kernel(_):return dict(live=0 if ended() else 1,coalition_absent=ended())
 actual_write=core['write']
 def write(path,value):
  if mode.endswith('save') and Path(path).name=='boundary.json' and value.get('errors'):raise OSError('SECONDARY_WAIT_RECEIPT_WRITE')
  return actual_write(path,value)
 class Job(core['StationJob']):
  def __init__(self,*a,**k):made.append(self);self.calls=0;super().__init__(*a,**k)
  def status(self):
   self.calls+=1
   if self.calls==2:binary.chmod(0);events.append('binary-denied-after-initial-observation')
   if ended():actual_write(self.scratch/'worker.json',dict(root=row,launch_complete=True,exits={'capture':0,'caffeinate':0}))
   return super().status()
 def command(argv,**kw):
  events.append(argv)
  if argv[:2]==['/bin/launchctl','bootstrap']:
   actual_write(made[-1].scratch/'worker.json',dict(root=row,launch_complete=True,exits={}))
   return subprocess.CompletedProcess(argv,0,'BOOT_OK','')
  if argv[:2]==['/bin/launchctl','print']:return subprocess.CompletedProcess(argv,1,'REGISTRATION_ABSENT','')
  if argv[:2]==['/bin/ps','-p']:return subprocess.CompletedProcess(argv,0,f"{row['pid']} 4\n",'')
  raise AssertionError('Forbidden native command '+repr(argv))
 def allocate(path):private=p/'private';private.mkdir();return private,dict(ownedFixture=True)
 local={**READY,'process_binary_sha256':{str(binary):hashlib.sha256(binary.read_bytes()).hexdigest()},'captureSeconds':2,'cleanupSeconds':.2,'packetRoot':str(p/'packet'),'proofRoot':str(p/'proof')};plan={**PLAN,'runRoot':str(p)}
 adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=local;adapter.plan=plan;adapter.grant={'authorizationId':'INERT'}
 adapter.core=SimpleNamespace(StationJob=Job,deadline=core['deadline'],identity=identity,kernel_tasks=kernel,coalition_members=members)
 adapter.temp=SimpleNamespace(create_private_tmp=allocate,executable_path=lambda _:str(binary))
 adapter.prepare=lambda *a:['/INERT'];adapter.inspect_native=lambda:(_ for _ in ()).throw(AssertionError('Unexpected inspection'))
 original_run=adapter.run
 def run(d,h):handles.append(h);return original_run(d,h)
 adapter.run=run
 original_open=Path.open
 def opening(path,*a,**k):
  try:return original_open(path,*a,**k)
  except PermissionError as e:
   if path==binary:observed.append(dict(type=type(e).__name__,message=str(e),errno=e.errno,filename=e.filename,args=e.args))
   raise
 old={k:core[k] for k in ['identity','coalition','kernel_tasks','coalition_members','write','subprocess','tempfile']}
 core.update(identity=identity,coalition=lambda pid:[123 if pid==row['pid'] else 999,0],kernel_tasks=kernel,coalition_members=members,write=write,subprocess=SimpleNamespace(run=command),tempfile=SimpleNamespace(mkdtemp=lambda **kw:tempfile.mkdtemp(dir=p,**kw)))
 try:
  with patch.object(Path,'open',opening),patch.object(caller.subprocess,'run',command):result=native.run_sequence(local,plan,{},adapter,lambda:None)
 finally:core.update(old);binary.chmod(0o600)
 receipt=handles[0]['receipt'];assert len(handles)==1 and result['status']=='HOLD' and observed and signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
 assert receipt['bootstrapObservations'][0]['result']['returncode']==0 and receipt['bootstrapPortRestored']
 assert result['primaryFailure'] is receipt['primaryFailure'] is receipt['observationFailures'][0]['failure']
 assert result['primaryFailure']['type']=='PermissionError'
 if mode.endswith('save'):assert any(x['message']=='SECONDARY_WAIT_RECEIPT_WRITE' for x in receipt['secondaryFailures'])
 else:assert receipt['outcome']=='observer_failed'
 assert result['terminalReleaseProved'] is False and made[-1].scratch.exists() and (p/'private').exists()
 value=dict(mode=mode,status='PASS',result=result,receipt=receipt,oracle=observed,helperState=made[-1].state,events=events,nativeProcesses=0)
 RESULTS.append(value);(O/'observer-native-results.json').write_text(json.dumps(RESULTS,indent=2));print(mode,result['primaryFailure'],flush=True)
