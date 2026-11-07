import sys,json,subprocess,hashlib,tempfile
from pathlib import Path
from types import SimpleNamespace
from contextlib import contextmanager
from unittest.mock import patch
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'isolated/green/candidate'))
import caller,contract,release_accounting as release
native=[]
def refuse(*a,**kw):native.append(str(a));raise AssertionError('Native launch forbidden')
subprocess.Popen=refuse
ready=json.loads((contract.HERE/'readiness.json').read_text())
@contextmanager
def deadline(seconds):yield
cases=[
 dict(name='start-final-returned-proof-fail',start=True,receipt=True,returned=True,proof=True),
 dict(name='start-final-returned-packet-fail',start=True,receipt=True,returned=True,packet=True),
 dict(name='start-cleanup-final-returned-proof-fail',start=True,cleanup=True,receipt=True,returned=True,proof=True),
 dict(name='oversized-audit-final-returned-proof-fail',audit=True,large=True,receipt=True,returned=True,proof=True),
 dict(name='small-audit-final-returned-proof-fail',audit=True,receipt=True,returned=True,proof=True),
 dict(name='start-final-returned-write-fail-summary-succeeds',start=True,receipt=True,returned=True),
 dict(name='refused-first-audit-recovers',audit=True,recover=True),
 dict(name='happy-five-jobs'),
]
RUN=Path(tempfile.mkdtemp(prefix='combined-run-',dir=ROOT))
results=[]
for case in cases:
 root=RUN/'combined-proofs'/case['name'];root.mkdir(parents=True)
 packet=root/'packet';proof=root/'proof';packet.mkdir();proof.mkdir()
 local={**ready,'packetRoot':str(packet),'proofRoot':str(proof),'tsxImport':'/inert/tsx','process_binary_sha256':{}}
 starts=[];handles=[];registration_reads=[]
 class Job:
  def __init__(self,out,argv,checkout,**kw):
   self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.target='inert';self.coalition_id=123
   self.known={'51':{'birth':[1,2],'unknownRecorded':{'id':99}}};self.state={'exits':{'capture':0}}
  def save(self):pass
  def start(self):
   starts.append(self.out.parent.name)
   if case.get('start'):raise RuntimeError('ORIGINAL_START_FAILURE')
  def wait(self,*a):return 'completed'
  def members(self):return []
  def drain(self,*a):
   if case.get('cleanup'):raise RuntimeError('CLEANUP_DRAIN_FAILURE')
   return {'drained':True,'clean':True,'unknownDrain':{'id':77}}
  def archive(self,**kw):self.scratch.rmdir();caller.write(self.out/'profile_release.json',{'all_absent':True})
 def allocate(p):d=p.parent/'private';d.mkdir();return d,{'synthetic':True}
 def preserve(d,*a,**kw):d.rmdir();return {'all_bytes_preserved':True,'namespace_removed':True}
 def registration(*a,**kw):
  registration_reads.append(True)
  failed=case.get('audit') and (not case.get('recover') or len(registration_reads)==1)
  return SimpleNamespace(returncode=0 if failed else 1,stdout='RAW_REGISTRATION_OUTPUT',stderr='RAW_REGISTRATION_ERROR')
 adapter=caller.StationAdapter.__new__(caller.StationAdapter);adapter.ready=local;adapter.grant={'authorizationId':'inert'}
 adapter.core=SimpleNamespace(deadline=deadline,StationJob=Job,coalition_members=lambda _:[],kernel_tasks=lambda _:dict(live=0,coalition_absent=True,unknownKernel={'raw':91,'extra':'x'*140000 if case.get('large') else None}),identity=lambda _:dict(birth=[2,3],unknownIdentity=73))
 adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=preserve,executable_path=refuse)
 adapter.support=SimpleNamespace(StageReceipts=lambda *a:SimpleNamespace(observe=lambda:None,require_browser=lambda:None))
 adapter.inspect=lambda *a:{'accepted':True};adapter.inspect_packet=lambda *a:None
 real_run=adapter.run
 def run(definition,handle):handles.append(handle);return real_run(definition,handle)
 adapter.run=run
 original_write=caller.write;original_save=release.save;original_packet=release.budget.write_json
 def write(path,value):
  name=Path(path).name
  if case.get('receipt') and name=='receipt.json' and 'ownedAllocation' in value:raise OSError('FINAL_RECEIPT_WRITE_FAILURE')
  if case.get('returned') and name=='returned-receipts.json':raise OSError('RETURNED_RECEIPTS_WRITE_FAILURE')
  return original_write(path,value)
 def save(path,value):
  if case.get('proof') and Path(path)==proof/'result.json':raise OSError('TERMINAL_PROOF_WRITE_FAILURE')
  return original_save(path,value)
 def packet_write(*a,**kw):
  if case.get('packet'):raise OSError('TERMINAL_PACKET_WRITE_FAILURE')
  return original_packet(*a,**kw)
 result=None;raised=None
 with patch.object(caller,'write',write),patch.object(subprocess,'run',registration),patch.object(release,'save',save),patch.object(release.budget,'write_json',packet_write):
  try:result=caller.run_sequence(local,adapter,packet,proof,writer=write)
  except BaseException as e:raised={'type':type(e).__name__,'message':str(e),'details':vars(e)}
 durable='\n'.join(p.read_text() for base in [proof,packet] for p in base.rglob('*.json'))
 # Evidence below is reviewer instrumentation of otherwise-local data, stored OUTSIDE the candidate proof tree.
 row={'case':case,'returned':result is not None,'raised':raised,'starts':starts,
  'durableOriginalStart':'ORIGINAL_START_FAILURE' in durable,'durableRawKernel':'unknownKernel' in durable,
  'durableFinalWrite':'FINAL_RECEIPT_WRITE_FAILURE' in durable,'durableRegistration':'RAW_REGISTRATION_OUTPUT' in durable,
  'packetTerminalExists':(packet/'integration-result.json').exists(),'proofTerminalExists':(proof/'result.json').exists(),
  'status':result['status'] if result else None,'terminalReleaseProved':result['terminalReleaseProved'] if result else None,
  'instrumentedHandleReceipts':[h.get('receipt') for h in handles]}
 if case['name']=='happy-five-jobs':assert len(starts)==5 and result['status']=='CAPTURED_PENDING_VISUAL_REVIEW'
 else:assert len(starts)==1
 if case.get('proof'):
  assert result is None and raised['message']=='TERMINAL_PROOF_WRITE_FAILURE'
  assert not row['durableOriginalStart'] and not row['durableRawKernel']
  assert not row['packetTerminalExists']
 elif case.get('packet'):
  assert result is None and raised['message']=='TERMINAL_PACKET_WRITE_FAILURE' and row['durableOriginalStart']
 elif case.get('recover'):
  assert result['status']=='HOLD' and result['terminalReleaseProved'] is False
  assert result['terminalAudit'][0]['releaseProved'] is True
  assert result['receiptFallbacks'][0]['receipt']['releaseAudits'][0]['releaseProved'] is False
 elif case.get('start'):
  assert result['status']=='HOLD' and result['primaryFailure']['message']=='ORIGINAL_START_FAILURE' and row['durableFinalWrite']
 assert not native
 (RUN/'combined-proofs'/f"{case['name']}-instrumentation.json").write_text(json.dumps(row,indent=2)+'\n')
 results.append({k:v for k,v in row.items() if k!='instrumentedHandleReceipts'})
assert not any(m in sys.modules for m in ['round4_job_boundary','round4_capture_children','run_round4_browser_proof','run_round4_remaining8'])
(RUN/'combined-results.json').write_text(json.dumps({'nativeCalls':len(native),'results':results},indent=2)+'\n')
print(json.dumps({'run':str(RUN),'nativeCalls':len(native),'cases':len(results),'proofFallbackLossCases':sum(x['case'].get('proof',False) for x in results)},indent=2))
