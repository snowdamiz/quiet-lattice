"""One bounded CPU fixture: existing PNG replay and independent streaming validation."""
import hashlib,importlib.util,json,os,shutil,subprocess,sys,time
from pathlib import Path
import packet_budget as budget
sys.dont_write_bytecode=True
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
        try:audits.append(audit_one(handle))
        except BaseException as error:errors.append({'type':type(error).__name__,'message':str(error)})
    result.update(terminalAudit=audits,terminalAuditFailures=errors,nativeJobs=len(jobs),pipelineSeconds=time.monotonic()-started,
        outputBytes=sum(p.stat().st_size for p in packet.rglob('*') if p.is_file()),freeBytesAfter=shutil.disk_usage(HERE).free)
    result['terminalReleaseProved']=not errors and len(audits)==len(handles) and all(x['kernel']['live']==0 and x['kernel']['coalition_absent'] for x in audits)
    if errors:
        result['status']='HOLD'
        if result['primaryFailure'] is None:result['primaryFailure']={'type':'TerminalAuditFailure','message':'Terminal resource release unproved; see terminalAuditFailures'}
    # Full native observations remain in their exact private receipts; packet stores bounded references.
    refs=[{'path':j['path'],'sha256':sha(j['path'])} for j in jobs]
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

def main():
    ready=load(HERE/'readiness.json');assert ready['runtimeAuthorization'] is False
    assert ready.get('nativeFixtureAuthorization') is True,'Disabled review candidate; no new native fixture authorized'
    assert ready['purpose']=='CPU_LOSSLESS_PRIMARY_132_EXISTING_FRAMES' and len(ready['sourceFrames'])==132
    for b in ready['bindings']:assert sha(b['path'])==b['sha256'],'Source/binary binding drift: '+b['path']
    for name in ['pure-python-controls.json','pure-node-controls.json']:assert load(HERE/name)['status'].startswith('PASS_')
    required=ready['fixtureDiskAdmission']['totalRequiredBytes'];free=shutil.disk_usage(HERE).free
    assert free>=required,f'Fixture admission refused: {free} < {required}'
    packet=HERE/'packet';proof=Path(ready['cpuProofRoot']);assert not packet.exists() and not proof.exists(),'One attempt; no implicit retry'
    packet.mkdir(mode=0o700);proof.mkdir(mode=0o700);Path(ready['nativeRawDirectory']).mkdir()
    save(proof/'admission.json',{'freeBytes':free,'requiredBytes':required,'utc':time.time(),'footprint':ready['fixtureDiskAdmission'],'readinessSha256':sha(HERE/'readiness.json'),'zeroFreshRendering':True})
    sys.path.insert(0,ready['helperDirectory'])
    from round4_job_boundary import StationJob,deadline,identity,kernel_tasks,coalition_members
    from run_round4_browser_proof import create_private_tmp,preserve_private_tmp,executable_path
    spec=importlib.util.spec_from_file_location('caller',HERE/'caller.py');caller=importlib.util.module_from_spec(spec);spec.loader.exec_module(caller)
    allowed={str(Path(x).resolve()):sha(Path(x).resolve()) for x in [ready['node'],ready['rgbPrimary']['python'],ready['rgbPrimary']['ffmpeg'],ready['rgbPrimary']['ffprobe'],'/usr/bin/caffeinate']}
    jobs=[];handles=[];started=time.monotonic()
    def owned(name,argv):
        assert len(jobs)<ready['fixtureDiskAdmission']['newAttemptMaxNativeJobs'] and shutil.disk_usage(HERE).free>=4*1024**3,'Safety floor before next owned job'
        out=proof/name;out.mkdir();job=private=admission=None;t=time.monotonic()
        receipt={'name':name,'argv':argv,'captureSeconds':120,'cleanupSeconds':20,'primaryFailure':None,'cleanupFailure':None,'scope':ready['purpose']}
        def persist():save(out/'receipt.json',receipt)
        try:
            with deadline(120):
                private,admission=create_private_tmp(out/'private-tmp-admission.json')
                job=StationJob.__new__(StationJob);StationJob.__init__(job,out/'owned-job',argv,ready['root'],capture_seconds=120,
                    env={'PATH':ready['pathEnvironment'],'TMPDIR':str(private)+'/', 'PYTHONDONTWRITEBYTECODE':'1'})
                job.state.update(scope=ready['purpose'],readiness_sha256=sha(HERE/'readiness.json'));job.save();job.start();handles.append((job,private))
                actual={};events=[]
                receipt['actualExecutables']=actual;receipt['observerEvents']=events
                def observe():
                    observe_executables(job,allowed,actual,events,identity,executable_path,on_event=persist)
                receipt['outcome']=job.wait(max(.001,120-(time.monotonic()-t)),observe)
                receipt['actualExecutables']=actual;receipt['exits']=dict(job.state['exits']);persist()
                assert receipt['outcome']=='completed' and job.state['exits'].get('capture')==0,'Owned CPU fixture failed'
        except BaseException as e:receipt['primaryFailure']={'type':type(e).__name__,'message':str(e)};persist()
        finally:
            try:
                with deadline(20):
                    assert job is not None and job.coalition_id
                    drain=job.drain(20);receipt['drain']=drain
                    assert drain['drained'] and drain['clean'] and kernel_tasks(job.coalition_id)['live']==0 and not coalition_members(job.coalition_id)
                    job.archive(profile_namespace=private,profile_prefixes=('playwright_chromiumdev_profile-',))
                    cache=preserve_private_tmp(private,admission,job.out/'preserved-private-tmp',job=job)
                    assert cache['all_bytes_preserved'] and cache['namespace_removed'] and not private.exists() and not job.scratch.exists()
                    assert all(identity(int(pid)) is None or identity(int(pid))['birth']!=old['birth'] for pid,old in job.known.items())
                    registration=subprocess.run(['/bin/launchctl','print',job.target],capture_output=True,text=True,timeout=3);assert registration.returncode!=0
                    receipt['archiveBytesObservedAfterRelease']=sum(p.stat().st_size for p in out.rglob('*') if p.is_file())+sum(p.stat().st_size for p in (Path(ready['nativeRawDirectory'])/('validator' if name=='validator' else '')).glob('*') if p.is_file())
                    if receipt['archiveBytesObservedAfterRelease']>1024**3 and receipt['primaryFailure'] is None:receipt['primaryFailure']={'type':'ArchiveAcceptanceCeilingExceeded','message':'All bytes preserved; combined private archive size is an observed acceptance cap, not a hard quota'}
                    receipt['terminal']={'coalition':job.coalition_id,'kernel':kernel_tasks(job.coalition_id),'exactBirthsAbsent':len(job.known),'registrationAbsent':True,'scratchAndTmpAbsent':True,'privateTmpCacheRelease':cache}
            except BaseException as e:receipt['cleanupFailure']={'type':type(e).__name__,'message':str(e)}
        receipt['pipelineSeconds']=time.monotonic()-t;persist();jobs.append({'path':str(out/'receipt.json'),'sha256':sha(out/'receipt.json'),**receipt})
        assert receipt['primaryFailure'] is None and receipt['cleanupFailure'] is None,'Owned CPU fixture refused; complete receipt at '+str(out/'receipt.json')
        return receipt
    result={'status':'HOLD','primaryFailure':None,'jobs':jobs,'runtimeAuthorization':False}
    try:
        producer=owned('producer',[ready['node'],str(HERE/'replay-fixture.mjs'),str(HERE/'readiness.json')])
        cap=Path(ready['captureOutput']);mapping=load(cap/'frame-map.json')['frames']
        assert len(mapping)==132
        for row,source in zip(mapping,ready['sourceFrames']):
            assert row['sourcePngSha256']==source['pngSha256'] and row['sourcePngBytes']==source['pngBytes']
            assert row['rgbSha256']==source['rgbSha256'] and row['rgbaSha256']==source['rgbaSha256']
            original=load(source['observationPath']);original.pop('dataUrl');assert load(cap/row['observation'])==original,'Incomplete non-image observation'
        validation=packet/'validation'
        config={**ready['rgbPrimary'],'schema':ready['primaryArtifactSchema'],'video':str(cap/'primary.mp4'),'frameMap':str(cap/'frame-map.json'),'helperDirectory':ready['helperDirectory'],'output':str(validation),'packetRoot':str(packet),'nativeRawDirectory':ready['nativeRawDirectory']+'/validator'}
        save(proof/'validate-config.json',config)
        validator=owned('validator',[ready['rgbPrimary']['python'],str(HERE/'rgb-primary.py'),'validate-primary',str(proof/'validate-config.json')])
        result['inspection']=caller.inspect_capture(ready['stages'][0],cap,ready,validation,validator)
        result['completeOriginalNonImageObservations']=True;result['sourcePngRgbRgbaIdentities']=True;result['status']='PASS_CPU_EXISTING_132_PRIMARY_INTEGRATION'
    except BaseException as e:result['primaryFailure']={'type':type(e).__name__,'message':str(e)}
    finally:
        # Fresh terminal facts after all owned jobs; keep failures, outputs and caches intact.
        def audit_one(handle):
            job,private=handle
            kernel=kernel_tasks(job.coalition_id);members=coalition_members(job.coalition_id)
            births=[{'pid':int(pid),'recorded':old,'current':identity(int(pid))} for pid,old in job.known.items()]
            registration=subprocess.run(['/bin/launchctl','print',job.target],capture_output=True,text=True,timeout=3)
            item={'coalition':job.coalition_id,'kernel':kernel,'members':members,'births':births,'target':job.target,'registrationExit':registration.returncode,'scratchAbsent':not job.scratch.exists(),'privateTmpAbsent':not private.exists()}
            assert kernel['live']==0 and kernel['coalition_absent'] and not members and registration.returncode!=0 and item['scratchAbsent'] and item['privateTmpAbsent']
            assert all(b['current'] is None or b['current']['birth']!=b['recorded']['birth'] for b in births)
            return item
        persist_terminal_summary(result,handles,audit_one,jobs,proof,packet,started)
        audit=result['terminalAudit']
        print(json.dumps({'status':result['status'],'primaryFailure':result['primaryFailure'],'nativeJobs':len(jobs),'proof':str(proof),'packetBytes':result['outputBytes'],'released':result['terminalReleaseProved']}),flush=True)
    return 0 if result['primaryFailure'] is None else 1
if __name__=='__main__':raise SystemExit(main())
