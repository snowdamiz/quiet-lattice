"""One bounded CPU fixture: existing PNG replay and independent streaming validation."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import hashlib,importlib.util,json,os,shutil,subprocess,sys,time
from pathlib import Path
import packet_budget as budget
from inspector import error_receipt
HERE=Path(__file__).resolve().parent

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def load(p):return json.loads(Path(p).read_text())
def identity_key(row):
    return (int(row['pid']),tuple(row['birth']),int(row['uid']))

def admission_key(row):
    pid,birth,uid=identity_key(row)
    return f"{pid}:{birth[0]}:{birth[1]}:{uid}"

def observe_executables(job,allowed,admitted,events,read_identity,read_path,file_sha=sha,on_event=lambda:None):
    """Observe only kernel-owned members; a PID alone never carries admission."""
    for row in job.members():
        key=admission_key(row);prior=admitted.get(key);before=read_identity(row['pid'])
        def transition(after,error=None,path=None):
            event={'pid':row['pid'],'memberIdentity':row,'beforeIdentity':before,'postReadIdentity':after,
                'priorActualAdmission':prior,'pathReadError':error,'returnedPath':path}
            if after is None:
                event['status']='departed' if prior else 'unadmitted_departure_refused'
            elif identity_key(after)!=identity_key(row):event['status']='replacement_or_uid_change_refused'
            elif after['status']==5:event['status']='awaiting_reap' if prior else 'unadmitted_zombie_refused'
            else:event['status']='live_path_error_refused'
            events.append(event);on_event() # Preserve the actual post-read identity before any refusal.
            assert prior is not None,'Unadmitted child cannot inherit executable admission'
            assert identity_key(prior['identity'])==identity_key(row),'Admission birth/UID mismatch'
            assert after is None or identity_key(after)==identity_key(row),'Replacement birth/UID cannot inherit admission'
            assert after is None or after['status']==5,'Live same-birth executable-path failure'
        if before is None:
            transition(before);continue
        assert identity_key(before)==identity_key(row),'Member birth/UID changed before path read'
        if before['status']==5:
            transition(before);continue
        try:path=read_path(row['pid'])
        except OSError as error:
            after=read_identity(row['pid'])
            transition(after,{'type':type(error).__name__,'message':str(error),'errno':error.errno})
            continue
        after=read_identity(row['pid'])
        if after is None or identity_key(after)!=identity_key(row) or after['status']==5:
            transition(after,path=path);continue
        assert path in allowed and file_sha(path)==allowed[path],'Unbound CPU executable: '+str(path)
        admitted[key]={'identity':after,'memberIdentity':row,'executable':path,'sha256':allowed[path]}
        on_event()

def persist_terminal_summary(result,handles,audit_one,jobs,proof,packet,started):
    """An audit refusal holds the unit and is evidence; it must not erase its summary."""
    audits=[];errors=[]
    for handle in handles:
        before=len(handle.get('auditObservations', []))
        try:audits.append(audit_one(handle))
        except BaseException as error:
            audits.extend(handle.get('auditObservations', [])[before:])
            errors.append({**error_receipt(error),'attemptPath':handle['path']})
    receipts={h['path']:h['receipt'] for h in handles if 'receipt' in h}
    fallbacks={path:receipt for path,receipt in receipts.items() if receipt.get('persistenceFailures')}
    refs=[];paths=[j['path'] for j in jobs]
    for path in paths:
        try:
            saved=load(path);refs.append({'path':path,'sha256':sha(path)})
            receipt=receipts.get(path,saved)
            assert receipt.get('cleanupFailure') is None,'Attempt cleanup remains unproved: '+path
            assert not receipt.get('persistenceFailures'),'Attempt receipt persistence failed: '+path
        except BaseException as error:
            if path in receipts:fallbacks[path]=receipts[path]
            errors.append({**error_receipt(error),'attemptPath':path})
    accounted=bool(jobs) and len(jobs)==len(handles)==len(audits) and len(set(paths))==len(paths)
    accounted=accounted and all(isinstance(x,dict) and x.get('releaseProved') is True and x['kernel']['live']==0 and x['kernel']['coalition_absent'] is True for x in audits) and [x.get('attemptPath') for x in audits]==paths
    if not accounted:errors.append({'type':'TerminalAttemptAccountingFailure','message':'Every allocation attempt requires its own positive terminal audit','attempts':len(jobs),'handles':len(handles),'audits':len(audits)})
    result.update(terminalAudit=audits,terminalAuditFailures=errors,nativeJobs=len(jobs),pipelineSeconds=time.monotonic()-started,
        outputBytes=sum(p.stat().st_size for p in packet.rglob('*') if p.is_file()),freeBytesAfter=shutil.disk_usage(HERE).free)
    result['terminalReleaseProved']=not errors and accounted
    if errors:
        result['status']='HOLD'
        if result['primaryFailure'] is None:result['primaryFailure']={'type':'TerminalAuditFailure','message':'Terminal resource release unproved; see terminalAuditFailures'}
    # Failed receipt paths may contain stale bytes. Preserve complete in-memory evidence in the proof summary.
    result['receiptFallbacks']=[{'attemptPath':path,'receipt':receipt} for path,receipt in fallbacks.items()]
    result['jobs']=refs
    encoded=(json.dumps(result,indent=2)+'\n').encode()
    if len(encoded)>budget.RECORD_BYTES:
        result['status']='HOLD'
        result['terminalPersistenceFailure']={'type':'ReservedTerminalRecordOverflow','bytes':len(encoded),'limit':budget.RECORD_BYTES}
        if result['primaryFailure'] is None:result['primaryFailure']={'type':'ReservedTerminalRecordOverflow','message':'Complete terminal summary retained in the private proof'}
        save(proof/'result.json',result)
        packet_summary={'status':'HOLD','nativeJobs':len(jobs),'terminalReleaseProved':result['terminalReleaseProved'],'completeTerminalSummary':{'path':str(proof/'result.json'),'sha256':sha(proof/'result.json'),'bytes':(proof/'result.json').stat().st_size},'primaryFailureReference':'/primaryFailure','terminalPersistenceFailure':result['terminalPersistenceFailure']}
    else:
        save(proof/'result.json',result);packet_summary=result
    budget.write_json(packet,packet/'integration-result.json',packet_summary,reserved=True)
    return result
