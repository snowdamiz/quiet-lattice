"""One separately granted viewmodel unit. No retries or automatic chaining."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import stat
import shutil
import subprocess
import sys

from boundary import (CONSUMPTION_SCHEMA, RESULT_SCHEMA, FAILURE_SUMMARY_CAP, MIB, canonical, deadline, encoded, exclusive_bytes, exclusive_json, failure_summary, git, json_snapshot,
                      output_manifest, persist, require, snapshot, validate_inventory, verify_worktree)
import bindings

HERE = Path(__file__).resolve().parent
RUNTIME_ENABLED = True


def plan():
    return validate_inventory(json_snapshot(HERE / 'inventory.json')[0])


def terminal_paths(paths):
    return [Path(paths['evidence']) / 'result.json', Path(paths['consumption'] + '.fallback.json'),
            Path(paths['consumption'] + '.failure-summary.json')]


def prepare():
    inventory = plan()
    root = bindings.ROOT
    evidence = Path('/private/tmp/p1-e05-t03-viewmodel-packet-nativefix-ydkbvouf')
    ready_path = str(evidence.with_name(evidence.name + '-readiness.json'))
    paths = {}
    for spec in inventory['units']:
        unit = spec['id']
        paths[unit] = {'ready': ready_path, 'grant': str(evidence.with_name(evidence.name + '-' + unit + '.grant.json')),
            'consumption': str(evidence.with_name(evidence.name + '-' + unit + '.consumed.json')),
            'evidence': str(evidence / unit), 'output': str(root / 'assets/renders/review/viewmodel-packet-nativefix-ydkbvouf' / unit)}
    canonical(evidence, absent=True)
    canonical(root / 'assets/renders/review/viewmodel-packet-nativefix-ydkbvouf', absent=True)
    for row in paths.values():
        for path in [*row.values(), *terminal_paths(row)]:
            canonical(path, absent=True)
    pinned = bindings.discover()
    return {'version': 1, 'runtimeEnabled': RUNTIME_ENABLED, 'entryEnabled': inventory['entryEnabled'],
            'executionStatus': 'ENABLED_AWAITING_PARENT_GRANT', 'nativeQualified': False,
            'inventorySha256': json_snapshot(HERE / 'inventory.json')[1], 'paths': paths,
            'containers': {'evidence': str(evidence), 'output': str(root / 'assets/renders/review/viewmodel-packet-nativefix-ydkbvouf')},
            'bindings': pinned, 'cacheOwnerFreezeObservation': bindings.cache_owners(),
            'pythonSelfObservation': {'scope': 'CPU_SELF_PROCESS_ONLY', 'pid': os.getpid(), 'uid': os.getuid(),
                                      'launcher': pinned['python'], 'kernelExecutable': pinned['pythonKernel']},
            'limitsAreOSQuotas': False, 'allUnitsQualified': False}


def admit(ready_path, unit, grant_path, *, enabled=RUNTIME_ENABLED, verifier=bindings.verify):
    require(enabled, 'Viewmodel caller disabled')
    require(grant_path is not None, 'Missing parent grant')
    inventory = plan()
    require(inventory['runtimeEnabled'] is True and inventory['entryEnabled'] is True, 'Disabled inventory')
    ready, ready_hash = json_snapshot(ready_path)
    require(ready['runtimeEnabled'] is True and ready['entryEnabled'] is True, 'Disabled readiness')
    require(ready['inventorySha256'] == json_snapshot(HERE / 'inventory.json')[1], 'Inventory pin changed')
    units = inventory['units']
    index = next((i for i, s in enumerate(units) if s['id'] == unit), None)
    require(index is not None, 'Unknown unit')
    spec = units[index]
    paths = ready['paths'][unit]
    require(str(ready_path) == paths['ready'] and str(grant_path) == paths['grant'], 'Wrong admission paths')
    grant, grant_hash = json_snapshot(grant_path)
    require(grant.get('enabled') is True and grant.get('purpose') == 'P1-E05-T03-ONE-NATIVE-UNIT', 'Wrong/disabled grant')
    require(grant.get('unit') == unit and grant.get('readySha256') == ready_hash, 'Wrong grant unit/pin')
    require(type(grant.get('authorizationId')) is str and 16 <= len(grant['authorizationId']) <= 128, 'Authorization identity')
    require(type(grant.get('authorizedHead')) is str and len(grant['authorizedHead']) == 40, 'Source HEAD pin')
    root = canonical(ready['bindings']['root'])
    require(git(root, 'branch', '--show-current').decode().strip() == ready['bindings']['branch'], 'Wrong branch')
    require(type(grant.get('previous')) is list and len(grant['previous']) == index, 'Exact ordered predecessor chain required')
    previous = []
    previous_ids = set()
    for expected_spec, ref in zip(units[:index], grant['previous']):
        require(set(ref) == {'unit', 'callerExit', 'resultSha256', 'consumptionSha256'}, 'Completion schema')
        require(ref['unit'] == expected_spec['id'] and type(ref['callerExit']) is int and ref['callerExit'] == 0, 'Parent must observe caller exit 0')
        old_paths = ready['paths'][ref['unit']]
        result, _ = json_snapshot(Path(old_paths['evidence']) / 'result.json', cap=20 * MIB, expected=ref['resultSha256'])
        consumed, _ = json_snapshot(old_paths['consumption'], expected=ref['consumptionSha256'])
        # Hash, parse, schema, success, identity and manifest use this single bounded snapshot.
        require(result.get('schema') == RESULT_SCHEMA and consumed.get('schema') == CONSUMPTION_SCHEMA, 'Predecessor receipt schema')
        require(result.get('accepted') is False and result.get('checksPassed') is True and result.get('status') == 'AWAITING_CALLER_COMPLETION', 'Predecessor failed/provisional contract')
        require(result.get('primaryFailure') is None and result.get('secondaryFailures') == [] and result.get('persistenceErrors') == [] and result.get('released') is True, 'Failed predecessor')
        for obj in (result, consumed):
            require(obj.get('unit') == ref['unit'] and obj.get('sourceHead') == grant['authorizedHead'] and obj.get('readySha256') == ready_hash, 'Predecessor identity/pin')
        require(result['authorizationId'] == consumed['authorizationId'] and result['consumptionSha256'] == ref['consumptionSha256'], 'Predecessor consumption mismatch')
        require(result['output'] == old_paths['output'], 'Predecessor output path')
        for copy_name in ('decode-copy', 'verified-copy'):
            output_manifest(expected_spec, Path(old_paths['evidence']) / copy_name, result['outputManifest'])
        previous_ids.add(consumed['authorizationId'])
        previous.append((expected_spec, result))
    require(grant['authorizationId'] not in previous_ids, 'Reused authorization identity')
    for kind, name in ready['containers'].items():
        container = canonical(name, absent=index == 0)
        require(all(Path(ready['paths'][s['id']][kind]).parent == container for s in units), 'Container path mismatch')
        if index:
            require(container.is_dir() and sorted(p.name for p in container.iterdir()) == sorted(s['id'] for s in units[:index]), 'Container has unexpected entries')
    for future in units[index:]:
        p = ready['paths'][future['id']]
        for key in ('output', 'evidence', 'consumption'):
            canonical(p[key], absent=True)
        for path in terminal_paths(p):
            canonical(path, absent=True)
        if future['id'] != unit:
            canonical(p['grant'], absent=True)
    verify_worktree(root, grant['authorizedHead'], previous, ready['bindings']['ignoredInventorySha256'])
    owners = verifier(ready)
    free = shutil.disk_usage(root).free
    require(free >= spec['admission'], 'Observed free space below unit admission')
    return ready, spec, paths, {'schema': CONSUMPTION_SCHEMA, 'authorizationId': grant['authorizationId'], 'unit': unit,
        'sourceHead': grant['authorizedHead'], 'readySha256': ready_hash, 'grantSha256': grant_hash,
        'grantPath': str(grant_path), 'entryToken': secrets.token_hex(32), 'freeBytesAtAdmission': free,
        'admission': spec['admission'], 'cacheOwners': owners,
        'previousOutputs': [{'unit': old['id'], 'output': result['output'], 'outputManifest': result['outputManifest']} for old, result in previous]}


def copy_outputs(spec, source, destination, record, label):
    rows = output_manifest(spec, source)
    canonical(destination, absent=True).mkdir()
    record['ledger'].append({'operation': label, 'destination': str(destination), 'attemptedBytes': 0})
    ledger = record['ledger'][-1]
    for row in rows:
        from boundary import snapshot
        data, _ = snapshot(Path(source) / row['path'], row['bytes'], row['sha256'])
        ledger['attemptedBytes'] += len(data)
        require(ledger['attemptedBytes'] <= spec['outputCap'], 'Copy ceiling')
        with open(destination / row['path'], 'xb') as stream:
            stream.write(data)
    output_manifest(spec, destination, rows)
    return rows


def cache_inventory(paths, cap):
    """Admit one metadata-only tree before any cache content read."""
    require(type(cap) is int and cap >= 0, 'Invalid cache cap')
    total = 0
    trees = []
    for name in paths:
        root = canonical(name)
        tree = {'path': str(root), 'exists': root.exists(), 'directories': [], 'files': []}
        trees.append(tree)
        if not tree['exists']:
            continue
        root_stat = root.lstat()
        require(stat.S_ISDIR(root_stat.st_mode), 'Cache root is not a directory')
        tree['rootIdentity'] = [root_stat.st_dev, root_stat.st_ino]
        for leaf in sorted(root.rglob('*')):
            canonical(leaf)
            info = leaf.lstat()
            relative = str(leaf.relative_to(root))
            if stat.S_ISDIR(info.st_mode):
                tree['directories'].append({'path': relative, 'identity': [info.st_dev, info.st_ino]})
            else:
                require(stat.S_ISREG(info.st_mode), 'Unsupported cache entry')
                total += info.st_size
                require(total <= cap, 'Cache snapshot ceiling')
                tree['files'].append({'path': relative, 'bytes': info.st_size,
                                      'identity': [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns]})
    return {'bytes': total, 'trees': trees}


def cache_contents(inventory, cap, event, *, copy_to=None, expected=None):
    """Every content pass uses the admitted sizes and remaining aggregate allowance."""
    remaining = cap
    fingerprints = []
    for index, tree in enumerate(inventory['trees']):
        root = Path(tree['path'])
        target = copy_to / str(index) if copy_to is not None else None
        if target is not None and tree['exists']:
            target.mkdir()
            for row in tree['directories']:
                (target / row['path']).mkdir()
        rows = []
        for row in tree['files']:
            limit = min(row['bytes'], remaining)
            attempt = {'path': str(root / row['path']), 'cap': limit, 'bytesRead': None}
            event.setdefault('reads', []).append(attempt)
            known = expected[index]['files'].get(row['path']) if expected is not None else None
            data, digest = snapshot(root / row['path'], limit, known['sha256'] if known else None, identity=row['identity'])
            attempt['bytesRead'] = len(data)
            remaining -= len(data)
            if target is not None:
                event['attemptedBytes'] += len(data)
                require(event['attemptedBytes'] <= cap, 'Cache copy ceiling')
                with (target / row['path']).open('xb') as stream:
                    stream.write(data)
            rows.append((row['path'], {'bytes': len(data), 'sha256': digest}))
        fingerprints.append({'exists': tree['exists'], 'directories': [d['path'] for d in tree['directories']], 'files': dict(rows)})
    return fingerprints


def bounded_caches(paths, cap, event):
    admitted = cache_inventory(paths, cap)
    event['admitted'] = admitted
    event['fingerprints'] = cache_contents(admitted, cap, event)
    require(cache_inventory(paths, cap) == admitted, 'Cache inventory changed during read')
    return admitted['bytes']


def snapshot_caches(ready, evidence, record):
    with deadline(30):
        destination = evidence / 'cache-before'
        destination.mkdir()
        cap = 64 * MIB
        paths = ready['bindings']['generatedCaches']
        event = {'operation': 'cache-snapshot', 'destination': str(destination), 'attemptedBytes': 0}
        record['ledger'].append(event)
        admitted = cache_inventory(paths, cap)
        event['admitted'] = admitted
        # Hash the exact bytes being copied, not a second generic 512 MiB binding read.
        fingerprints = cache_contents(admitted, cap, event, copy_to=destination)
        event['fingerprints'] = fingerprints
        require(cache_inventory(paths, cap) == admitted, 'Cache inventory changed during snapshot')
        require(cache_contents(admitted, cap, event, expected=fingerprints) == fingerprints, 'Cache source changed after copy')
        require(cache_inventory(paths, cap) == admitted, 'Cache inventory changed during reconciliation')
        copied_paths = [str(destination / str(i)) for i in range(len(paths))]
        copied = cache_inventory(copied_paths, cap)
        require(cache_contents(copied, cap, event, expected=fingerprints) == fingerprints, 'Cache copy differs')
        require(cache_inventory(copied_paths, cap) == copied, 'Cache copy inventory changed')
        record['initialCacheBytes'] = admitted['bytes']


def decode(ready, spec, paths, record, frozen):
    manifest_path = Path(paths['evidence']) / 'output-manifest.json'
    exclusive_json(manifest_path, {'files': record['outputManifest']})
    argv = [ready['bindings']['decoderPython'], '-B', str(HERE / 'inspect_packet.py'), '--inventory', str(HERE / 'inventory.json'),
            '--unit', spec['id'], '--output', str(frozen), '--manifest', str(manifest_path)]
    env = {'PATH': ready['bindings']['path'], 'PYTHONPATH': ready['bindings']['decoderSite'], 'PYTHONDONTWRITEBYTECODE': '1'}
    # subprocess.run reaps its own CPU-only child on timeout; no decoder children.
    result = subprocess.run(argv, capture_output=True, env=env, timeout=45)
    record['decoder'] = {'argv': argv, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
    require(len(result.stdout) + len(result.stderr) <= 2 * MIB, 'Decoder metadata ceiling')
    require(result.returncode == 0, 'CPU decode/observation validation failed')
    record['inspection'] = json.loads(result.stdout)
    require(record['inspection'].get('valid') is True, 'Inspector did not qualify bytes')


def run_unit(ready, spec, paths, record, *, capture=None, decoder=decode, cache_copy=snapshot_caches, final_verify=bindings.verify):
    evidence = canonical(paths['evidence'], absent=True)
    record['ledger'] = []
    for label, destination in [('evidence', evidence), ('output', canonical(paths['output'], absent=True))]:
        missing = []
        current = destination
        while not current.exists():
            missing.append(current); current = current.parent
        for path in reversed(missing):
            record['ledger'].append({'operation': label + '-allocation', 'path': str(path), 'state': 'attempting'})
            path.mkdir()
            info = path.stat()
            record['ledger'][-1].update(state='allocated', device=info.st_dev, inode=info.st_ino, uid=info.st_uid)
    cache_copy(ready, evidence, record)
    if capture is None:
        from native import capture
    native = capture(ready, spec, paths, record)
    require(native['released'] is True, 'Capture cohort not positively released')
    record['released'] = True
    # No copy or CPU decoder while capture cohort ownership is unresolved.
    with deadline(45):
        frozen = evidence / 'decode-copy'
        record['outputManifest'] = copy_outputs(spec, Path(paths['output']), frozen, record, 'decode-copy')
        decoder(ready, spec, paths, record, frozen)
        copy_outputs(spec, frozen, evidence / 'verified-copy', record, 'verified-copy')
        output_manifest(spec, Path(paths['output']), record['outputManifest'])
    cache_event = {'operation': 'cache-growth-validation'}
    record['ledger'].append(cache_event)
    with deadline(30):
        cache_bytes = bounded_caches(ready['bindings']['generatedCaches'], record['initialCacheBytes'] + 256 * MIB, cache_event)
    require(cache_bytes - record['initialCacheBytes'] <= 256 * MIB, 'Cache growth ceiling')
    record['cacheBytesAfter'] = cache_bytes
    prior_specs = {s['id']: s for s in plan()['units']}
    admitted_outputs = [(prior_specs[row['unit']], row) for row in record['previousOutputs']]
    verify_worktree(Path(ready['bindings']['root']), record['sourceHead'], admitted_outputs + [(spec, record)], ready['bindings']['ignoredInventorySha256'])
    record['finalCacheOwners'] = final_verify(ready)


def main(ready_path, unit, grant_path, *, enabled=RUNTIME_ENABLED, verifier=bindings.verify, runner=run_unit, writer=exclusive_json, emit=None):
    ready, spec, paths, consumed = admit(ready_path, unit, grant_path, enabled=enabled, verifier=verifier)
    # Atomic, immutable one-use consumption. Any later failure leaves it spent.
    metadata_attempted = 0
    metadata_dispatched = 0
    def metadata_write(path, value):
        nonlocal metadata_attempted, metadata_dispatched
        data = encoded(value)
        amount = len(data)
        metadata_attempted += amount
        require(metadata_attempted <= 40 * MIB - 65536, 'Caller metadata attempt ceiling')
        require(amount <= 20 * MIB, 'Metadata cap exceeded')
        metadata_dispatched += amount
        if writer is exclusive_json:
            return exclusive_bytes(path, data, cap=20 * MIB)
        return writer(path, value)
    consumption_hash = metadata_write(Path(paths['consumption']), consumed)
    record = {**consumed, 'schema': RESULT_SCHEMA, 'consumptionSha256': consumption_hash, 'accepted': False, 'checksPassed': False,
              'status': 'FAILED_OR_INTERRUPTED', 'primaryFailure': None, 'secondaryFailures': [],
              'released': False, 'output': paths['output']}
    try:
        runner(ready, spec, paths, record)
        record.update(checksPassed=True, status='AWAITING_CALLER_COMPLETION')
    except BaseException as error:
        # Keep the original graph. Encoding it here and again during publication
        # expands shared native evidence into a second graph of graph nodes.
        record['primaryFailure'] = error
    def emergency(value):
        nonlocal metadata_attempted, metadata_dispatched
        data = encoded(value)
        amount = len(data)
        require(amount <= FAILURE_SUMMARY_CAP, 'Failure summary ceiling')
        metadata_attempted += amount
        require(metadata_dispatched + amount <= 40 * MIB, 'Caller failure reserve exhausted')
        metadata_dispatched += amount
        # The 64 KiB withheld from ordinary receipts covers this one 16 KiB sink.
        # Failed full writes stay charged; no allocation or capture is retried.
        path = terminal_paths(paths)[2]
        if writer is exclusive_json:
            exclusive_bytes(path, data, cap=FAILURE_SUMMARY_CAP)
        else:
            writer(path, value)
        return str(path)
    result = persist(record, terminal_paths(paths)[:2], write=metadata_write, emit=emit, emergency=emergency)
    result['metadataBytes'] = {'attempted': metadata_attempted, 'dispatched': metadata_dispatched}
    return (0 if record['checksPassed'] and not record['persistenceErrors'] and result['durable'] else 1), result


def cli(argv=None, *, execute=main):
    def interrupted(number, _frame):
        raise KeyboardInterrupt(f'Caller interrupted by signal {number}')
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--check', type=Path)
    parser.add_argument('--ready', type=Path)
    parser.add_argument('--unit')
    parser.add_argument('--grant', type=Path)
    args = parser.parse_args(argv)
    result = None
    try:
        if args.prepare:
            print(json.dumps(prepare(), indent=2))
        elif args.check:
            ready = json_snapshot(args.check)[0]
            bindings.verify(ready)
            for row in ready['paths'].values():
                for path in [*row.values(), *terminal_paths(row)]:
                    if str(args.check) != path: canonical(path, absent=True)
            inventory = plan()
            require(ready['runtimeEnabled'] is RUNTIME_ENABLED and ready['entryEnabled'] is inventory['entryEnabled'], 'Gate/readiness mismatch')
            status = 'ENABLED_AWAITING_PARENT_GRANT' if RUNTIME_ENABLED and ready['entryEnabled'] else 'DISABLED_CPU_BINDINGS_ONLY'
            print(json.dumps({'status': status, 'runtimeEnabled': RUNTIME_ENABLED, 'entryEnabled': ready['entryEnabled'], 'allUnitsQualified': False, 'nativeQualified': False}))
        else:
            code, result = execute(args.ready, args.unit, args.grant, emit=lambda data: sys.stderr.buffer.write(data))
            print(json.dumps({'exit': code, 'durable': result['durable'], 'accepted': False}))
            return code
        return 0
    except BaseException as error:
        record = getattr(error, 'evidence', None)
        if not isinstance(record, dict):
            if result is not None:
                record = result['record']
                record.setdefault('persistenceErrors', []).append({'sink': 'caller-status', 'error': error})
            else:
                record = {'primaryFailure': error}
        # This bounded last diagnostic does not serialize the failed full graph.
        # A broken stderr is an all-sinks failure, never a durable-success claim.
        try:
            sys.stderr.buffer.write(encoded(failure_summary(record)))
            sys.stderr.buffer.flush()
        except BaseException:
            pass
        return 1


if __name__ == '__main__':
    raise SystemExit(cli())
