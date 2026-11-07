"""CPU-only admission fixtures. Grants, claims and output directories stay in memory."""
import sys,os,json,hashlib,io,copy,time,argparse,subprocess,contextlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode=True
A=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(A))
import native189 as native,caller,resource_admission as resources
parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args();assert not args.report.exists()
ready=native.load(native.READY);plan=native.load(native.PLAN);root=Path(plan['runRoot']);real_snapshot=native.snapshot
head=subprocess.check_output([native.GIT,'-C',ready['root'],'rev-parse','HEAD'],text=True).strip()
prospective=json.loads((A/'revision-12/prospective-paths.json').read_text())['paths']
def absent():assert all(not os.path.lexists(p) for p in prospective)
def digest(value):return hashlib.sha256((json.dumps(value,indent=2)+'\n').encode()).hexdigest()
def memory_snapshot(value):
 raw=(json.dumps(value,indent=2)+'\n').encode();assert len(raw)<=2*1024**2
 return dict(value=copy.deepcopy(value),sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),observation={'fixture':'IN_MEMORY_ONLY','readBytes':len(raw)})
rows=[]
def save(row):
 rows.append(row);args.report.write_text(json.dumps(dict(cases=rows,count=len(rows),runtimeJobs=0,realGrantsWritten=0,realConsumptionWritten=0,operationalAllocations=0),indent=2)+'\n');print(row['name'],row['status'],flush=True)
absent();native.verify_sources(ready);native.check_plan(plan)
save(dict(name='actual-source-and-plan-admission',status='PASS',bindings=len(ready['bindings']),software=len(ready['softwareBindings']),nativeFixtureAuthorization=True,runtimeAuthorization=False))
for mode in ['exact-reserve','one-byte-short','purpose','capture-go','native-go','order','frames','expired','too-long','head','readiness-hash','plan-hash','candidate-hash','wrong-grant-path','cancel','run-exists','consumed-exists','native-flag-off','capture-flag-on','cached-ready-drift']:
 current=copy.deepcopy(ready);passed=current;now=time.time();calls=[];claim=[];dirs=[];grant_reads=[]
 grant=dict(purpose=native.PURPOSE,nativeFixtureGo=True,captureGo=False,jobIds=native.JOBS,frames=189,authorizationId='CPU-MEMORY-ONLY-NOT-AN-OPERATIONAL-GRANT',runRoot=plan['runRoot'],expiresUnix=now+1800,head=head,readinessSha256=caller.sha(native.READY),planSha256=caller.sha(native.PLAN),candidateSha256=caller.sha(A/'candidate-index.json'),future={'unknown':['retained',None]})
 for key,value in {'purpose':'CAPTURE','capture-go':True,'native-go':False,'order':list(reversed(native.JOBS)),'frames':190,'expired':now-1,'too-long':now+7200,'head':'0'*40,'readiness-hash':'0'*64,'plan-hash':'0'*64,'candidate-hash':'0'*64}.items():
  if mode==key:grant[{'capture-go':'captureGo','native-go':'nativeFixtureGo','order':'jobIds','expired':'expiresUnix','too-long':'expiresUnix','readiness-hash':'readinessSha256','plan-hash':'planSha256','candidate-hash':'candidateSha256'}.get(key,key)]=value
 if mode=='native-flag-off':current['nativeFixtureAuthorization']=False
 if mode=='capture-flag-on':current['runtimeAuthorization']=True
 if mode=='cached-ready-drift':passed=copy.deepcopy(current);passed['nativeFixtureAuthorization']=False
 grant_snapshot=memory_snapshot(grant)
 def snapshot(path,expected=None,**kwargs):
  if Path(path)==Path(plan['grantPath']):grant_reads.append(str(path));result=grant_snapshot
  elif Path(path)==native.READY and mode in ['native-flag-off','capture-flag-on']:result=memory_snapshot(current)
  else:return real_snapshot(path,expected,**kwargs)
  assert expected is None or result['sha256']==expected
  return result
 original_open=Path.open;original_exists=Path.exists
 class Claim(io.StringIO):
  def __exit__(self,*a):claim.append(json.loads(self.getvalue()));self.close()
 def opening(path,*a,**k):
  if path==Path(plan['consumedPath']):
   assert a==('x',);calls.append('exclusive-consumption')
   if mode=='consumed-exists':raise FileExistsError('INERT_SPENT_CLAIM')
   return Claim()
  return original_open(path,*a,**k)
 def mkdir(path,*a,**k):
  assert path==root or root in path.parents
  dirs.append(dict(path=str(path),args=list(a),kwargs=k))
 def exists(path):
  if mode=='cancel' and path==Path(plan['cancelPath']):return True
  if mode=='run-exists' and path==root:return True
  return original_exists(path)
 with contextlib.ExitStack() as stack:
  for context in [patch.object(native,'snapshot',snapshot),patch.object(native,'git_head',lambda _:head),patch.object(resources.shutil,'disk_usage',lambda _:SimpleNamespace(free=22066626560-(mode=='one-byte-short'))),patch.object(Path,'open',opening),patch.object(Path,'mkdir',mkdir),patch.object(Path,'exists',exists)]:stack.enter_context(context)
  try:
   record=native.consume(passed,plan,plan['grantPath'] if mode!='wrong-grant-path' else '/private/tmp/t02-native189-r04-20261107-t3-11167406-grant.json')
  except BaseException as error:
   assert mode!='exact-reserve';failure=caller.error_receipt(error);assert not claim and not dirs
  else:
   assert mode=='exact-reserve' and len(claim)==1 and len(dirs)==6
   assert record==claim[0] and record['future']==grant['future'] and record['capacity']['marginBytes']==0
   assert record['capacity']['reserveBytes']==22066626560 and record['capacity']['quota'] is False
   failure=None
 absent();assert not any(n in sys.modules for n in ['round4_job_boundary','round4_capture_children','run_round4_browser_proof'])
 save(dict(name=mode,status='PASS',failure=failure,grantSnapshots=len(grant_reads),allocationPortCalls=calls,memoryDirectoryCount=len(dirs),memoryRecord=claim[0] if claim else None,qualification='Grant snapshot, clean-HEAD port, free-space sample and allocation ports are inert CPU fixtures. Operational paths remain absent.'))
# Actual main, actual source/grant reads, with launch ports instrumented to prove none is reached.
launches=[]
def forbidden(*a,**k):launches.append('FORBIDDEN');raise AssertionError('Native launch forbidden in source unit')
with patch.object(native,'NativeAdapter',forbidden),patch.object(subprocess,'Popen',forbidden),patch.object(sys,'argv',['native189.py','--execute','--grant',plan['grantPath']]):
 try:native.main()
 except FileNotFoundError as error:
  assert Path(error.filename)==Path(plan['grantPath']);failure=caller.error_receipt(error)
 else:raise AssertionError('Absent grant accepted')
assert not launches;absent();save(dict(name='actual-main-absent-grant-zero-launch',status='PASS',failure=failure,launches=launches))
print(json.dumps(dict(status='PASS',controls=len(rows),runtimeJobs=0,realGrantOrOutputAllocations=0)))
