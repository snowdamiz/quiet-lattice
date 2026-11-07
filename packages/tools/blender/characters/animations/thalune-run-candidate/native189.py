"""Task-specific native189 admission and two StationJob cohorts. Disabled by default."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import argparse, importlib, json, os, subprocess, time
from pathlib import Path
import caller, contract, packet_budget
from admission_json import snapshot, read
from inspector import error_receipt, sha, write
from release_accounting import persist_terminal_summary
from resource_admission import CohortRSS, reserve, tree, directory_chain, read_file, stat_row
from contextlib import ExitStack
import stat

HERE, READY, PLAN = contract.HERE, caller.READY, contract.HERE/'native189-plan.json'
GIT='/opt/homebrew/Cellar/git/2.56.0/bin/git'
PURPOSE='THALUNE_NATIVE189_DIAGNOSTIC_ONLY'
JOBS=['native-189-encode','native-189-validate']

def load(path):return read(path)

def git_head(root):
    def git(*args):return subprocess.run([GIT,'--no-optional-locks','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','--no-pager','-C',str(root),*args],capture_output=True,text=True,timeout=5,check=True).stdout
    assert not git('status','--porcelain=v1','--untracked-files=all'),'Checkout must be clean, including unknown files'
    return git('rev-parse','HEAD').strip()

def verify_sources(ready, snapshots=None):
    snapshots={} if snapshots is None else snapshots
    if str(READY) not in snapshots:snapshots[str(READY)]=snapshot(READY)
    current=snapshots[str(READY)]['value']
    assert current==ready,'Cached readiness differs from admitted snapshot'
    assert current['nativeFixtureAuthorization'] is True and current['runtimeAuthorization'] is False,'NATIVE189_DISABLED'
    assert GIT in current['process_binary_sha256'],'Git must be bound for the worker clean-HEAD consumer'
    assert current['root']==str(contract.ROOT) and current['helperDirectory']==str(HERE/'retained-station')
    assert current['pathEnvironment']==os.environ['PATH'] and str(Path(sys.executable).resolve())==current['rgbPrimary']['python']
    index_path=HERE/'candidate-index.json'
    if str(index_path) not in snapshots:snapshots[str(index_path)]=snapshot(index_path)
    for row in [*current['bindings'],*current['softwareBindings']]:
        digest=snapshots[row['path']]['sha256'] if row['path'] in snapshots else sha(row['path'])
        assert digest==row['sha256'],'Native source/software drift: '+row['path']
    for row in snapshots[str(index_path)]['value']['files']:
        path=str(HERE/row['path'])
        digest=snapshots[path]['sha256'] if path in snapshots else sha(path)
        assert digest==row['sha256'],'Native candidate drift'


def retained_inventory(plan):
    rows=[]
    for relative in plan['storage']['retainedInputs']:
        path=contract.ROOT/relative
        assert path.is_file() and not path.is_symlink(),'Retained inventory input absent'
        rows.append(dict(path=str(path),bytes=path.stat().st_size,sha256=sha(path)))
    assert rows,'No retained inputs bound'
    return dict(files=rows,fileCount=len(rows),bytes=sum(r['bytes'] for r in rows))

def check_plan(plan):
    assert plan['purpose']==PURPOSE and plan['jobs']==JOBS
    root=Path(plan['runRoot'])
    assert root.is_absolute() and root.resolve()==root and not root.is_relative_to(contract.ROOT)
    assert root.parent==Path('/private/tmp')
    assert plan['captureAuthorization'] is False and plan['rssBytes']==8*1024**3
    assert plan['frameCount']==189 and plan['perReelBytes']==39354368
    assert plan['captureSeconds']==600 and plan['cleanupSeconds']==60
    for key in ['grantPath','consumedPath','cancelPath']:
        p=Path(plan[key]);assert p.parent==root.parent and p.resolve()==p and p!=root
    assert len({plan[k] for k in ['runRoot','grantPath','consumedPath','cancelPath']})==4

def check_current(ready, plan, record, snapshots=None):
    snapshots={} if snapshots is None else snapshots
    for path,key in [(READY,'readinessSha256'),(PLAN,'planSha256'),(HERE/'candidate-index.json','candidateSha256'),(Path(plan['grantPath']),'grantSha256')]:
        if str(path) not in snapshots:snapshots[str(path)]=snapshot(path,record[key])
        assert snapshots[str(path)]['sha256']==record[key]
    assert snapshots[str(READY)]['value']==ready and snapshots[str(PLAN)]['value']==plan
    verify_sources(ready,snapshots);check_plan(plan)
    assert not Path(plan['cancelPath']).exists(),'Parent cancelled unit'
    assert git_head(ready['root'])==record['head'],'Consumed HEAD changed'
    grant=snapshots[plan['grantPath']]['value']
    assert all(record[k]==v for k,v in grant.items()),'Consumed grant fields changed'
    assert grant['purpose']==PURPOSE and grant['nativeFixtureGo'] is True and grant['captureGo'] is False
    assert grant['expiresUnix']>time.time(),'Native fixture grant expired'
    inventory=retained_inventory(plan)
    if 'capacity' in record:assert inventory==record['capacity']['inventory'],'Retained inventory changed'
    return reserve(plan,inventory)


def consume(ready,plan,grant_path):
    snapshots={str(READY):snapshot(READY),str(PLAN):snapshot(PLAN)}
    verify_sources(ready,snapshots);check_plan(plan)  # Zero grant reads / allocations while disabled.
    assert snapshots[str(PLAN)]['value']==plan
    assert Path(grant_path)==Path(plan['grantPath']) and not Path(grant_path).is_symlink()
    grant_snapshot=snapshot(grant_path);grant=grant_snapshot['value']
    snapshots[str(grant_path)]=grant_snapshot
    assert grant['purpose']==PURPOSE and grant['nativeFixtureGo'] is True and grant['captureGo'] is False
    assert grant['jobIds']==JOBS and grant['frames']==189 and grant['authorizationId']
    assert grant['runRoot']==plan['runRoot'] and grant['expiresUnix']>time.time() and grant['expiresUnix']<=time.time()+3600
    assert grant['head']==git_head(ready['root'])
    assert grant['readinessSha256']==snapshots[str(READY)]['sha256'] and grant['planSha256']==snapshots[str(PLAN)]['sha256']
    assert grant['candidateSha256']==snapshots[str(HERE/'candidate-index.json')]['sha256']
    assert not Path(plan['runRoot']).exists() and not Path(plan['cancelPath']).exists()
    record={**grant,'grantSha256':grant_snapshot['sha256']}
    record['capacity']=check_current(ready,plan,record,snapshots)
    with Path(plan['consumedPath']).open('x') as stream:json.dump(record,stream,indent=2)
    root=Path(plan['runRoot']);root.mkdir(mode=0o700)
    for relative in ['packet','proof','packet/captures','packet/inspections','packet/captures/motion-thalune-run-lod0']:(root/relative).mkdir()
    return record

def paths(plan,name):
    root=Path(plan['runRoot']);out=root/'proof/jobs'/name
    return dict(receipt=str(out/'receipt.json'),raw=str(out/'native'),capture=str(root/'packet/captures/motion-thalune-run-lod0'),
                inspection=str(root/'packet/inspections/native-189-validate'))

def config_for(ready,plan,record,name,consumed=None,predecessor=None):
    consumed=snapshot(plan['consumedPath']) if consumed is None else consumed
    assert consumed['value']==record, 'Consumption differs from original record'
    p=paths(plan,name)
    value=dict(**ready['rgbPrimary'],schema=contract.SCHEMA,frameCount=189,video=p['capture']+'/primary.mp4',
        frameMap=p['capture']+'/frame-map.json',helperDirectory=ready['helperDirectory'],output=p['inspection'],
        packetRoot=plan['runRoot']+'/packet',nativeRawDirectory=p['raw'],purpose=PURPOSE,jobId=name,
        authorizationId=record['authorizationId'],consumedSha256=consumed['sha256'])
    value.update(rawLog=p['raw']+'/encoder.raw.log',command=p['raw']+'/encoder-command.json',result=p['raw']+'/encoder-result.json')
    if name==JOBS[1]:
        predecessor=snapshot(paths(plan,JOBS[0])['receipt']) if predecessor is None else predecessor
        require_native_release(predecessor['value'])
        value['predecessorReceiptSha256']=predecessor['sha256']
    return value

def require_native_release(receipt):
    caller.require_release(receipt)
    assert receipt['outcome']=='completed' and type(receipt['exits']['capture']) is int and receipt['exits']['capture']==0,'Parent-observed worker exit is not exact zero'

def verify_worker(ready,config,mode,config_path,config_snapshot=None):
    config_snapshot=snapshot(config_path) if config_snapshot is None else config_snapshot
    assert config_snapshot['value']==config,'Unbound worker config reread'
    plan_snapshot=snapshot(PLAN);plan=plan_snapshot['value']
    consumed=snapshot(plan['consumedPath'],config['consumedSha256']);record=consumed['value']
    check_current(ready,plan,record,{str(PLAN):plan_snapshot})
    predecessor=snapshot(paths(plan,JOBS[0])['receipt'],config['predecessorReceiptSha256']) if mode=='validate' else None
    name=JOBS[0 if mode=='encode' else 1]
    assert Path(config_path)==Path(paths(plan,name)['receipt']).parent/'worker-config.json'
    assert config==config_for(ready,plan,record,name,consumed,predecessor),'Worker config/purpose drift'
    assert os.environ['T02_PILOT_STAGE']==name and os.environ['T02_PILOT_GRANT']==record['authorizationId']
    if mode=='validate':require_native_release(predecessor['value'])
    sys.path.insert(0,ready['helperDirectory'])
    core=importlib.import_module('round4_job_boundary')
    claim_worker(config,mode,config_path,core,config_snapshot)


def claim_worker(config,mode,config_path,core,config_snapshot=None):
    config_snapshot=snapshot(config_path) if config_snapshot is None else config_snapshot
    assert config_snapshot['value']==config
    out=Path(config_path).parent
    boundary=load(out/'owned-job/boundary.json')
    own=core.identity(os.getpid());root=core.identity(boundary['root']['pid'])
    assert own is not None and root is not None
    from release_accounting import identity_key
    assert identity_key(root)==identity_key(boundary['root']) and own['ppid']==root['pid']
    assert own['uid']==os.getuid() and core.coalition(own['pid'])[0]==boundary['coalition_id']>0
    request=load(Path(boundary['scratch'])/'request.json')
    assert request['argv']==[str(Path(sys.executable).resolve()),str(HERE/'native189_producer.py'),mode,str(config_path)]
    with (out/'worker-entry.json').open('x') as stream:
        json.dump(dict(identity=own,root=root,coalition=boundary['coalition_id'],configSha256=config_snapshot['sha256'],
                       consumedSha256=config['consumedSha256'],purpose=PURPOSE),stream,indent=2)

class NativeAdapter(caller.StationAdapter):
    def __init__(self,ready,plan,record):
        check_current(ready,plan,record)
        self.plan,self.grant=plan,record
        self.ready={**ready,'purpose':PURPOSE,'packetRoot':plan['runRoot']+'/packet','proofRoot':plan['runRoot']+'/proof'}
        sys.path.insert(0,ready['helperDirectory'])
        self.core=importlib.import_module('round4_job_boundary')
        self.temp=importlib.import_module('run_round4_browser_proof')

    def job_paths(self,definition):return paths(self.plan,definition['id'])

    def prepare(self,definition,out,p,receipt):
        name=definition['id'];mode='encode' if name==JOBS[0] else 'validate'
        if mode=='encode':Path(p['raw']).mkdir()
        config=config_for(self.ready,self.plan,self.grant,name);write(out/'worker-config.json',config)
        return [self.ready['rgbPrimary']['python'],str(HERE/'native189_producer.py'),mode,str(out/'worker-config.json')]

    def record_worker_result(self,definition,paths,receipt):
        failure=Path(paths['raw'])/'producer-failure.json'
        if failure.exists():
            assert failure.stat().st_size<=2*1024**2,'Native failure record ceiling'
            receipt['workerFailure']=load(failure)
            if receipt['primaryFailure'] is None:
                receipt['primaryFailure']=receipt['workerFailure']['primaryFailure']
            else:receipt.setdefault('secondaryFailures',[]).append(receipt['workerFailure']['primaryFailure'])

    def stage_observer(self,*args):return None

    def resource_observer(self,job,receipt):
        guard=CohortRSS(self.core,receipt.setdefault('rssObservations',[]),cancel=lambda:Path(self.plan['cancelPath']).exists(),
                        admit=lambda rows:self.admit_resource_members(receipt,rows))
        return lambda:guard.observe(job)

    def inspect_native(self):
        facts=self.inspectionObservations
        facts['deadlineSeconds']=30
        with self.core.deadline(30):
            root=Path(self.plan['runRoot']);packet=root/'packet'
            positive=load(packet/'inspections/native-189-validate/validation.json')
            surplus=load(packet/'inspections/native-189-validate/surplus-refusal.json')
            facts.update(positive=positive,surplus=surplus)
            assert positive['accepted'] is True and positive['frames']==189 and positive['everyRgbAndRgbaHash'] is True
            assert surplus['accepted'] is False and surplus['expectedRefusal'] is True and surplus['frames']==190
            with ExitStack() as stack:
                directory=packet/'captures/motion-thalune-run-lod0'
                parent_fd=directory_chain(directory,facts,stack)
                rows=[];facts['artifacts']=rows
                for name,limit in [('primary.mp4',contract.VIDEO_BYTES),('frame-map.json',64*1024**2)]:
                    info=os.stat(name,dir_fd=parent_fd,follow_symlinks=False)
                    row=stat_row(name,info);row['limitBytes']=limit;rows.append(row)
                    assert stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and 0<=info.st_size<=limit,'Native artifact type/owner/size refused'
                for row,key in zip(rows,['videoSha256','frameMapSha256']):
                    digest=read_file(directory/row['path'],row,facts,parent_fd=parent_fd)
                    assert positive[key]==digest,'Native artifact hash mismatch'
            current=packet_budget.inspect(packet)
            assert set(current['paths'])==set(self.plan['packetFilesBeforeTerminal'])
            assert current['normalBytes']+current['reservedBytes']<=64*1024**2



def run_sequence(ready,plan,record,adapter,check,writer=write):
    root=Path(plan['runRoot']);packet,proof=root/'packet',root/'proof'
    handles=[];jobs=[];receipts=[];started=time.monotonic()
    result=dict(status='HOLD',primaryFailure=None,purpose=PURPOSE,runtimeAuthorization=False)
    try:
        for name in JOBS:
            check()
            for receipt in receipts:require_native_release(receipt)
            handle=dict(job=None,private=None,path=paths(plan,name)['receipt']);handles.append(handle)
            jobs.append(dict(path=handle['path'],name=name));writer(proof/'attempts.json',jobs)
            receipt=adapter.run(dict(id=name,kind='native189'),handle);receipts.append(receipt)
            result['primaryFailure']=receipt.get('primaryFailure') or receipt.get('cleanupFailure') or next(iter(receipt.get('persistenceFailures',[])),None)
            writer(proof/'returned-receipts.json',receipts);require_native_release(receipt)
            assert receipt['name']==name
            writer(proof/'sequence-state.json',dict(completed=[r['name'] for r in receipts]))
        result['inspectionObservations']=adapter.inspectionObservations={}
        adapter.inspect_native();check()
        result['status']='NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT'
    except BaseException as error:
        result['dispatchFailure']=error_receipt(error)
        receipt=handles[-1].get('receipt',{}) if handles else {}
        if result['primaryFailure'] is None:
            result['primaryFailure']=receipt.get('primaryFailure') or receipt.get('cleanupFailure') or next(iter(receipt.get('persistenceFailures',[])),None) or result['dispatchFailure']
    finally:persist_terminal_summary(result,handles,adapter.audit,jobs,proof,packet,started)
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--grant');args=parser.parse_args()
    ready,plan=load(READY),load(PLAN)
    if not args.execute:
        caller.verify(ready);check_plan(plan)
        print(json.dumps(dict(status='SOURCE_ONLY_NATIVE189_DISABLED',plannedJobs=2,nativeJobs=0)));return 0
    record=consume(ready,plan,args.grant)
    adapter=NativeAdapter(ready,plan,record)
    result=run_sequence(ready,plan,record,adapter,lambda:check_current(ready,plan,record))
    caller.emit_result(result)
    return 0 if result['status']=='NATIVE189_CHECKS_PASSED_AWAITING_PARENT_EXIT' else 1

if __name__=='__main__':raise SystemExit(main())
