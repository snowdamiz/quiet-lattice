"""One bounded CPU fixture: existing PNG replay and independent streaming validation."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import hashlib,importlib.util,json,os,shutil,subprocess,sys,time
from pathlib import Path
import packet_budget as budget
from inspector import error_receipt
from admission_json import snapshot
HERE=Path(__file__).resolve().parent

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def load(p):return json.loads(Path(p).read_text())
def identity_key(row):
    return (int(row['pid']),tuple(row['birth']),int(row['uid']))

def admission_key(row):
    pid,birth,uid=identity_key(row)
    return f"{pid}:{birth[0]}:{birth[1]}:{uid}"

def delivery_failure(result,sink,error):
    failure={**error_receipt(error),'sink':sink}
    result.setdefault('terminalPersistenceFailures',[]).append(failure)
    result['terminalDelivery'][sink]['status']='failed'
    result['status']='HOLD'
    if result['primaryFailure'] is None:result['primaryFailure']=failure

def encode(value):return (json.dumps(value,indent=2)+'\n').encode()

def bounded_packet_summary(result,proof_reference):
    encoded=encode(result)
    if len(encoded)<=budget.RECORD_BYTES:return result,True
    result['status']='HOLD'
    result.setdefault('terminalPersistenceFailure',{'type':'ReservedTerminalRecordOverflow','bytes':len(encoded),'limit':budget.RECORD_BYTES})
    if result['primaryFailure'] is None:
        result['primaryFailure']={'type':'ReservedTerminalRecordOverflow','message':'Complete evidence exceeds the reserved packet record; see delivery qualification'}
    encoded=encode(result)
    summary={'status':'HOLD','nativeJobs':result['nativeJobs'],'terminalReleaseProved':result['terminalReleaseProved'],
        'observationsIncluded':False,'completeObservationsPersisted':proof_reference is not None,'completeEvidenceAvailableInMemory':True,
        'inMemoryResultSha256':hashlib.sha256(encoded).hexdigest(),'inMemoryResultBytes':len(encoded),
        'primaryFailure':result['primaryFailure'],'terminalPersistenceFailures':result['terminalPersistenceFailures'],
        'terminalPersistenceFailure':result['terminalPersistenceFailure']}
    if proof_reference is not None:summary['completeTerminalSummary']=proof_reference
    if len(encode(summary))>budget.RECORD_BYTES:
        # Oversized error details stay in the complete returned result, never silently truncated.
        for name in ['primaryFailure','terminalPersistenceFailures']:
            data=encode(summary.pop(name));summary[name+'Digest']={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
    assert len(encode(summary))<=budget.RECORD_BYTES,'Bounded terminal envelope exceeds reserve'
    return summary,False

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
            retained=snapshot(path);saved=retained['value'];refs.append({'path':path,'sha256':retained['sha256']})
            receipt=receipts.get(path,saved)
            assert receipt.get('cleanupFailure') is None,'Attempt cleanup remains unproved: '+path
            assert not receipt.get('persistenceFailures'),'Attempt receipt persistence failed: '+path
        except BaseException as error:
            if path in receipts:fallbacks[path]=receipts[path]
            errors.append({**error_receipt(error),'attemptPath':path})
    accounted=bool(jobs) and len(jobs)==len(handles)==len(audits) and len(set(paths))==len(paths)
    accounted=accounted and all(isinstance(x,dict) and x.get('releaseProved') is True and x['kernel']['live']==0 and x['kernel']['coalition_absent'] is True for x in audits) and [x.get('attemptPath') for x in audits]==paths
    if not accounted:errors.append({'type':'TerminalAttemptAccountingFailure','message':'Every allocation attempt requires its own positive terminal audit','attempts':len(jobs),'handles':len(handles),'audits':len(audits)})
    result.update(terminalAudit=audits,terminalAuditFailures=errors,nativeJobs=len(jobs),pipelineSeconds=time.monotonic()-started)
    for name,read in [('outputBytes',lambda:sum(p.stat().st_size for p in packet.rglob('*') if p.is_file())),
                      ('freeBytesAfter',lambda:shutil.disk_usage(HERE).free)]:
        try:result[name]=read()
        except BaseException as error:errors.append({**error_receipt(error),'observation':name})
    result['terminalReleaseProved']=not errors and accounted
    if errors:
        result['status']='HOLD'
        if result['primaryFailure'] is None:result['primaryFailure']={'type':'TerminalAuditFailure','message':'Terminal resource release unproved; see terminalAuditFailures'}
    # Failed receipt paths may contain stale bytes. Preserve complete in-memory evidence in the proof summary.
    result['receiptFallbacks']=[{'attemptPath':path,'receipt':receipt} for path,receipt in fallbacks.items()]
    result['jobs']=refs
    result['terminalPersistenceFailures']=[]
    delivery=result['terminalDelivery']={
        'proof':{'path':str(proof/'result.json'),'status':'not-attempted'},
        'packet':{'path':str(packet/'integration-result.json'),'status':'not-attempted'},
        'completeObservationsPersisted':False,
        'scope':'Files are snapshots; subsequent delivery errors remain in the returned result'}
    proof_reference=None
    try:
        delivery['proof']['status']='attempting'
        bounded_packet_summary(result,None) # Record overflow before the full proof snapshot.
        expected=encode(result)
        save(proof/'result.json',result)
        actual=(proof/'result.json').read_bytes()
        assert actual==expected,'Terminal proof write verification failed'
        proof_reference={'path':str(proof/'result.json'),'sha256':hashlib.sha256(actual).hexdigest(),'bytes':len(actual)}
        delivery['proof'].update(status='written',**proof_reference)
        delivery['completeObservationsPersisted']=True
    except BaseException as error:delivery_failure(result,'proof',error)
    try:
        delivery['packet']['status']='attempting'
        packet_summary,complete=bounded_packet_summary(result,proof_reference)
        expected=encode(packet_summary)
        budget.write_json(packet,packet/'integration-result.json',packet_summary,reserved=True)
        actual=(packet/'integration-result.json').read_bytes()
        assert actual==expected,'Terminal packet write verification failed'
        delivery['packet'].update(status='written',completeObservations=complete,sha256=hashlib.sha256(actual).hexdigest(),bytes=len(actual))
        delivery['completeObservationsPersisted']|=complete
    except BaseException as error:delivery_failure(result,'packet',error)
    return result
