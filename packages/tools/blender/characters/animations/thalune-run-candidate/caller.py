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
import packet_budget as budget
from inspector import sha, write, error_receipt, inspect_capture
from release_accounting import observe_executables, persist_terminal_summary

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
    index = json.loads((HERE/'candidate-index.json').read_text())
    assert index['runtimeAuthorization'] is False
    for row in index['files']:
        assert sha(HERE/row['path']) == row['sha256'], 'Candidate drift: '+row['path']
    return dict(status='PASS_SOURCE_ONLY_RUNTIME_DISABLED', motionFrames=378, stills=8,
                plannedJobs=5, runtimeJobs=0, runtimeAuthorization=False)

def verify_runtime(ready):
    assert ready['runtimeAuthorization'] is True, 'SOURCE_ONLY_RUNTIME_DISABLED'
    contract.verify_structure(ready)
    assert ready['root'] == str(contract.ROOT) and ready['preparationRoot'] == str(HERE)
    assert ready['helperDirectory'] == str(HERE/'retained-station')
    assert ready['packetRoot'] == str(HERE/'future-attempt/packet') and ready['proofRoot'] == str(HERE/'future-attempt/proof')
    assert os.environ['PATH'] == ready['pathEnvironment']
    assert str(Path(sys.executable).resolve()) == ready['rgbPrimary']['python']
    index = json.loads((HERE/'candidate-index.json').read_text())
    for row in index['files']:
        assert sha(HERE/row['path']) == row['sha256'], 'Candidate drift: '+row['path']
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
    # This is a fresh observation on each dispatch, never the retained ledger's old free-space snapshot.
    assert shutil.disk_usage(HERE).free >= ready['storage']['totalIncrementalCeiling'], 'Current full retained-copy disk admission refused'

def consume(ready, grant_path):
    verify_runtime(ready)  # Disabled candidates fail before reading a grant or allocating output.
    assert Path(grant_path).resolve() == HERE/'grant.json'
    grant = json.loads(Path(grant_path).read_text())
    assert grant['parentGpuGo'] is True and grant['authorizationId']
    assert grant['purpose'] == ready['purpose'] and grant['attemptId'] == ready['attemptId']
    assert grant['readinessSha256'] == sha(READY) and grant['combinedCandidateSha256'] == sha(HERE/'candidate-index.json')
    assert grant['jobIds'] == [j['id'] for j in ready['jobs']] and grant['motionFrames'] == 378 and grant['stills'] == 8
    record = dict(authorizationId=grant['authorizationId'], attemptId=ready['attemptId'],
                  readinessSha256=sha(READY), combinedCandidateSha256=sha(HERE/'candidate-index.json'), grantSha256=sha(grant_path))
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
            if receipt.get('primaryFailure') is not None: result['primaryFailure'] = receipt['primaryFailure']
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
        if result['primaryFailure'] is None: result['primaryFailure'] = error_receipt(error)
    finally:
        persist_terminal_summary(result, handles, adapter.audit, jobs, proof, packet, started)
    return result

class StationAdapter:
    def __init__(self, ready, grant):
        assert ready['runtimeAuthorization'] is True, 'Source candidate: runtime disabled'
        verify_runtime(ready)
        self.ready, self.grant = ready, grant
        sys.path.insert(0, ready['helperDirectory'])
        self.core = importlib.import_module('round4_job_boundary')
        self.temp = importlib.import_module('run_round4_browser_proof')
        self.support = importlib.import_module('run_round4_remaining8')

    def run(self, definition, handle):
        ready = self.ready
        paths = contract.paths(ready['packetRoot'], ready['proofRoot'], definition)
        out = Path(paths['receipt']).parent
        receipt = dict(name=definition['id'], primaryFailure=None, cleanupFailure=None,
                       persistenceFailures=[], terminal=None)
        job = private = admission = None
        def persist():
            try: write(paths['receipt'], receipt)
            except BaseException as error:
                receipt['persistenceFailures'].append(error_receipt(error))
                raise
        try:
            out.mkdir(parents=True, exist_ok=False)
            if definition['kind'] != 'validator': Path(paths['raw']).mkdir()
            persist()
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
            receipt['argv'] = argv
            started = time.monotonic()
            with self.core.deadline(ready['captureSeconds']):
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
                receipt['phase'] = 'start'; persist(); job.start()
                admitted, events = {}, []
                receipt.update(actualExecutables=admitted, observerEvents=events)
                observer = None if definition['kind'] == 'validator' else self.support.StageReceipts(job, ready, private)
                def observe():
                    observe_executables(job, ready['process_binary_sha256'], admitted, events,
                                        self.core.identity, self.temp.executable_path, on_event=persist)
                    if observer: observer.observe()
                receipt['outcome'] = job.wait(max(.001, ready['captureSeconds']-(time.monotonic()-started)), observe)
                receipt['exits'] = dict(job.state['exits']); persist()
                assert receipt['outcome'] == 'completed' and receipt['exits'].get('capture') == 0
                if observer: observer.require_browser()
        except BaseException as error:
            receipt['primaryFailure'] = error_receipt(error)
        finally:
            receipt['ownedAllocation'] = {key: str(value) for key in ['out', 'scratch', 'target', 'coalition_id', 'registered']
                                         if (value := getattr(job, key, None)) is not None}
            try:
                with self.core.deadline(ready['cleanupSeconds']):
                    assert job is not None and getattr(job, 'coalition_id', None), 'Retain allocation: no durable owned boundary'
                    drained = job.drain(ready['cleanupSeconds']); receipt['drain'] = drained
                    assert drained['drained'] and drained['clean'] and not self.core.coalition_members(job.coalition_id)
                    assert self.core.kernel_tasks(job.coalition_id)['live'] == 0
                    job.archive(profile_namespace=private, profile_prefixes=('playwright_chromiumdev_profile-',))
                    profiles = json.loads((job.out/'profile_release.json').read_text()); receipt['profiles'] = profiles
                    assert profiles['all_absent']
                    cache = self.temp.preserve_private_tmp(private, admission, job.out/'preserved-private-tmp', job=job)
                    receipt['cache'] = cache
                    assert cache['all_bytes_preserved'] and cache['namespace_removed']
                    audit = self.audit(handle)
                    receipt['terminal'] = dict(kernel=audit['kernel'], registrationAbsent=True, scratchAndTmpAbsent=True, audit=audit)
                    size = sum(p.stat().st_size for p in out.rglob('*') if p.is_file())
                    receipt['archiveBytesObservedAfterRelease'] = size
                    assert size <= ready['limits']['maxArchiveStageBytes'], 'Archive acceptance cap exceeded; retain all bytes'
            except BaseException as error: receipt['cleanupFailure'] = error_receipt(error)
            persist()
        return receipt

    def audit(self, handle):
        job, private = handle['job'], handle['private']
        assert job is not None and getattr(job, 'coalition_id', None) and private is not None, 'Unprovable attempted allocation'
        kernel = self.core.kernel_tasks(job.coalition_id)
        members = self.core.coalition_members(job.coalition_id)
        births = [dict(pid=int(pid), recorded=old, current=self.core.identity(int(pid))) for pid, old in job.known.items()]
        registration = subprocess.run(['/bin/launchctl', 'print', job.target], capture_output=True, text=True, timeout=3)
        item = dict(attemptPath=handle['path'], kernel=kernel, members=members, births=births,
                    registrationExit=registration.returncode, scratchAbsent=not job.scratch.exists(), privateTmpAbsent=not private.exists())
        assert kernel['live'] == 0 and kernel['coalition_absent'] and not members and registration.returncode != 0
        assert item['scratchAbsent'] and item['privateTmpAbsent']
        assert all(b['current'] is None or b['current']['birth'] != b['recorded']['birth'] for b in births)
        item['releaseProved'] = True
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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--preflight', action='store_true')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--grant')
    args = parser.parse_args()
    ready = json.loads(READY.read_text())
    if args.execute:
        record = consume(ready, args.grant)
        adapter = StationAdapter(ready, record)
        result = run_sequence(ready, adapter, ready['packetRoot'], ready['proofRoot'], check=lambda: verify_runtime(ready))
        print(json.dumps(result, indent=2))
        return 0 if result['status'] == 'CAPTURED_PENDING_VISUAL_REVIEW' else 1
    print(json.dumps(verify(ready), indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
