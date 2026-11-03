"""Archive an already drained failed fixture without altering its initial receipt."""
import hashlib,json,os,subprocess,sys,time
from pathlib import Path
sys.dont_write_bytecode=True
support=Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/blend/stations/_authoring')
sys.path.insert(0,str(support))
from round4_job_boundary import StationJob,deadline,identity,kernel_tasks,coalition_members
from run_round4_browser_proof import preserve_private_tmp
root=Path(__file__).resolve().parent;owned=root/'producer/owned-job';b=json.loads((owned/'boundary.json').read_text());receipt=root/'producer/receipt.json'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
scratch=Path(b['scratch']);admission=json.loads((root/'producer/private-tmp-admission.json').read_text());private=Path(admission['path'])
files=[]
for base in [root,scratch,Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/packages/tools/blender/characters/animations/lossless-primary-candidate/packet')]:
 for p in sorted(base.rglob('*')):
  if p.is_file():files.append({'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)})
save(root/'initial-failure-index.json',{'phase':'BEFORE_ARCHIVE_RECOVERY','initialReceiptSha256':sha(receipt),'boundarySha256':sha(owned/'boundary.json'),'files':files,'note':'Initial observer failure and clean=false retained; this recovery does not accept the fixture or retry execution.'})
job=StationJob.__new__(StationJob);job.out=owned;job.scratch=scratch;job.target=b['target'];job.root=b['root'];job.coalition_id=b['coalition_id'];job.known=b['identities'];job.state={k:v for k,v in b.items() if k not in ['target','scratch','root','coalition_id','identities']};job.registered=True
result={'initialReceiptSha256':sha(receipt),'initialFailureIndexSha256':sha(root/'initial-failure-index.json'),'recoveryOnly':True,'primaryFailure':None}
try:
 with deadline(20):
  assert job.state['drained'] and kernel_tasks(job.coalition_id)['live']==0 and not coalition_members(job.coalition_id)
  job.archive(profile_namespace=private,profile_prefixes=('playwright_chromiumdev_profile-',))
  result['cacheRelease']=preserve_private_tmp(private,admission,job.out/'preserved-private-tmp',job=job)
  assert result['cacheRelease']['all_bytes_preserved'] and result['cacheRelease']['namespace_removed']
  assert not scratch.exists() and not private.exists()
except BaseException as e:result['primaryFailure']={'type':type(e).__name__,'message':str(e)}
current=[]
for pid,old in job.known.items():
 now=identity(int(pid));assert now is None or now['birth']!=old['birth'];current.append({'pid':int(pid),'recordedBirth':old['birth'],'current':now})
ps=subprocess.check_output(['/bin/ps','-axo','pid=,ppid=,pgid=,command='],text=True)
groups=sorted({x['pgid'] for x in job.known.values()});group_rows=[line for line in ps.splitlines() if len(line.split())>=3 and int(line.split()[2]) in groups]
registration=subprocess.run(['/bin/launchctl','print',job.target],capture_output=True,text=True,timeout=3)
assert not group_rows and registration.returncode!=0 and kernel_tasks(job.coalition_id)['coalition_absent']
(root/'pmset-assertions.txt').write_text(subprocess.check_output(['/usr/bin/pmset','-g','assertions'],text=True))
assert not any(('pid '+str(pid)+'(') in (root/'pmset-assertions.txt').read_text() for pid in map(int,job.known))
result.update(terminal={'coalition':job.coalition_id,'kernel':kernel_tasks(job.coalition_id),'members':coalition_members(job.coalition_id),'births':current,'groups':groups,'groupRows':group_rows,'controllerAbsent':identity(job.root['pid']) is None,'registrationExit':registration.returncode,'scratchAbsent':not scratch.exists(),'privateTmpAbsent':not private.exists(),'profileRelease':json.loads((owned/'profile_release.json').read_text()),'ownedPortProcessesAbsent':True,'ownedAssertionsAbsent':True},initialReceiptUnchanged=sha(receipt)==result['initialReceiptSha256'],boundaryUnchanged=sha(owned/'boundary.json')==json.loads((root/'initial-failure-index.json').read_text())['boundarySha256'])
assert result['initialReceiptUnchanged'] and result['boundaryUnchanged']
save(root/'recovery-release.json',result);print(json.dumps({'recoveryOnly':True,'error':result['primaryFailure'],'kernel':result['terminal']['kernel'],'births':len(current),'groups':groups,'scratchAbsent':not scratch.exists(),'privateTmpAbsent':not private.exists(),'sha256':sha(root/'recovery-release.json')}))
