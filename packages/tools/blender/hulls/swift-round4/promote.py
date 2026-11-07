"""Promote the current saved source's export only after actual successful stage termination."""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
EVIDENCE = ROOT / 'assets/renders/hulls/swift-round4-current'
SOURCE = ROOT / 'assets/blend/hulls/swift.blend'
DESTINATION = ROOT / 'packages/client/public/models/hulls/swift.glb'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def read(path):
    require(path.is_file(), f'missing completed-stage evidence: {path}')
    return json.loads(path.read_text())


def terminal(stage, source_pin):
    receipt = read(stage / 'receipt.json')
    launch = read(stage / 'launch.json')
    guardian = read(stage / 'guardian.json')
    require(type(receipt.get('exit')) is int and receipt['exit'] == 0,
            f'{stage.name}: terminal exit must be zero')
    require('reason' in receipt and receipt['reason'] is None and receipt.get('childGroupEmpty') is True,
            f'{stage.name}: cancellation/resource failure or unproven cleanup')
    require(receipt.get('cwd') == launch.get('cwd') == str(ROOT), f'{stage.name}: checkout mismatch')
    require(receipt.get('inputs') == launch.get('inputs') and receipt.get('command') == launch.get('command'),
            f'{stage.name}: launch/terminal identity mismatch')
    require(receipt.get('inputs', {}).get(str(SOURCE.relative_to(ROOT))) == source_pin,
            f'{stage.name}: terminal source input mismatch')
    require(guardian.get('childGroupEmpty') is True and guardian.get('remaining') == []
            and guardian.get('reason') == 'normal runner completion'
            and guardian.get('commandGroup') == receipt.get('pid') and type(receipt.get('pid')) is int,
            f'{stage.name}: guardian did not prove normal completion and empty group')
    require(Path(launch.get('temporaryAlias', {}).get('path', '')).name == f"swift-r4-{guardian.get('parentPid')}",
            f'{stage.name}: guardian owner mismatch')
    require(receipt.get('format') == 3 and guardian.get('format') == 3
            and receipt.get('publicationProtocol') == 'durable-stage-v2',
            f'{stage.name}: historical/provisional receipt is not a completed publication')
    require(not os.path.lexists(stage / '.publication-open'),
            f'{stage.name}: publication remains provisional or failed')
    publication = read(stage / 'publication.json')
    bindings = {name: sha(stage / name) for name in ['launch.json', 'supervisor-launch.json', 'dispatch.json', 'guardian.json', 'receipt.json']}
    require(publication.get('protocol') == 'durable-stage-v2'
            and publication.get('files') == bindings and publication.get('producerExit') == 0
            and publication.get('supervisorExit') == 0 and publication.get('runnerPid') == receipt.get('runnerPid'),
            f'{stage.name}: completed publication binding mismatch')
    require(receipt.get('guardianExit') == 0 and receipt.get('guardianSha256') == sha(stage / 'guardian.json')
            and guardian.get('supervisorPid') == receipt.get('guardianPid')
            and guardian.get('failureReason') is None and guardian.get('commandExit') == 0
            and guardian.get('ownedChildReaped') is True and guardian.get('observationErrors') == []
            and guardian.get('drainErrors') == [],
            f'{stage.name}: supervisor terminal outcome mismatch')
    owned = read(stage / 'supervisor-launch.json')
    dispatched = read(stage / 'dispatch.json')
    require(owned.get('pid') == receipt['guardianPid'] and owned.get('inputs') == launch['inputs']
            and owned.get('command') == launch['command'] and owned.get('parentPid') == receipt['runnerPid']
            and dispatched == {'pid': receipt['pid'], 'pgid': receipt['pid'], 'supervisorPid': receipt['guardianPid']},
            f'{stage.name}: durable dispatch ownership mismatch')
    return {name: sha(stage / name) for name in ['launch.json', 'receipt.json', 'guardian.json', 'publication.json']}


def validate(jobs):
    require(len(jobs) == 4 and all(name and Path(name).name == name for name in jobs), 'four local stage names required')
    export_job, identity_job, audit_job, fit_job = [EVIDENCE / name for name in jobs]
    source_pin = {'sha256': sha(SOURCE), 'bytes': SOURCE.stat().st_size}
    # No output file or destination is touched before every terminal gate succeeds.
    receipts = {stage.name: terminal(stage, source_pin) for stage in [export_job, identity_job, audit_job, fit_job]}
    candidate = export_job / 'models/hulls/swift.glb'
    new = sha(candidate)
    identity = read(identity_job / 'identity.json')
    audit = read(audit_job / 'audit.json')
    fit = read(fit_job / 'display-fit.json')
    pin = read(export_job / 'source-pin.json')
    require(identity.get('status') == audit.get('status') == fit.get('status') == 'PASS', 'failed validation payload')
    require(identity.get('sourceSha256') == audit.get('sourceSha256') == fit.get('sourceSha256') == pin.get('sha256') == source_pin['sha256'], 'payload source mismatch')
    require(pin.get('bytes') == source_pin['bytes'] and pin.get('stockExit') == 0, 'stock source pin mismatch')
    require(identity.get('glbSha256') == pin.get('glbSha256') == new, 'stock/identity candidate hash mismatch')
    for name in ['hulls__swift.blend.json', 'hulls__swift.glb.json']:
        require(read(export_job / 'validation' / name).get('status') == 'PASS', 'failed stock validation')
    return candidate, source_pin, new, receipts


def main():
    jobs = sys.argv[1:]
    candidate, source_pin, new, receipts = validate(jobs)
    old = sha(DESTINATION)
    require(old in ['88cf76bb5c50d53c9b83e72875bbd0b114cc41fd1f28158b945c5d35c78943c6', new], 'unexpected canonical destination')
    job = Path(os.environ['SWIFT_JOB'])
    pending = job / 'promote-copy.glb'
    with pending.open('xb') as f, candidate.open('rb') as src:
        shutil.copyfileobj(src, f)
        f.flush()
        os.fsync(f.fileno())
    require(sha(pending) == new, 'copy hash mismatch')
    os.replace(pending, DESTINATION)
    with (job / 'promotion.json').open('x') as f:
        json.dump({'sourceSha256': source_pin['sha256'], 'previousGLBSha256': old, 'glbSha256': new,
                   'bytes': DESTINATION.stat().st_size, 'inputs': jobs, 'terminalEvidence': receipts}, f, indent=2)
    print('PROMOTED', new, DESTINATION.stat().st_size)


if __name__ == '__main__':
    main()
