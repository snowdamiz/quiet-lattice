import sys,json,tempfile
from pathlib import Path
from types import SimpleNamespace
from contextlib import contextmanager
from unittest.mock import patch
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).parent/'candidate'))
import caller,contract
ready=json.loads((contract.HERE/'readiness.json').read_text())
@contextmanager
def deadline(seconds):yield
results=[]
for mode in ['final-receipt-write-after-start-error','raw-audit-refusal']:
 tmp=Path(tempfile.mkdtemp(prefix='thalune-adverse-',dir='/tmp')).resolve();(tmp/'packet').mkdir();(tmp/'proof').mkdir()
 local={**ready,'packetRoot':str(tmp/'packet'),'proofRoot':str(tmp/'proof'),'tsxImport':'/synthetic/tsx','process_binary_sha256':{}}
 events=[]
 class Job:
  def __init__(self,out,argv,root,**kw):
   self.out=out;out.mkdir();self.scratch=out/'scratch';self.scratch.mkdir();self.target='inert';self.coalition_id=123;self.known={};self.state={'exits':{'capture':0}}
  def save(self):pass
  def start(self):
   events.append('start')
   if mode=='final-receipt-write-after-start-error':raise RuntimeError('ORIGINAL_START_FAILURE')
  def wait(self,*a):return 'completed'
  def members(self):return []
  def drain(self,*a):return {'drained':True,'clean':True,'rawDrainUnknown':{'preserved':True}}
  def archive(self,**kw):self.scratch.rmdir();caller.write(self.out/'profile_release.json',{'all_absent':True})
 def allocate(p):
  d=p.parent/'private';d.mkdir();return d,{'synthetic':True}
 def preserve(d,*a,**kw):d.rmdir();return {'all_bytes_preserved':True,'namespace_removed':True}
 adapter=caller.StationAdapter.__new__(caller.StationAdapter);adapter.ready=local;adapter.grant={'authorizationId':'synthetic'}
 adapter.core=SimpleNamespace(deadline=deadline,StationJob=Job,coalition_members=lambda _:[],kernel_tasks=lambda _:dict(live=0,coalition_absent=True,unknownKernel={'raw':91}),identity=lambda _:None)
 adapter.temp=SimpleNamespace(create_private_tmp=allocate,preserve_private_tmp=preserve,executable_path=lambda _:None)
 adapter.support=SimpleNamespace(StageReceipts=lambda *a:SimpleNamespace(observe=lambda:None,require_browser=lambda:None))
 original_write=caller.write
 def injected_write(path,value):
  if mode=='final-receipt-write-after-start-error' and Path(path).name=='receipt.json' and value.get('primaryFailure') is not None:raise OSError('FINAL_RECEIPT_WRITE_FAILURE')
  return original_write(path,value)
 with patch.object(caller,'write',injected_write),patch.object(caller.subprocess,'run',lambda *a,**kw:SimpleNamespace(returncode=0 if mode=='raw-audit-refusal' else 1,stdout='RAW_REGISTRATION_OUTPUT',stderr='RAW_REGISTRATION_ERROR')):
  result=caller.run_sequence(local,adapter,tmp/'packet',tmp/'proof')
 text='\n'.join(p.read_text() for p in (tmp/'proof').rglob('*.json'))
 row={'mode':mode,'root':str(tmp),'started':events,'status':result['status'],'primaryFailure':result['primaryFailure'],'nativeJobs':result['nativeJobs'],'terminalAuditFailures':result['terminalAuditFailures'],'originalStartFailureRetained':'ORIGINAL_START_FAILURE' in text,'rawKernelRetained':'unknownKernel' in text,'rawRegistrationRetained':'RAW_REGISTRATION' in text}
 results.append(row)
print(json.dumps(results,indent=2))
