"""Pure controls over the actual candidate observer and terminal-summary functions."""
import copy,errno,importlib.util,json,subprocess,sys,tempfile,time
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
native_calls=[]
def refuse(*args,**kwargs):native_calls.append(str(args));raise AssertionError('Native process refused in pure controls')
subprocess.Popen=refuse
spec=importlib.util.spec_from_file_location('integration',HERE/'integration.py');unit=importlib.util.module_from_spec(spec);spec.loader.exec_module(unit)
row={'pid':48123,'birth':[100,200],'uid':501,'status':2,'pgid':48123};tool='/fixture/bound-software-tool';allowed={tool:'a'*64}
class Job:
    def __init__(self,member):self.member=member
    def members(self):return [copy.deepcopy(self.member)]
def identity_reads(values):
    values=iter(copy.deepcopy(values))
    return lambda pid:next(values)
def path_failure(pid):raise ProcessLookupError(errno.ESRCH,'fixture child path unavailable')
def observed_seed():
    actual={};events=[]
    unit.observe_executables(Job(row),allowed,actual,events,identity_reads([row,row]),lambda pid:tool,lambda path:'a'*64)
    assert list(actual)==[unit.admission_key(row)]
    return actual
results=[]
def exercise(name,actual,after,path=path_failure,member=row,raises=None):
    events=[];snapshots=[];before=copy.deepcopy(member)
    try:
        unit.observe_executables(Job(member),allowed,actual,events,identity_reads([before,after]),path,lambda path:'a'*64,
            lambda:snapshots.append(copy.deepcopy({'admissions':actual,'events':events})))
    except AssertionError as error:
        assert raises and raises in str(error),(name,str(error));message=str(error)
    else:assert raises is None,name+' should refuse';message=None
    results.append({'control':name,'pass':True,'refusal':message,'events':events,'persistedSnapshots':snapshots})
    return events
actual=observed_seed();original=copy.deepcopy(actual)
e=exercise('previously admitted child departed during executable-path read',actual,None)
assert actual==original and e[0]['status']=='departed' and e[0]['postReadIdentity'] is None and e[0]['priorActualAdmission']['executable']==tool
exercise('same live birth with path failure remains fatal',observed_seed(),row,raises='Live same-birth')
replacement={**row,'birth':[100,201]};e=exercise('replacement birth cannot inherit admitted PID',observed_seed(),replacement,raises='Replacement birth/UID')
assert e[0]['postReadIdentity']==replacement
exercise('unadmitted departed child cannot inherit admission',{},None,raises='Unadmitted child')
exercise('unsupported live executable refused',observed_seed(),row,path=lambda pid:'/fixture/unsupported',raises='Unbound CPU executable')
changed_uid={**row,'uid':502};exercise('changed UID cannot inherit admission',observed_seed(),changed_uid,raises='Replacement birth/UID')
zombie={**row,'status':5};e=exercise('admitted zombie remains awaiting reap',observed_seed(),zombie)
assert e[0]['status']=='awaiting_reap' and e[0]['postReadIdentity']['status']==5 and 'released' not in e[0]
exercise('unadmitted zombie refuses',{},zombie,raises='Unadmitted child')
exercise('different member birth cannot use old PID admission',observed_seed(),None,member=replacement,raises='Unadmitted child')
exercise('replacement after successful path read still refuses',observed_seed(),replacement,path=lambda pid:tool,raises='Replacement birth/UID')
# An already absent or zombie identity before the path call also retains explicit facts.
for status,initial in [('departed',None),('awaiting_reap',zombie)]:
    events=[];actual=observed_seed();path_calls=[]
    unit.observe_executables(Job(row),allowed,actual,events,identity_reads([initial]),lambda pid:path_calls.append(pid),lambda path:'a'*64)
    assert not path_calls and events[0]['status']==status
    results.append({'control':'prior admitted '+status+' before path read','pass':True,'events':events})
# Persist a summary from the actual source function even when the fresh direct audit raises.
root=Path(tempfile.mkdtemp(prefix='t02-observer-summary-control-'))
for existing_primary in [True,False]:
    d=root/str(existing_primary);d.mkdir();proof=d/'proof';proof.mkdir();packet=d/'packet';packet.mkdir()
    primary={'type':'OriginalFailure','message':'preserve first failure'} if existing_primary else None
    cleanup={'cleanupFailure':{'type':'OriginalCleanup','message':'preserve cleanup'}}
    result={'status':'PASS','primaryFailure':copy.deepcopy(primary),'jobs':[cleanup]}
    def audit_failed(handle):raise AssertionError('fixture terminal audit failure')
    unit.persist_terminal_summary(result,[object()],audit_failed,[cleanup],proof,packet,time.monotonic())
    stored=json.loads((proof/'result.json').read_text());assert stored==json.loads((packet/'integration-result.json').read_text())
    assert stored['terminalReleaseProved'] is False
    assert stored['status']=='HOLD' and stored['jobs']==[cleanup] and stored['terminalAuditFailures'][0]['message']=='fixture terminal audit failure'
    assert stored['primaryFailure']==primary if existing_primary else stored['primaryFailure']['type']=='TerminalAuditFailure'
    results.append({'control':'summary persisted on audit failure, existingPrimary='+str(existing_primary),'pass':True,'path':str(proof/'result.json')})
ready=json.loads((HERE/'readiness.json').read_text())
assert not Path(ready['captureOutput']).parent.exists() and not Path(ready['cpuProofRoot']).exists()
try:unit.main()
except AssertionError as error:assert 'no new native fixture authorized' in str(error)
else:raise AssertionError('Disabled main entry accepted')
assert not Path(ready['captureOutput']).parent.exists() and not Path(ready['cpuProofRoot']).exists()
results.append({'control':'disabled actual main refuses before allocation or native launch','pass':True})
assert not native_calls
(HERE/'observer-controls.json').write_text(json.dumps({'status':'PASS_ACTUAL_CANDIDATE_IN_PROCESS_CONTROLS','controls':results,'nativeCalls':native_calls,'summaryFixtureRoot':str(root)},indent=2)+'\n')
print(json.dumps({'status':'PASS','controls':len(results),'nativeCalls':len(native_calls),'summaryFixtureRoot':str(root)}))
