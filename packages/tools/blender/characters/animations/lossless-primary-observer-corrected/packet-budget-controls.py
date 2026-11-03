"""Finite in-process packet budget controls; no native process is allowed."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import importlib.util,json,subprocess,sys,tempfile,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
calls=[]
def refuse(*a,**k):calls.append(str(a));raise AssertionError('Native launch refused')
subprocess.Popen=refuse
import packet_budget as b
spec=importlib.util.spec_from_file_location('integration',HERE/'integration.py');u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
spec=importlib.util.spec_from_file_location('caller',HERE/'caller.py');caller=importlib.util.module_from_spec(spec);spec.loader.exec_module(caller)
root=Path(tempfile.mkdtemp(prefix='t02-packet-budget-control-'));results=[]
def case(name):p=root/name;p.mkdir();return p
def reject(name,fn,fragment):
    try:fn()
    except AssertionError as e:assert fragment in str(e),(name,str(e));results.append({'control':name,'pass':True});return
    raise AssertionError(name+' unexpectedly accepted')
p=case('byte-boundary');b.before_write(p,p/'new',b.METADATA_BYTES-2*b.RECORD_BYTES);results.append({'control':'exact normal-byte boundary accepted','pass':True})
reject('normal byte boundary+1 refuses before file creation',lambda:b.write_bytes(p,p/'new',b'x'*(b.METADATA_BYTES-2*b.RECORD_BYTES+1)),'Aggregate packet metadata')
assert not (p/'new').exists()
p=case('atomic-peak');(p/'existing').write_bytes(b'x'*128)
reject('replacement counts old bytes plus new temporary',lambda:b.before_write(p,p/'existing',b.METADATA_BYTES-2*b.RECORD_BYTES,atomic=True),'Aggregate packet metadata')
assert (p/'existing').read_bytes()==b'x'*128 and not (p/'existing.writing').exists()
p=case('file-boundary')
for i in range(b.FILE_COUNT-4):(p/str(i)).touch()
b.before_write(p,p/'next',0);results.append({'control':'file boundary preserves media+two reserved slots','pass':True})
p=case('file-overflow')
for i in range(b.FILE_COUNT-3):(p/str(i)).touch()
reject('file count overflow before write',lambda:b.write_bytes(p,p/'extra',b''),'Aggregate packet file-count')
assert not (p/'extra').exists()
p=case('terminal-reserve');fill=p/'full-normal';fill.touch()
with fill.open('r+b') as f:f.truncate(b.METADATA_BYTES-2*b.RECORD_BYTES)
first={'primaryFailure':{'type':'FirstFailure','message':'preserve primary'}};b.first_failure(p,first);b.first_failure(p,{'overwritten':True});assert json.loads((p/'failure.json').read_text())==first
proof=case('summary-private');job=proof/'receipt.json';job.write_text(json.dumps({'primaryFailure':first['primaryFailure'],'cleanupFailure':{'message':'preserve cleanup'}}));jobref={'path':str(job),'sha256':u.sha(job)}
# Private job data lives outside the packet in production; this fixture uses a separate sibling.
packet=case('summary-packet');f=packet/'full-normal';f.touch()
with f.open('r+b') as stream:stream.truncate(b.METADATA_BYTES-2*b.RECORD_BYTES)
b.first_failure(packet,first)
result={'status':'HOLD','primaryFailure':first['primaryFailure'],'jobs':[jobref]}
def audit_failure(handle):raise AssertionError('reserved terminal audit failure')
u.persist_terminal_summary(result,[object()],audit_failure,[jobref],proof,packet,time.monotonic())
stored=json.loads((packet/'integration-result.json').read_text());assert stored['primaryFailure']==first['primaryFailure'] and stored['jobs']==[jobref] and stored['terminalAuditFailures']
assert b.inspect(packet)['normalBytes']+b.inspect(packet)['reservedBytes']<=b.METADATA_BYTES
results.append({'control':'full normal budget retains first failure and bounded terminal summary with cleanup reference','pass':True})
fresh=case('reserved-overflow')
reject('reserved record byte overflow refuses before write',lambda:b.before_write(fresh,fresh/'failure.json',b.RECORD_BYTES+1,reserved=True),'')
assert not (fresh/'failure.json').exists()
p=case('independent-inspector');(p/'capture').mkdir();(p/'validation').mkdir();f=p/'oversized';f.touch()
with f.open('r+b') as stream:stream.truncate(b.METADATA_BYTES+1)
reject('independent primary inspector refuses aggregate overflow',lambda:caller.inspect_capture({'kind':'motion'},p/'capture',{'primaryArtifactSchema':'t02-lossless-rgb-primary/v1','packetRoot':str(p)},p/'validation',{}),'')
p=case('oversized-terminal');proof=case('oversized-private');primary={'type':'OriginalFailure','message':'x'*(2*b.RECORD_BYTES)}
state={'status':'HOLD','primaryFailure':primary,'jobs':[]}
u.persist_terminal_summary(state,[],lambda x:None,[],proof,p,time.monotonic())
small=json.loads((p/'integration-result.json').read_text());full=json.loads((proof/'result.json').read_text())
assert (p/'integration-result.json').stat().st_size<=b.RECORD_BYTES and full['primaryFailure']==primary and small['completeTerminalSummary']['sha256']==u.sha(proof/'result.json')
results.append({'control':'oversized terminal keeps exact primary in private summary and bounded packet reference','pass':True})
assert not calls
(HERE/'packet-budget-controls.json').write_text(json.dumps({'status':'PASS_ACTUAL_PACKET_WRITER_AND_INSPECTOR_PURE_CONTROLS','nativeCalls':calls,'controls':results,'fixtureRoot':str(root),'sparseBoundaryFilesPreserved':True},indent=2)+'\n')
print(json.dumps({'status':'PASS','controls':len(results),'nativeCalls':0,'fixtureRoot':str(root)}))
