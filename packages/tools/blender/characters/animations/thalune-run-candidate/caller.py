"""Sequential five-job candidate. Default entry verifies source and launches nothing."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import argparse
import importlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import time
import contract
from inventory_boundary import guarded_call, tree_bytes
from admission_json import snapshot, read
import packet_budget as budget
from inspector import sha, write, error_receipt, inspect_capture
from release_accounting import observe_executables, persist_terminal_summary, delivery_failure

HERE = contract.HERE
READY = HERE/'readiness.json'

def require_release(receipt):
    assert receipt['primaryFailure'] is None and receipt['cleanupFailure'] is None
    assert not receipt.get('persistenceFailures')
    terminal = receipt['terminal']
    assert terminal['registrationAbsent'] is True and terminal['scratchAndTmpAbsent'] is True
    assert terminal['kernel']['live'] == 0 and terminal['kernel']['coalition_absent'] is True

def verify(ready):
    contract.verify_structure(ready)
    assert ready['runtimeAuthorization'] is False and ready['nativeFixtureAuthorization'] is False
    assert ready['root'] == str(contract.ROOT) and ready['preparationRoot'] == str(HERE)
    assert ready['packetRoot'] == str(HERE/'future-attempt/packet')
    assert ready['proofRoot'] == str(HERE/'future-attempt/proof')
    assert ready['helperDirectory'] == str(HERE/'retained-station')
    for row in [*ready['bindings'], *ready['softwareBindings']]:
        assert Path(row['path']).is_file() and sha(row['path']) == row['sha256'], 'Source drift: '+row['path']
    index_snapshot = snapshot(HERE/'candidate-index.json')
    index = index_snapshot['value']
    assert index['runtimeAuthorization'] is False
    for row in index['files']:
        assert sha(HERE/row['path']) == row['sha256'], 'Candidate drift: '+row['path']
    return dict(status='PASS_SOURCE_ONLY_RUNTIME_DISABLED', motionFrames=378, stills=8,
                plannedJobs=5, runtimeJobs=0, runtimeAuthorization=False)

def verify_runtime(ready):
    ready_snapshot=snapshot(READY)
    assert ready_snapshot['value']==ready,'Cached readiness differs from admitted snapshot'
    assert ready['runtimeAuthorization'] is True, 'SOURCE_ONLY_RUNTIME_DISABLED'
    contract.verify_structure(ready)
    assert ready['root'] == str(contract.ROOT) and ready['preparationRoot'] == str(HERE)
    assert ready['helperDirectory'] == str(HERE/'retained-station')
    assert ready['packetRoot'] == str(HERE/'future-attempt/packet') and ready['proofRoot'] == str(HERE/'future-attempt/proof')
    assert os.environ['PATH'] == ready['pathEnvironment']
    assert str(Path(sys.executable).resolve()) == ready['rgbPrimary']['python']
    index_snapshot = snapshot(HERE/'candidate-index.json')
    index = index_snapshot['value']
    for row in index['files']:
        digest=ready_snapshot['sha256'] if HERE/row['path']==READY else sha(HERE/row['path'])
        assert digest == row['sha256'], 'Candidate drift: '+row['path']
    for row in [*ready['bindings'], *ready['softwareBindings']]:
        assert sha(row['path']) == row['sha256'], 'Source drift: '+row['path']
    for name, expected in ready['process_binary_sha256'].items():
        assert str(Path(name).resolve(strict=True)) == name and sha(name) == expected
    for file, identity in ready['assetIdentities'].items():
        assert sha(contract.ROOT/file) == identity['sha256'], 'Runtime asset is unhydrated or changed: '+file
    assert ready['resolver'] == ready['browser'] and Path(ready['tsxImport']).is_file()
    assert ready['browser']['selectedExecutable']['path'] in ready['process_binary_sha256']
    for name in [ready['node'], ready['rgbPrimary']['python'], ready['rgbPrimary']['ffmpeg'], ready['rgbPrimary']['ffprobe'], '/usr/bin/caffeinate']:
        assert name in ready['process_binary_sha256']
    from native189 import retained_inventory
    from resource_admission import reserve
    plan_path=HERE/'native189-plan.json'
    expected=next(r['sha256'] for r in ready['bindings'] if r['path']==str(plan_path))
    plan=read(plan_path,expected)
    reserve(plan,retained_inventory(plan))
    # This is a fresh observation on each dispatch, never the retained ledger's old free-space snapshot.
    assert shutil.disk_usage(HERE).free >= ready['storage']['totalIncrementalCeiling'], 'Current full retained-copy disk admission refused'
    return dict(ready=ready_snapshot,index=index_snapshot)

def consume(ready, grant_path):
    admitted=verify_runtime(ready)  # Disabled candidates fail before reading a grant or allocating output.
    assert Path(grant_path).resolve() == HERE/'grant.json'
    grant_snapshot=snapshot(grant_path);grant=grant_snapshot['value']
    assert grant['parentGpuGo'] is True and grant['authorizationId']
    assert grant['purpose'] == ready['purpose'] and grant['attemptId'] == ready['attemptId']
    assert grant['readinessSha256']==admitted['ready']['sha256'] and grant['combinedCandidateSha256']==admitted['index']['sha256']
    assert grant['jobIds'] == [j['id'] for j in ready['jobs']] and grant['motionFrames'] == 378 and grant['stills'] == 8
    record = dict(authorizationId=grant['authorizationId'], attemptId=ready['attemptId'],
                  readinessSha256=admitted['ready']['sha256'],combinedCandidateSha256=admitted['index']['sha256'],grantSha256=grant_snapshot['sha256'],grantObservation=grant)
    # Exclusive consumption survives interruption; never retry into this namespace.
    with (HERE/'consumed-attempt.json').open('x') as stream: json.dump(record, stream)
    attempt = HERE/'future-attempt'
    attempt.mkdir(mode=0o700)
    for part in ['packet', 'proof']: (attempt/part).mkdir()
    for part in ['captures', 'inspections']: (Path(ready['packetRoot'])/part).mkdir()
    return record

def run_sequence(ready, adapter, packet, proof, check=lambda: None, writer=write):
    """The actual dispatch/inspection/accounting path accepts inert test adapters."""
    contract.verify_structure(ready)
    packet, proof = Path(packet), Path(proof)
    handles, jobs, receipts = [], [], {}
    started = time.monotonic()
    result = dict(status='HOLD', primaryFailure=None, runtimeAuthorization=ready['runtimeAuthorization'])
    try:
        for definition in ready['jobs']:
            check()
            if definition['kind'] == 'validator':
                for name in contract.CAPTURE_IDS:
                    require_release(receipts[name])
            paths = contract.paths(packet, proof, definition)
            handle = dict(job=None, private=None, path=paths['receipt'])
            record = dict(path=paths['receipt'], name=definition['id'])
            handles.append(handle)
            jobs.append(record)  # Before mkdir, private allocation, __init__, or start.
            writer(proof/'attempts.json', jobs)
            receipt = adapter.run(definition, handle)
            receipts[definition['id']] = receipt
            result['primaryFailure'] = (receipt.get('primaryFailure') or receipt.get('cleanupFailure') or
                                        next(iter(receipt.get('persistenceFailures', [])), None))
            writer(proof/'returned-receipts.json', receipts)
            require_release(receipt)
            assert receipt['name'] == definition['id']
            if definition['kind'] == 'stills':
                stage = next(s for s in ready['stages'] if s['id'] == definition['capture'])
                result['stills'] = adapter.inspect(stage, paths['capture'], ready)
                assert result['stills']['accepted'] is True
            elif definition['kind'] == 'validator':
                stage = next(s for s in ready['stages'] if s['id'] == definition['capture'])
                inspection = adapter.inspect(stage, paths['capture'], ready, paths['inspection'], receipt)
                result.setdefault('reels', []).append(inspection)
                assert inspection['accepted'] is True
            writer(proof/'sequence-state.json', dict(completed=list(receipts), result=result))
        adapter.inspect_packet(ready)
        result['status'] = 'CAPTURED_PENDING_VISUAL_REVIEW'
    except BaseException as error:
        result['dispatchFailure'] = error_receipt(error)
        receipt = handles[-1].get('receipt', {}) if handles else {}
        if result['primaryFailure'] is None:
            result['primaryFailure'] = (receipt.get('primaryFailure') or receipt.get('cleanupFailure') or
                                       next(iter(receipt.get('persistenceFailures', [])), None) or result['dispatchFailure'])
    finally:
        persist_terminal_summary(result, handles, adapter.audit, jobs, proof, packet, started)
    return result

def start_observed(job, receipt):
    """Observe the immutable helper's actual bootstrap result before its write."""
    start=job.start;namespace=start.__func__.__globals__;original=namespace.get('subprocess')
    if original is None:return start()  # Inert test jobs may have no command port.
    expected=['/bin/launchctl','bootstrap',f'gui/{os.getuid()}',str(job.scratch/'job.plist')]
    class ObservedPort:
        def __getattr__(self,key):return getattr(original,key)
        def run(self,argv,*args,**kwargs):
            if argv[:2]!=['/bin/launchctl','bootstrap']:return original.run(argv,*args,**kwargs)
            assert argv==expected and not receipt.get('bootstrapObservations'),'Unexpected/repeated bootstrap'
            event=dict(argv=list(argv),registrationUncertain=True)
            receipt['bootstrapObservations']=[event]
            try:
                result=original.run(argv,*args,**kwargs)
                event['result']=json.loads(json.dumps(vars(result),default=str))
                return result
            except BaseException as error:
                event['failure']=error_receipt(error);raise
    try:
        namespace['subprocess']=ObservedPort()
        return start()
    finally:
        namespace['subprocess']=original
        receipt['bootstrapPortRestored']=True


class StationAdapter:
    def __init__(self, ready, grant):
        assert ready['runtimeAuthorization'] is True, 'Source candidate: runtime disabled'
        verify_runtime(ready)
        self.ready, self.grant = ready, grant
        sys.path.insert(0, ready['helperDirectory'])
        self.core = importlib.import_module('round4_job_boundary')
        self.temp = importlib.import_module('run_round4_browser_proof')
        self.support = importlib.import_module('run_round4_remaining8')
        self.resourceControls = True
        self.cacheLease = None


    def job_paths(self, definition):
        return contract.paths(self.ready['packetRoot'], self.ready['proofRoot'], definition)

    def prepare(self, definition, out, paths, receipt):
        ready = self.ready
        if getattr(self, 'resourceControls', False) and definition['kind'] != 'validator':
            from resource_admission import CacheLease, open_owners
            plan_path=HERE/'native189-plan.json'
            plan=read(plan_path,next(r['sha256'] for r in ready['bindings'] if r['path']==str(plan_path)))
            observations = receipt.setdefault('cacheObservations', [])
            controller = self.core.identity(os.getpid())
            def owners(paths, checkout):
                facts = open_owners(paths, checkout, self.core.identity)
                facts['controllerIdentity'] = controller
                from release_accounting import identity_key
                facts['observedOwners'] = facts['owners']
                facts['owners'] = [r for r in facts['owners'] if identity_key(r['after']) != identity_key(controller)]
                return facts
            if self.cacheLease is None:
                self.cacheLease = CacheLease(plan['viteCachePaths'], ready['root'], plan['cacheLeasePath'],
                                             out/'vite-cache-retention', observations, owners)
            else:
                self.cacheLease.archive = out/'vite-cache-retention'
                self.cacheLease.observations = observations
            self.cacheLease.acquire()
        if definition['kind'] != 'validator': Path(paths['raw']).mkdir()
        if definition['kind'] == 'validator':
            config = dict(**ready['rgbPrimary'], schema=contract.SCHEMA, frameCount=contract.FRAMES,
                          video=paths['capture']+'/primary.mp4', frameMap=paths['capture']+'/frame-map.json',
                          helperDirectory=ready['helperDirectory'], output=paths['inspection'],
                          packetRoot=ready['packetRoot'], nativeRawDirectory=paths['raw'])
            write(out/'validate-config.json', config)
            argv = [ready['rgbPrimary']['python'], str(HERE/'rgb-primary.py'), 'validate-primary', str(out/'validate-config.json')]
        else:
            claim = out/'launch-claim'
            claim.mkdir()
            write(claim/'admission.json', dict(stage=definition['id'], attemptId=ready['attemptId'],
                                             authorizationId=self.grant['authorizationId'], readinessSha256=sha(READY)))
            argv = [ready['node'], '--import', ready['tsxImport'], str(HERE/'entry.mjs'), str(READY), definition['id'], paths['capture']]
        return argv

    def record_worker_result(self, definition, paths, receipt):
        pass

    def stage_observer(self, definition, job, private):
        return None if definition['kind']=='validator' else self.support.StageReceipts(job, self.ready, private)

    def resource_observer(self, job, receipt):
        if not getattr(self, 'resourceControls', False): return None
        from resource_admission import CohortRSS
        guard = CohortRSS(self.core, receipt.setdefault('rssObservations', []))
        def observe():
            before = len(guard.observations)
            guard.observe(job)
            if len(guard.observations) != before and self.cacheLease is not None and self.cacheLease.active:
                self.cacheLease.check(job.members())
        return observe

    def after_release(self, definition, receipt):
        if getattr(self, 'cacheLease', None) is not None and self.cacheLease.active:
            return self.cacheLease.finish()
        return None

    def run(self, definition, handle):
        ready = self.ready
        paths = self.job_paths(definition)
        out = Path(paths['receipt']).parent
        receipt = dict(name=definition['id'], primaryFailure=None, cleanupFailure=None,
                       persistenceFailures=[], terminal=None)
        handle['receipt'] = receipt  # Available to terminal accounting even if no receipt write succeeds.
        job = private = admission = None
        primary_error = None
        def persist():
            try: write(paths['receipt'], receipt)
            except BaseException as error:
                receipt['persistenceFailures'].append(error_receipt(error))
                raise
        try:
            out.mkdir(parents=True, exist_ok=False)
            persist()
            started = time.monotonic()
            with self.core.deadline(ready['captureSeconds']):
                argv = self.prepare(definition, out, paths, receipt)
                receipt['argv'] = argv
                receipt['phase'] = 'allocation'; persist()
                private, admission = self.temp.create_private_tmp(out/'private-tmp-admission.json')
                handle['private'] = private
                receipt['privateTmp'] = dict(path=str(private), admission=admission)
                receipt['phase'] = 'constructor'; persist()
                job = self.core.StationJob.__new__(self.core.StationJob)
                handle['job'] = job
                self.core.StationJob.__init__(job, out/'owned-job', argv, ready['root'], capture_seconds=ready['captureSeconds'],
                    env=dict(PATH=ready['pathEnvironment'], TMPDIR=str(private)+os.sep, SMOKE_GL='metal', DEBUG='pw:browser',
                             PYTHONDONTWRITEBYTECODE='1', T02_PILOT_READY_SHA=sha(READY), T02_PILOT_ATTEMPT=ready['attemptId'],
                             T02_PILOT_STAGE=definition['id'], T02_PILOT_GRANT=self.grant['authorizationId']))
                job.state.update(scope=ready['purpose'], stage=definition['id'], readiness_sha256=sha(READY)); job.save()
                receipt['phase'] = 'start'; persist(); start_observed(job, receipt)
                admitted, events = {}, []
                receipt.update(actualExecutables=admitted, observerEvents=events)
                observer = self.stage_observer(definition, job, private)
                resource_observer = self.resource_observer(job, receipt)
                seen_errors={}
                def retain_observer(error, phase):
                    nonlocal primary_error
                    if id(error) in seen_errors:return
                    failure=error_receipt(error);seen_errors[id(error)]=(error,failure)
                    receipt.setdefault('observationFailures',[]).append(dict(phase=phase,failure=failure))
                    if phase=='resource':receipt.setdefault('resourceFailures',[]).append(failure)
                    if receipt['primaryFailure'] is None:
                        primary_error=error;receipt['primaryFailure']=failure
                    elif error is not primary_error:receipt.setdefault('secondaryFailures',[]).append(failure)
                def observe_stage():
                    # Observe the raw helper callback/save exceptions before its own catch.
                    ports={};command_namespace=None;command_port=None
                    def wrap(original,phase):
                        def call(*args,**kwargs):
                            try:return original(*args,**kwargs)
                            except BaseException as error:retain_observer(error,phase);raise
                        return call
                    try:
                        implementation=getattr(observer,'_observe',None)
                        namespace=getattr(getattr(implementation,'__func__',implementation),'__globals__',{})
                        command=namespace.get('current_commands')
                        if command is not None:
                            command_namespace=command.__globals__;command_port=command_namespace['subprocess']
                            class ObservedCommand:
                                def __getattr__(self,key):return getattr(command_port,key)
                                def run(self,argv,*args,**kwargs):
                                    event={'argv':list(argv)};receipt.setdefault('stageCommandObservations',[]).append(event)
                                    try:
                                        value=command_port.run(argv,*args,**kwargs)
                                        event['result']=vars(value).copy()
                                        event['result']=json.loads(json.dumps(event['result'],default=str))
                                        return value
                                    except BaseException as error:
                                        event['failure']=error_receipt(error);retain_observer(error,'stage-command');raise
                            command_namespace['subprocess']=ObservedCommand()
                        for name in ['_observe','_structured_save']:
                            if hasattr(observer,name):
                                ports[name]=(name in vars(observer),getattr(observer,name))
                                setattr(observer,name,wrap(getattr(observer,name),'stage'+('-persistence' if name=='_structured_save' else '')))
                        observer.observe()
                    finally:
                        if command_namespace is not None:command_namespace['subprocess']=command_port
                        for name,(existed,original) in ports.items():
                            if existed:setattr(observer,name,original)
                            else:delattr(observer,name)
                def observe():
                    phase='resource'
                    try:
                        if resource_observer: resource_observer()
                        phase='executable'
                        observe_executables(job, ready['process_binary_sha256'], admitted, events,
                                            self.core.identity, self.temp.executable_path, on_event=persist,
                                            on_failure=lambda error:retain_observer(error,'executable'))
                        phase='stage'
                        if observer:observe_stage()
                    except BaseException as error:
                        retain_observer(error,phase)
                        raise
                if resource_observer: observe()
                receipt['outcome'] = job.wait(max(.001, ready['captureSeconds']-(time.monotonic()-started)), observe)
                receipt['exits'] = dict(job.state['exits']); persist()
                self.record_worker_result(definition, paths, receipt)
                assert receipt['outcome'] == 'completed' and receipt['exits'].get('capture') == 0
                if observer: observer.require_browser()
        except BaseException as error:
            if receipt['primaryFailure'] is None: receipt['primaryFailure'] = error_receipt(error)
            elif error is not primary_error:
                receipt.setdefault('secondaryFailures', []).append(error_receipt(error))
        finally:
            receipt['ownedAllocation'] = {key: str(value) for key in ['out', 'scratch', 'target', 'coalition_id', 'registered']
                                         if (value := getattr(job, key, None)) is not None}
            try:
                with self.core.deadline(ready['cleanupSeconds']):
                    assert job is not None and getattr(job, 'coalition_id', None), 'Retain allocation: no durable owned boundary'
                    drained = job.drain(ready['cleanupSeconds']); receipt['drain'] = drained
                    receipt['drainMembers'] = self.core.coalition_members(job.coalition_id)
                    receipt['drainKernel'] = self.core.kernel_tasks(job.coalition_id)
                    assert drained['drained'] and drained['clean'], 'Owned drain did not prove clean release'
                    assert not receipt['drainMembers'], 'Coalition members remain after drain'
                    assert receipt['drainKernel']['live'] == 0, 'Kernel tasks remain after drain'
                    inventory_observations=receipt.setdefault('inventoryObservations',[])
                    guarded_call(job.archive,inventory_observations,profile_namespace=private, profile_prefixes=('playwright_chromiumdev_profile-',))
                    profiles = read(job.out/'profile_release.json'); receipt['profiles'] = profiles
                    assert profiles['all_absent']
                    cache = guarded_call(self.temp.preserve_private_tmp,inventory_observations,private, admission, job.out/'preserved-private-tmp', job=job)
                    receipt['cache'] = cache
                    assert cache['all_bytes_preserved'] and cache['namespace_removed']
                    receipt['taskRelease'] = self.after_release(definition, receipt)
                    audit = self.audit(handle)
                    receipt['terminal'] = dict(kernel=audit['kernel'], registrationAbsent=True, scratchAndTmpAbsent=True, audit=audit)
                    receipt['archiveInventory']={}
                    size = tree_bytes(out,receipt['archiveInventory'])
                    receipt['archiveBytesObservedAfterRelease'] = size
                    assert size <= ready['limits']['maxArchiveStageBytes'], 'Archive acceptance cap exceeded; retain all bytes'
            except BaseException as error: receipt['cleanupFailure'] = error_receipt(error)
            receipt['releaseAudits'] = list(handle.get('auditObservations', []))
            try: persist()
            except BaseException:
                pass  # persist recorded the write error; return the complete receipt via the registered handle.
        return receipt

    def audit(self, handle):
        job, private = handle['job'], handle['private']
        item = dict(attemptPath=handle['path'], releaseProved=False)
        handle.setdefault('auditObservations', []).append(item)
        try:
            assert job is not None and getattr(job, 'coalition_id', None) and private is not None, 'Unprovable attempted allocation'
            item['kernel'] = self.core.kernel_tasks(job.coalition_id)
            item['members'] = self.core.coalition_members(job.coalition_id)
            item['births'] = []
            for pid, old in job.known.items():
                birth = dict(pid=int(pid), recorded=old)
                item['births'].append(birth)
                birth['current'] = self.core.identity(int(pid))
            argv = ['/bin/launchctl', 'print', job.target]
            item['registrationArgv'] = argv
            registration = subprocess.run(argv, capture_output=True, text=True, timeout=3)
            item['registrationExit'] = registration.returncode
            item['registrationStdout'] = registration.stdout
            item['registrationStderr'] = registration.stderr
            item['scratchAbsent'] = not job.scratch.exists()
            item['privateTmpAbsent'] = not private.exists()
            assert item['kernel']['live'] == 0, 'Kernel coalition has live tasks'
            assert item['kernel']['coalition_absent'] is True, 'Kernel coalition is still present'
            assert not item['members'], 'Coalition members remain'
            assert item['registrationExit'] != 0, 'Launch registration is still present'
            assert item['scratchAbsent'], 'Owned scratch namespace remains'
            assert item['privateTmpAbsent'], 'Private TMP namespace remains'
            assert all(b['current'] is None or b['current']['birth'] != b['recorded']['birth'] for b in item['births']), 'Recorded process birth remains live'
            item['releaseProved'] = True
        except BaseException as error:
            item['failure'] = error_receipt(error)
            raise
        return item

    inspect = staticmethod(inspect_capture)

    @staticmethod
    def inspect_packet(ready):
        packet = Path(ready['packetRoot'])
        current = budget.inspect(packet)
        allowed = set()
        for stage in ready['stages']:
            base = packet/'captures'/stage['id']
            index = json.loads((base/'artifact-index.json').read_text())
            allowed.update(str((base/row['path']).relative_to(packet)) for row in index['files'])
            allowed.add(str((base/'artifact-index.json').relative_to(packet)))
        for job in ready['jobs'][3:]:
            base = 'inspections/'+job['id']+'/'
            allowed.update(base+name+suffix for name in ['probe', 'rgb', 'rgba'] for suffix in ['.stdout', '.stderr', '-command.json'])
            allowed.add(base+'validation.json')
        assert set(current['paths']) == allowed, 'Missing or extra aggregate artifacts'

class TerminalDeliveryError(RuntimeError):
    def __init__(self,result):
        super().__init__('Terminal output streams failed; complete evidence is attached as result')
        self.result=result

def emit_result(result):
    # Each existing stream is tried once. If neither accepts output, the caller still receives the evidence.
    for name,stream in [('stdout',sys.stdout),('stderr',sys.stderr)]:
        result['terminalDelivery'][name]={'status':'attempting'}
        try:
            text=json.dumps(result,indent=2)+'\n'
            if stream.write(text)!=len(text):raise OSError('Incomplete terminal output write')
            stream.flush()
            result['terminalDelivery'][name]['status']='written'
            return
        except BaseException as error:delivery_failure(result,name,error)
    raise TerminalDeliveryError(result)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--preflight', action='store_true')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--grant')
    args = parser.parse_args()
    ready = read(READY)
    if args.execute:
        record = consume(ready, args.grant)
        adapter = StationAdapter(ready, record)
        result = run_sequence(ready, adapter, ready['packetRoot'], ready['proofRoot'], check=lambda: verify_runtime(ready))
        emit_result(result)
        return 0 if result['status'] == 'CAPTURED_PENDING_VISUAL_REVIEW' else 1
    print(json.dumps(verify(ready), indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
