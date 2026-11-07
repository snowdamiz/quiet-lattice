import sys,os,ast,json,hashlib,subprocess,signal,tempfile,copy,contextlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode=True
import argparse,time,importlib.util
parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args();assert not args.report.exists()
O=Path(tempfile.mkdtemp(prefix='t02-r7-controls-',dir='/private/tmp'));A=Path(__file__).parent;sys.path.insert(0,str(A))
import caller,native189 as native
READY=json.loads((A/'readiness.json').read_text());PLAN=json.loads((A/'native189-plan.json').read_text());RESULTS=[]
f=A/'retained-station/round4_job_boundary.py';t=ast.parse(f.read_text());t.body=[n for n in t.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='inert_exact',__file__=str(f),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(t,str(f),'exec'),core)
import inventory_boundary as enumeration,packet_budget as budget,release_accounting as accounting,inspector

def helper(name,injections):
 f=A/'retained-station'/name;t=ast.parse(f.read_text());t.body=[n for n in t.body if not isinstance(n,ast.ImportFrom) or n.module not in ['round4_job_boundary','round4_capture_children','run_round4_browser_proof']]
 space={**injections,'__name__':'inert_exact','__file__':str(f)};exec(compile(t,str(f),'exec'),space);return space
browser=helper('run_round4_browser_proof.py',dict(core))
support=helper('run_round4_remaining8.py',dict(core,**{k:browser[k] for k in ['create_private_tmp','preserve_private_tmp','parse_launch','executable_path','current_commands','PRIVATE_TMP_POLICY']}))
def save(value):
 RESULTS.append(value);args.report.write_text(json.dumps(dict(cases=RESULTS,count=len(RESULTS),scratch=str(O)),indent=2));print(value['name'],value['status'],flush=True)

def observer_case(mode,delivery):
 p=O/('observer-'+mode+'-'+delivery);p.mkdir();(p/'packet').mkdir();(p/'proof').mkdir();binary=p/'binary';binary.write_bytes(b'fixture never executed');made=[];handles=[];events=[];observed=[]
 row=dict(pid=214000001,birth=[1,2],uid=os.getuid(),status=1,ppid=os.getpid(),pgid=214000001,sid=214000001)
 def ended():return bool(made and (made[-1].scratch/'release').exists())
 def identity(pid):return dict(row) if pid==row['pid'] and not ended() else None
 def members(_):return [] if ended() else [dict(row)]
 def kernel(_):return dict(live=0 if ended() else 1,coalition_absent=ended())
 actual_write=core['write']
 def write(path,value):
  if delivery!='normal' and Path(path).name=='boundary.json' and value.get('errors'):raise OSError('SECONDARY_WAIT_RECEIPT_WRITE')
  return actual_write(path,value)
 class Job(core['StationJob']):
  def __init__(self,*a,**k):made.append(self);self.calls=0;super().__init__(*a,**k)
  def status(self):
   self.calls+=1
   if self.calls==2:events.append('fault-armed-after-initial-observation')
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
 local={**READY,'process_binary_sha256':{str(binary):hashlib.sha256(binary.read_bytes()).hexdigest()},'captureSeconds':.6 if mode.startswith('stage') else .15,'cleanupSeconds':.2,'packetRoot':str(p/'packet'),'proofRoot':str(p/'proof')};plan={**PLAN,'runRoot':str(p)}
 adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=local;adapter.plan=plan;adapter.grant={'authorizationId':'INERT'}
 adapter.core=SimpleNamespace(StationJob=Job,deadline=core['deadline'],identity=identity,kernel_tasks=kernel,coalition_members=members)
 adapter.temp=SimpleNamespace(create_private_tmp=allocate,executable_path=lambda _:path_read())
 adapter.prepare=lambda *a:['/INERT'];adapter.inspect_native=lambda:(_ for _ in ()).throw(AssertionError('Unexpected inspection'))
 original_run=adapter.run
 def run(d,h):handles.append(h);return original_run(d,h)
 adapter.run=run
 def fault():
  if mode.endswith('deadline'):time.sleep(2)
  if mode.endswith('cancel'):e=KeyboardInterrupt()
  elif mode=='path-error':e=OSError(5,'PATH_PRODUCER_FAILURE')
  else:e=subprocess.TimeoutExpired(['/inert/observer'],2,output=b'PARTIAL\x00\xff',stderr=b'STDERR\x80')
  e.future={'unknown':b'KEPT\xfe'};observed.append(e);raise e
 def path_read():
  if mode=='path-error' and 'fault-armed-after-initial-observation' in events:fault()
  return str(binary)
 stage_count=0
 actual_command=command
 def stage_command(argv,**kwargs):
  nonlocal stage_count
  if argv[:2]==['/bin/ps','-ww']:
   stage_count+=1
   if stage_count>1:
    if mode=='stage-exit':return SimpleNamespace(returncode=17,stdout='RAW_STDOUT\0',stderr='RAW_STDERR',unknown={'bytes':b'KEPT\xfe'})
    fault()
   return subprocess.CompletedProcess(argv,0,f"{row['pid']} inert-owned-helper\n",'')
  return actual_command(argv,**kwargs)
 if mode.startswith('stage'):
  local['resolver']={'selectedExecutable':{'path':str(binary)}}
  def stage_factory(definition,job,private):
   return support['StageReceipts'](job,local,private,structured_launch_receipt=job.out.parent/'capture/browser-launch.json')
  adapter.stage_observer=stage_factory
  command=stage_command
 support_old={k:support.get(k) for k in ['identity','coalition','executable_path','write']}
 def stage_write(path,value):
  if delivery=='stage-write' and Path(path).name=='structured_launch_observation.json' and value.get('failure'):
   e=OSError('STAGE_RECEIPT_FAILURE');e.future={'partial':b'WRITE\xff'};raise e
  return actual_write(path,value)
 support.update(identity=identity,coalition=lambda _:[123,0],executable_path=lambda _:str(binary),write=stage_write)
 old_browser_port=browser['subprocess'];browser['subprocess']=SimpleNamespace(run=command)
 original_open=Path.open
 def opening(path,*a,**k):
  if path==binary and mode.startswith('hash') and 'fault-armed-after-initial-observation' in events:fault()
  try:return original_open(path,*a,**k)
  except PermissionError as e:
   if path==binary:observed.append(dict(type=type(e).__name__,message=str(e),errno=e.errno,filename=e.filename,args=e.args))
   raise
 old={k:core[k] for k in ['identity','coalition','kernel_tasks','coalition_members','write','subprocess','tempfile']}
 core.update(identity=identity,coalition=lambda pid:[123 if pid==row['pid'] else 999,0],kernel_tasks=kernel,coalition_members=members,write=write,subprocess=SimpleNamespace(run=command),tempfile=SimpleNamespace(mkdtemp=lambda **kw:tempfile.mkdtemp(dir=p,**kw)))
 actual_writer=caller.write
 writer_calls=[]
 def writer(path,value):
  writer_calls.append(str(path))
  if delivery=='all-sinks' and ((Path(path).name=='receipt.json' and value.get('primaryFailure') is not None) or Path(path).name=='returned-receipts.json'):raise OSError('ADDITIONAL_RECEIPT_FAILURE')
  return actual_writer(path,value)
 class Broken:
  def write(self,value):raise OSError('TERMINAL_STREAM_FAILURE')
 try:
  with contextlib.ExitStack() as stack:
   for port in [patch.object(Path,'open',opening),patch.object(caller.subprocess,'run',command),patch.object(caller,'write',writer)]:stack.enter_context(port)
   if delivery=='all-sinks':
    original_load=native.load;original_sequence=native.run_sequence
    for port in [patch.object(accounting,'save',lambda *a:(_ for _ in ()).throw(OSError('PROOF_WRITE_FAILURE'))),patch.object(budget,'write_json',lambda *a,**k:(_ for _ in ()).throw(OSError('PACKET_WRITE_FAILURE'))),patch.object(native,'load',lambda p:local if p==native.READY else plan if p==native.PLAN else original_load(p)),patch.object(native,'consume',lambda *a:{}),patch.object(native,'check_current',lambda *a:None),patch.object(native,'NativeAdapter',lambda *a:adapter),patch.object(native,'run_sequence',lambda *a,**k:original_sequence(*a,**k,writer=writer)),patch.object(sys,'argv',['native189.py','--execute']),patch.object(sys,'stdout',Broken()),patch.object(sys,'stderr',Broken())]:stack.enter_context(port)
    try:native.main()
    except caller.TerminalDeliveryError as e:result=e.result
    else:raise AssertionError('Missing structured terminal escape')
   else:result=native.run_sequence(local,plan,{},adapter,lambda:None,writer=writer)
 finally:
  core.update(old);support.update(support_old);browser['subprocess']=old_browser_port
 receipt=handles[0]['receipt'];assert len(handles)==1 and result['status']=='HOLD' and signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
 assert receipt['bootstrapObservations'][0]['result']['returncode']==0 and receipt['bootstrapPortRestored']
 assert result['primaryFailure'] is receipt['primaryFailure'] is receipt['observationFailures'][0]['failure']
 expected='AssertionError' if mode=='stage-exit' else 'DeadlineExpired' if mode.endswith('deadline') else 'KeyboardInterrupt' if mode.endswith('cancel') else 'OSError' if mode=='path-error' else 'TimeoutExpired'
 assert result['primaryFailure']['type']==expected,(mode,delivery,result['primaryFailure'])
 if mode not in ['stage-exit'] and not mode.endswith('deadline'):
  assert observed and result['primaryFailure']['details']['future']['unknown']==repr(b'KEPT\xfe')
 if mode=='stage-exit':assert receipt['stageCommandObservations'][-1]['result']['unknown']['bytes']==repr(b'KEPT\xfe')
 if delivery=='stage-write':assert any(e['message']=='STAGE_RECEIPT_FAILURE' for e in receipt['secondaryFailures'])
 if delivery=='all-sinks':assert result['terminalDelivery']['completeObservationsPersisted'] is False and result['receiptFallbacks']
 assert result['terminalReleaseProved'] is False and made[-1].scratch.exists() and (p/'private').exists()
 save(dict(name='observer-'+mode+'-'+delivery,status='PASS',result=result,receipt=receipt,helperState=made[-1].state,events=events,nativeProcesses=0))

for mode in ['hash-timeout','hash-cancel','hash-deadline','path-error','stage-timeout','stage-exit','stage-cancel','stage-deadline']:
 for delivery in ['normal','helper-write','all-sinks']:observer_case(mode,delivery)
observer_case('stage-timeout','stage-write')


def enumeration_case(route):
 root=O/('inventory-'+route);root.mkdir(mode=0o700);(root/'known').write_bytes(b'known')
 hidden=root/'hidden';hidden.mkdir();(hidden/'unknown').write_bytes(b'not-zero');hidden.chmod(0)
 try:
  try:list(os.scandir(hidden))
  except PermissionError:pass
  else:raise AssertionError('Real directory denial required')
  facts={};target=root/'new.json'
  spec=importlib.util.spec_from_file_location('binding_control',A/'bind-local.py');binding=importlib.util.module_from_spec(spec);spec.loader.exec_module(binding)
  functions={'packet':lambda:budget.inventory(root),'budget':lambda:budget.before_write(root,target,2),
             'inspect':lambda:budget.inspect(root),'artifact-index':lambda:inspector.tree_index(root,set()),
             'archive-bytes':lambda:enumeration.tree_bytes(root,facts),'binding':lambda:binding.files(root)}
  try:functions[route]()
  except PermissionError as error:failure=caller.error_receipt(error)
  else:raise AssertionError('Incomplete inventory accepted')
  assert not target.exists() and failure['details'].get('inventoryObservation',{}).get('complete') is False
  save(dict(name='inventory-'+route,status='PASS',failure=failure,partial=facts))
 finally:hidden.chmod(0o700)
for route in ['packet','budget','inspect','artifact-index','archive-bytes','binding']:enumeration_case(route)


def terminal_inventory(all_sinks):
 root=O/('terminal-inventory-'+str(all_sinks));root.mkdir();packet=root/'packet';packet.mkdir();proof=root/'proof';proof.mkdir();hidden=packet/'hidden';hidden.mkdir();(hidden/'unknown').write_bytes(b'unknown');hidden.chmod(0)
 primary=dict(type='FirstFailure',message='FIRST',details={'unknown':None});result=dict(status='HOLD',primaryFailure=primary);calls=[]
 def audit(_):raise AssertionError('No synthetic jobs in this metric control')
 try:
  with contextlib.ExitStack() as stack:
   if all_sinks:
    def save_error(*a):calls.append('proof');raise OSError('PROOF_FAILURE')
    stack.enter_context(patch.object(accounting,'save',save_error))
   original_packet=budget.write_json
   def packet_write(*a,**k):calls.append('packet');return original_packet(*a,**k)
   stack.enter_context(patch.object(budget,'write_json',packet_write))
   assert accounting.persist_terminal_summary(result,[],audit,[],proof,packet,time.monotonic()) is result
  assert result['primaryFailure'] is primary and 'outputBytes' not in result
  assert result['outputInventory']['complete'] is False and result['terminalDelivery']['packet']['status']=='failed'
  assert result['terminalDelivery']['completeObservationsPersisted'] is (not all_sinks) and 'packet' in calls
  save(dict(name='terminal-incomplete-'+str(all_sinks),status='PASS',result=result,calls=calls))
 finally:hidden.chmod(0o700)
for all_sinks in [False,True]:terminal_inventory(all_sinks)


def helper_inventory(kind):
 root=O/('helper-inventory-'+kind);root.mkdir(mode=0o700);private=root/'private';private.mkdir(mode=0o700);observations=[];calls=[]
 if kind=='profile':
  directory=private/'playwright_chromiumdev_profile-abc';directory.mkdir();hidden=directory/'hidden';hidden.mkdir();(hidden/'bytes').write_bytes(b'unknown');hidden.chmod(0)
  job=core['StationJob'].__new__(core['StationJob']);job.out=root/'out';job.out.mkdir();job.scratch=root/'scratch';job.scratch.mkdir();job.target='INERT';job.state={'drained':True,'profiles':[str(directory)]}
  old=core['subprocess']
  def command(*a,**k):calls.append('native-boundary');raise AssertionError('Forbidden native boundary')
  core['subprocess']=SimpleNamespace(run=command);function=job.archive;kwargs={'profile_namespace':private,'profile_prefixes':('playwright_chromiumdev_profile-',)};pos=()
  namespace=core
 else:
  hidden=private/'hidden';hidden.mkdir();(hidden/'bytes').write_bytes(b'unknown');hidden.chmod(0)
  old=browser['shutil']
  def copy(*a,**k):calls.append('copy-boundary');raise AssertionError('Forbidden copy/cleanup boundary')
  browser['shutil']=SimpleNamespace(copytree=copy,rmtree=copy);function=browser['preserve_private_tmp'];pos=(private,browser['tmp_admission'](private),root/'copy');kwargs={'no_process_launched':True};namespace=browser
 old_ports=(namespace['os'],namespace['Path'])
 try:
  try:enumeration.guarded_call(function,observations,*pos,**kwargs)
  except PermissionError as error:failure=caller.error_receipt(error)
  else:raise AssertionError('Incomplete helper inventory accepted')
  assert not calls and observations and observations[-1]['complete'] is False
  assert (namespace['os'],namespace['Path'])==old_ports and hidden.exists()
  save(dict(name='helper-inventory-'+kind,status='PASS',failure=failure,observations=observations,calls=calls))
 finally:
  hidden.chmod(0o700)
  if kind=='profile':core['subprocess']=old
  else:browser['shutil']=old
for kind in ['profile','private']:helper_inventory(kind)


def enumeration_fault(mode):
 root=O/('enumeration-'+mode);root.mkdir();(root/'known').write_bytes(b'abc');hidden=root/'next';hidden.mkdir();(hidden/'later').write_bytes(b'unknown');facts={}
 original=os.scandir
 def scan(path):
  if Path(path)==hidden:
   if mode=='deadline':time.sleep(.2)
   e=KeyboardInterrupt() if mode=='cancel' else OSError('SCANDIR_PRODUCER_FAILURE')
   e.future={'partial':b'RAW\xff'};raise e
  return original(path)
 with contextlib.ExitStack() as stack:
  stack.enter_context(patch.object(os,'scandir',scan))
  if mode=='deadline':stack.enter_context(core['deadline'](.025))
  try:list(enumeration.paths(root,facts))
  except BaseException as error:failure=caller.error_receipt(error)
  else:raise AssertionError('Fault accepted')
 assert facts['complete'] is False and facts['directories'][0]['files']==['known'] and signal.getitimer(signal.ITIMER_REAL)[0]==0
 if mode!='deadline':assert failure['details']['future']['partial']==repr(b'RAW\xff')
 save(dict(name='enumeration-'+mode,status='PASS',failure=failure,observations=facts))
for mode in ['unknown','cancel','deadline']:enumeration_fault(mode)


def archive_dispatch():
 root=O/'archive-dispatch';root.mkdir();(root/'packet').mkdir();(root/'proof').mkdir();hidden_paths=[];starts=[];handles=[]
 local={**READY,'captureSeconds':1,'cleanupSeconds':1,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof')};plan={**PLAN,'runRoot':str(root)}
 class Job:
  def __init__(self,out,*a,**k):
   self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.coalition_id=123;self.known={};self.state={'exits':{'capture':0}}
  def save(self):pass
  def start(self):starts.append('start')
  def wait(self,*a):return 'completed'
  def drain(self,*a):return dict(drained=True,clean=True)
  def archive(self,**k):
   hidden=self.out/'hidden';hidden.mkdir();p=hidden/'over-budget'
   with p.open('wb') as f:f.truncate(1024**3+1)
   hidden.chmod(0);hidden_paths.append(hidden);caller.write(self.out/'profile_release.json',{'all_absent':True})
 adapter=native.NativeAdapter.__new__(native.NativeAdapter);adapter.ready=local;adapter.plan=plan;adapter.grant={'authorizationId':'INERT'}
 adapter.core=SimpleNamespace(StationJob=Job,deadline=core['deadline'],coalition_members=lambda _:[],kernel_tasks=lambda _:dict(live=0))
 def allocate(path):p=path.parent/'private';p.mkdir();return p,{}
 adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=lambda *a,**k:dict(all_bytes_preserved=True,namespace_removed=True))
 adapter.prepare=lambda *a:['INERT'];adapter.resource_observer=lambda *a:None;adapter.inspect_native=lambda:None
 adapter.audit=lambda h:dict(attemptPath=h['path'],releaseProved=True,kernel=dict(live=0,coalition_absent=True))
 original_run=adapter.run
 def run(d,h):handles.append(h);return original_run(d,h)
 adapter.run=run
 try:
  result=native.run_sequence(local,plan,{},adapter,lambda:None)
  assert len(starts)==len(handles)==1 and result['status']=='HOLD'
  receipt=handles[0]['receipt'];assert receipt['cleanupFailure']['type']=='PermissionError' and receipt['archiveInventory']['complete'] is False
  assert 'archiveBytesObservedAfterRelease' not in receipt
  save(dict(name='actual-archive-acceptance',status='PASS',result=result,receipt=receipt,starts=starts))
 finally:
  for hidden in hidden_paths:hidden.chmod(0o700)
archive_dispatch()
print(json.dumps(dict(status='PASS',controls=len(RESULTS),nativeJobs=0)))
