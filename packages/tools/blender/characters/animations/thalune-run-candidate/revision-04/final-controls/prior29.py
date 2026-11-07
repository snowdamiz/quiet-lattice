import sys, json, subprocess, io, hashlib
from pathlib import Path
from contextlib import contextmanager, ExitStack
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str('/private/tmp/t02-r04-bound-final-vcnh5p4b/snapshot/packages/tools/blender/characters/animations/thalune-run-candidate'))
import caller,contract,release_accounting as release
READY=json.loads((contract.HERE/'readiness.json').read_text())
NATIVE=[]
def forbidden(*a,**k):NATIVE.append(repr(a));raise AssertionError('UNAUTHORIZED_NATIVE_CALL')
subprocess.Popen=forbidden
@contextmanager
def deadline(_):yield
class Stream(io.StringIO):
 def __init__(self,mode):super().__init__();self.mode=mode;self.calls=0
 def write(self,text):
  self.calls+=1
  if self.mode=='error':raise OSError('STREAM_UNAVAILABLE')
  return super().write(text)
 def flush(self):
  if self.mode=='flush':raise OSError('STREAM_FLUSH_FAILURE')
  return super().flush()

def scenario(case):
 root=ROOT/'independent-proofs'/case['name'];root.mkdir(parents=True)
 packet=root/'packet';proof=root/'proof';packet.mkdir();proof.mkdir()
 local={**READY,'packetRoot':str(packet),'proofRoot':str(proof),'tsxImport':'/inert/tsx','process_binary_sha256':{}}
 config=root/'ready.json';config.write_text(json.dumps(local))
 starts=[];attempts=[];all_handles=[];audited=[];sink_calls={'proof':0,'packet':0};escaped=None;code=None
 stage=case.get('stage',1);kind=case.get('kind','start');file_mode=case.get('files','both-fail')
 class Job:
  def __init__(self,out,argv,checkout,**kwargs):
   self.name=out.parent.name;self.ordinal=next(i+1 for i,j in enumerate(READY['jobs']) if j['id']==self.name)
   self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.target='inert/'+self.name;self.coalition_id=self.ordinal
   self.known={'51':{'birth':[1,2],'rawRecorded':['future',None]}};self.state={'exits':{'capture':0}}
  def save(self):pass
  def start(self):
   starts.append(self.name)
   if self.ordinal==stage and kind in ['start','all-observation-fail','audit-throw','output-metric','nonserializable']:
    error=RuntimeError('FIRST_JOB_FAILURE');error.future={'nested':[None,False,17]};raise error
  def wait(self,*a):return 'completed'
  def members(self):return []
  def drain(self,*a):
   if self.ordinal==stage and kind in ['start','all-observation-fail'] and case.get('cleanup'):
    error=OSError('SECONDARY_CLEANUP_FAILURE');error.future={'rawCleanup':['keep',False]};raise error
   return {'drained':True,'clean':True,'rawDrain':[17,None]}
  def archive(self,**kw):self.scratch.rmdir();caller.write(self.out/'profile_release.json',{'all_absent':True,'rawProfile':[31,None]})
 def allocate(path):
  private=path.parent/'private';private.mkdir();return private,{'rawAllocation':[None,29]}
 def preserve(private,*a,**kw):private.rmdir();return {'all_bytes_preserved':True,'namespace_removed':True,'rawCache':[False,41]}
 def kernel(coalition):
  payload={'live':0,'coalition_absent':True,'rawKernel':{'id':coalition,'future':[False,None,71]}}
  if case.get('large'):payload['rawKernel']['large']='L'*140000
  if kind=='nonserializable':payload['rawKernel']['bytes']=b'raw_bytes'
  return payload
 def registration(argv,**kw):
  if kind=='audit-throw' and argv[-1].endswith(READY['jobs'][stage-1]['id']):
   raise subprocess.TimeoutExpired(argv,3,output=b'RAW_PARTIAL_OUTPUT',stderr=b'RAW_PARTIAL_ERROR')
  return SimpleNamespace(returncode=1,stdout='RAW_REGISTRATION_STDOUT',stderr='RAW_REGISTRATION_STDERR')
 adapter=caller.StationAdapter.__new__(caller.StationAdapter);adapter.ready=local;adapter.grant={'authorizationId':'inert-no-consumption'}
 adapter.core=SimpleNamespace(deadline=deadline,StationJob=Job,coalition_members=lambda _:[],kernel_tasks=kernel,identity=lambda _:dict(birth=[2,3],rawBirth=[None,97]))
 adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=preserve,executable_path=forbidden)
 adapter.support=SimpleNamespace(StageReceipts=lambda *a:SimpleNamespace(observe=lambda:None,require_browser=lambda:None))
 adapter.inspect=lambda *a:{'accepted':True};adapter.inspect_packet=lambda *a:None
 real_run=adapter.run;real_audit=adapter.audit
 def run(definition,handle):all_handles.append(handle);return real_run(definition,handle)
 def audit(handle):audited.append(handle['path']);return real_audit(handle)
 adapter.run=run;adapter.audit=audit
 real_write=caller.write;real_save=release.save;real_packet=release.budget.write_json
 def write(path,value):
  path=Path(path)
  if path.name=='attempts.json':
   attempts[:]=value
   if kind=='attempt-ledger' and len(value)==stage:raise OSError('ATTEMPT_LEDGER_FAILURE')
  target=READY['jobs'][stage-1]['id']
  if case.get('receipts',True) and path.name=='receipt.json' and path.parent.name==target:
   if kind=='initial-receipt' or 'ownedAllocation' in value:raise OSError('JOB_RECEIPT_FAILURE')
  if case.get('receipts',True) and path.name=='returned-receipts.json' and target in value:raise OSError('RETURNED_RECEIPTS_FAILURE')
  if kind=='sequence-state' and path.name=='sequence-state.json' and len(value['completed'])==stage:raise OSError('SEQUENCE_STATE_FAILURE')
  return real_write(path,value)
 def save(path,value):
  sink_calls['proof']+=1
  if file_mode in ['both-fail','proof-fail']:raise OSError('PROOF_SINK_FAILURE')
  return real_save(path,value)
 def packet_write(*a,**k):
  sink_calls['packet']+=1
  assert len(release.encode(a[2]))<=release.budget.RECORD_BYTES
  if file_mode in ['both-fail','packet-fail']:raise OSError('PACKET_SINK_FAILURE')
  return real_packet(*a,**k)
 captured={};real_sequence=caller.run_sequence
 def sequence(*a,**k):
  result=real_sequence(*a,**k,writer=write);captured['result']=result;return result
 real_disk=release.shutil.disk_usage
 def disk(*a):
  if kind in ['all-observation-fail','output-metric']:raise OSError('DISK_OBSERVATION_FAILURE')
  return real_disk(*a)
 real_rglob=Path.rglob
 def rglob(self,pattern):
  if kind in ['all-observation-fail','output-metric'] and self==packet:raise OSError('OUTPUT_BYTES_OBSERVATION_FAILURE')
  return real_rglob(self,pattern)
 stdout=Stream(case.get('stdout','error'));stderr=Stream(case.get('stderr','error'))
 with ExitStack() as stack:
  for obj,name,value in [(caller,'READY',config),(caller,'consume',lambda *a:{'authorizationId':'inert-no-consumption'}),(caller,'StationAdapter',lambda *a:adapter),
       (caller,'verify_runtime',lambda *a:None),(caller,'run_sequence',sequence),(caller,'write',write),(subprocess,'run',registration),
       (release,'save',save),(release.budget,'write_json',packet_write),(release.shutil,'disk_usage',disk),(Path,'rglob',rglob),
       (sys,'argv',['caller.py','--execute','--grant','never-read']),(sys,'stdout',stdout),(sys,'stderr',stderr)]:stack.enter_context(patch.object(obj,name,value))
  try:
   # Same entry/exit boundary as caller.py:321, using the actual main and dispatch bodies.
   raise SystemExit(caller.main())
  except SystemExit as error:code=error.code
  except caller.TerminalDeliveryError as error:escaped=error;code=1
 result=captured['result'];delivery=result['terminalDelivery'];text=json.dumps(result,default=str)
 planned=[j['id'] for j in READY['jobs']]
 jobs=5 if kind=='happy' else stage
 actual_started=jobs-(1 if kind in ['attempt-ledger','initial-receipt'] else 0)
 assert starts==planned[:actual_started],(case,starts)
 assert len(attempts)==jobs==result['nativeJobs']==len(result['terminalAudit'])
 assert [a['attemptPath'] for a in result['terminalAudit']]==[j['path'] for j in attempts]
 assert len(audited)==jobs+sum(len(h.get('auditObservations',[]))-1 for h in all_handles)
 # No public-boundary error may replace a job, cleanup, or prior persistence error.
 expected={'attempt-ledger':'ATTEMPT_LEDGER_FAILURE','initial-receipt':'JOB_RECEIPT_FAILURE','sequence-state':'SEQUENCE_STATE_FAILURE'}
 if kind in ['start','all-observation-fail','audit-throw','output-metric','nonserializable']:
  assert result['primaryFailure']['message']=='FIRST_JOB_FAILURE'
  assert result['primaryFailure']['details']['future']=={'nested':[None,False,17]}
 elif kind in expected:assert result['primaryFailure']['message']==expected[kind]
 if case.get('cleanup'):
  assert any(f['receipt']['cleanupFailure']['message']=='SECONDARY_CLEANUP_FAILURE' for f in result['receiptFallbacks'])
  assert 'rawCleanup' in text
 for audit in result['terminalAudit']:
  if audit.get('kernel'):
   assert audit['kernel']['rawKernel']['future']==[False,None,71]
   assert audit['births'][0]['recorded']['rawRecorded']==['future',None]
   assert audit['births'][0]['current']['rawBirth']==[None,97]
 if kind=='audit-throw':assert 'RAW_PARTIAL_OUTPUT' in text and 'RAW_PARTIAL_ERROR' in text
 if kind in ['all-observation-fail','output-metric']:assert 'DISK_OBSERVATION_FAILURE' in text and 'OUTPUT_BYTES_OBSERVATION_FAILURE' in text
 if kind!='nonserializable':assert sink_calls=={'proof':1,'packet':1},sink_calls
 else:assert sink_calls=={'proof':0,'packet':0},sink_calls
 all_ok=kind=='happy' and file_mode=='ok' and stdout.mode=='ok'
 assert (result['status']=='CAPTURED_PENDING_VISUAL_REVIEW')==all_ok
 assert code==(0 if all_ok else 1)
 if file_mode=='both-fail' or kind=='nonserializable':assert delivery['completeObservationsPersisted'] is False
 if stdout.mode=='error' and stderr.mode=='error' or kind=='nonserializable':
  assert escaped is not None and escaped.result is result
  assert delivery['stdout']['status']==delivery['stderr']['status']=='failed'
  assert not (packet/'integration-result.json').exists() if file_mode=='both-fail' else True
 elif stdout.mode=='ok':
  emitted=json.loads(stdout.getvalue());assert emitted['primaryFailure']==result['primaryFailure']
 else:
  emitted=json.loads(stderr.getvalue());assert emitted['primaryFailure']==result['primaryFailure']
  assert any(e['sink']=='stdout' for e in emitted['terminalPersistenceFailures'])
 if file_mode=='proof-fail' and kind!='nonserializable':
  saved=json.loads((packet/'integration-result.json').read_text())
  if case.get('large'):
   assert saved['observationsIncluded'] is False and saved['completeObservationsPersisted'] is False
   assert 'completeTerminalSummary' not in saved
  else:assert saved['primaryFailure']==result['primaryFailure']
 assert not NATIVE
 assert not any(n in sys.modules for n in ['round4_job_boundary','round4_capture_children','run_round4_browser_proof','run_round4_remaining8'])
 (root/'observed-result.json').write_text(json.dumps(result,indent=2,default=str)+'\n')
 return {'name':case['name'],'pass':True,'starts':len(starts),'attemptedJobs':len(attempts),'terminalAudits':len(result['terminalAudit']),
         'auditCalls':len(audited),'exit':code,'structuredException':escaped is not None,'status':result['status'],
         'sinkCalls':sink_calls,'completeObservationsPersisted':delivery['completeObservationsPersisted']}

cases=[]
for stage in range(1,6):
 for kind in ['start','initial-receipt','attempt-ledger','sequence-state']:
  cases.append(dict(name=f'{kind}-job{stage}-all-sinks-fail',stage=stage,kind=kind,cleanup=kind=='start',receipts=kind!='sequence-state'))
for name,options in [
 ('happy-exit-zero',dict(kind='happy',files='ok',stdout='ok',stderr='ok',receipts=False)),
 ('happy-then-proof-fails',dict(kind='happy',files='proof-fail',stdout='ok',stderr='ok',receipts=False)),
 ('happy-then-packet-fails',dict(kind='happy',files='packet-fail',stdout='ok',stderr='ok',receipts=False)),
 ('happy-then-streams-fail',dict(kind='happy',files='ok',receipts=False)),
 ('all-observation-and-delivery-fail',dict(kind='all-observation-fail',cleanup=True)),
 ('audit-timeout-all-sinks-fail',dict(kind='audit-throw')),
 ('stdout-flush-then-stderr-succeeds',dict(stdout='flush',stderr='ok',cleanup=True)),
 ('large-proof-loss-packet-partial',dict(files='proof-fail',large=True,stdout='ok',stderr='ok')),
 ('raw-nonserializable-still-escapes-in-memory',dict(kind='nonserializable',files='ok')),
]:cases.append(dict(name=name,**options))
rows=[]
for case in cases:
 rows.append(scenario(case))
 (ROOT/'independent-results.json').write_text(json.dumps({'nativeCalls':len(NATIVE),'rows':rows},indent=2)+'\n')
print(json.dumps({'status':'PASS','cases':len(rows),'nativeCalls':len(NATIVE),'root':str(ROOT/'independent-proofs')}))
