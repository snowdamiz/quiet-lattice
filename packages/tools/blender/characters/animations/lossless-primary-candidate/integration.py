"""One bounded CPU fixture: existing PNG replay and independent streaming validation."""
import hashlib,importlib.util,json,os,shutil,subprocess,sys,time
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def load(p):return json.loads(Path(p).read_text())
def main():
    ready=load(HERE/'readiness.json');assert ready['runtimeAuthorization'] is False
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
        assert len(jobs)<4 and shutil.disk_usage(HERE).free>=4*1024**3,'Safety floor before next owned job'
        out=proof/name;out.mkdir();job=private=admission=None;t=time.monotonic()
        receipt={'name':name,'argv':argv,'captureSeconds':120,'cleanupSeconds':20,'primaryFailure':None,'cleanupFailure':None,'scope':ready['purpose']}
        def persist():save(out/'receipt.json',receipt)
        try:
            with deadline(120):
                private,admission=create_private_tmp(out/'private-tmp-admission.json')
                job=StationJob.__new__(StationJob);StationJob.__init__(job,out/'owned-job',argv,ready['root'],capture_seconds=120,
                    env={'PATH':ready['pathEnvironment'],'TMPDIR':str(private)+'/', 'PYTHONDONTWRITEBYTECODE':'1'})
                job.state.update(scope=ready['purpose'],readiness_sha256=sha(HERE/'readiness.json'));job.save();job.start();handles.append((job,private))
                actual={}
                def observe():
                    for row in job.members():
                        file=executable_path(row['pid']);assert file in allowed and sha(file)==allowed[file],'Unbound CPU executable: '+str(file)
                        actual[str(row['pid'])]={'identity':identity(row['pid']),'executable':file,'sha256':allowed[file]}
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
                    receipt['terminal']={'coalition':job.coalition_id,'kernel':kernel_tasks(job.coalition_id),'exactBirthsAbsent':len(job.known),'registrationAbsent':True,'scratchAndTmpAbsent':True,'privateTmpCacheRelease':cache}
            except BaseException as e:receipt['cleanupFailure']={'type':type(e).__name__,'message':str(e)}
        receipt['pipelineSeconds']=time.monotonic()-t;persist();jobs.append({'path':str(out/'receipt.json'),'sha256':sha(out/'receipt.json'),**receipt})
        assert receipt['primaryFailure'] is None and receipt['cleanupFailure'] is None,receipt
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
        config={**ready['rgbPrimary'],'schema':ready['primaryArtifactSchema'],'video':str(cap/'primary.mp4'),'frameMap':str(cap/'frame-map.json'),'helperDirectory':ready['helperDirectory'],'output':str(validation)}
        save(proof/'validate-config.json',config)
        validator=owned('validator',[ready['rgbPrimary']['python'],str(HERE/'rgb-primary.py'),'validate-primary',str(proof/'validate-config.json')])
        result['inspection']=caller.inspect_capture(ready['stages'][0],cap,ready,validation,validator)
        result['completeOriginalNonImageObservations']=True;result['sourcePngRgbRgbaIdentities']=True;result['status']='PASS_CPU_EXISTING_132_PRIMARY_INTEGRATION'
    except BaseException as e:result['primaryFailure']={'type':type(e).__name__,'message':str(e)}
    finally:
        # Fresh terminal facts after all owned jobs; keep failures, outputs and caches intact.
        audit=[]
        for job,private in handles:
            kernel=kernel_tasks(job.coalition_id);members=coalition_members(job.coalition_id)
            births=[{'pid':int(pid),'recorded':old,'current':identity(int(pid))} for pid,old in job.known.items()]
            registration=subprocess.run(['/bin/launchctl','print',job.target],capture_output=True,text=True,timeout=3)
            item={'coalition':job.coalition_id,'kernel':kernel,'members':members,'births':births,'target':job.target,'registrationExit':registration.returncode,'scratchAbsent':not job.scratch.exists(),'privateTmpAbsent':not private.exists()}
            assert kernel['live']==0 and kernel['coalition_absent'] and not members and registration.returncode!=0 and item['scratchAbsent'] and item['privateTmpAbsent']
            assert all(b['current'] is None or b['current']['birth']!=b['recorded']['birth'] for b in births)
            audit.append(item)
        result['terminalAudit']=audit;result['nativeJobs']=len(jobs);result['pipelineSeconds']=time.monotonic()-started
        result['outputBytes']=sum(p.stat().st_size for p in packet.rglob('*') if p.is_file());result['freeBytesAfter']=shutil.disk_usage(HERE).free
        save(proof/'result.json',result);save(packet/'integration-result.json',result)
        print(json.dumps({'status':result['status'],'primaryFailure':result['primaryFailure'],'nativeJobs':len(jobs),'proof':str(proof),'packetBytes':result['outputBytes'],'released':all(x['kernel']['live']==0 for x in audit)}),flush=True)
    return 0 if result['primaryFailure'] is None else 1
if __name__=='__main__':raise SystemExit(main())
