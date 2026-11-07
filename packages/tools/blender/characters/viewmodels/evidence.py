"""Byte-bound validation receipts and retained history for this asset family only."""
from pathlib import Path
import datetime
import hashlib
import json
import shutil
import uuid

PEOPLES = ('thalune', 'ixari', 'ulgani')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprint(path, root):
    data = Path(path).read_bytes()
    return {'path': str(Path(path).relative_to(root)), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def paths(root, people):
    if people not in PEOPLES:
        raise ValueError(f'Unknown viewmodel people: {people}')
    return {'source': root / f'assets/blend/characters/viewmodels/fp_{people}.blend',
            'export': root / f'packages/client/public/models/characters/viewmodels/fp_{people}.glb'}


def report_names(people):
    return (f'{people}-rig.json', f'characters__fp_{people}.blend.json', f'characters__fp_{people}.glb.json')


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def retire_inventory(out, history):
    previous = out / 'inventory.json'
    if previous.exists():
        history.mkdir(parents=True, exist_ok=True)
        previous.replace(history / 'inventory.json')


def begin_attempt(root, people, operation):
    out = root / 'assets/renders/characters/viewmodels'
    reports = out / 'validation'
    history = reports / 'history' / f'{people}-{uuid.uuid4().hex}'
    history.mkdir(parents=True)
    for name in (*report_names(people), f'{people}-receipt.json'):
        current = reports / name
        if current.exists():
            current.replace(history / name)
    retire_inventory(out, history)
    identities = {key: fingerprint(path, root) for key, path in paths(root, people).items() if path.is_file()}
    write_json(history / 'attempt.json', {'operation': operation, 'before': identities})
    if operation == 'export' and paths(root, people)['export'].is_file():
        shutil.copy2(paths(root, people)['export'], history / paths(root, people)['export'].name)
    write_json(reports / f'{people}-receipt.json', {'status': 'RUNNING', 'operation': operation, 'history': str(history.relative_to(root))})
    return reports, history


def fail_attempt(root, people, reports, history, error, source_opened):
    # Only this attempt's known destination can be invalidated. Missing/unreadable
    # sources do not establish that the old model is invalid; retain it unverified.
    destination = paths(root, people)['export']
    removed = False
    if source_opened and destination.exists():
        previous = history / destination.name
        if not previous.exists():
            shutil.copy2(destination, previous)
        elif sha(previous) != sha(destination):
            shutil.copy2(destination, history / ('failed-' + destination.name))
        destination.unlink()
        removed = True
    write_json(reports / f'{people}-receipt.json', {
        'status': 'FAIL', 'error': f'{type(error).__name__}: {error}', 'source_opened': source_opened,
        'destination_removed': removed, 'history': str(history.relative_to(root)),
    })


def publish_receipt(root, people, reports, validated, operation):
    actual = {key: fingerprint(path, root) for key, path in paths(root, people).items()}
    if actual != validated:
        raise ValueError('Viewmodel source/export changed during validation')
    rig = json.loads((reports / f'{people}-rig.json').read_text())
    if rig.get('status') != 'PASS' or rig.get('source_sha256') != actual['source']['sha256']:
        raise ValueError('Rig validation does not match the source')
    for extension in ('blend', 'glb'):
        report = json.loads((reports / f'characters__fp_{people}.{extension}.json').read_text())
        if report.get('status') != 'PASS' or report['summary']['fail'] != 0:
            raise ValueError(f'{extension} validation did not pass')
    receipt = {'version': 1, 'status': 'PASS', 'people': people, 'operation': operation,
               'validated_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'files': actual, 'reports': {name: sha(reports / name) for name in report_names(people)}}
    write_json(reports / f'{people}-receipt.json', receipt)
    return receipt


def verify_receipt(root, people):
    reports = root / 'assets/renders/characters/viewmodels/validation'
    receipt = json.loads((reports / f'{people}-receipt.json').read_text())
    if receipt.get('version') != 1 or receipt.get('status') != 'PASS' or receipt.get('people') != people:
        raise ValueError(f'{people}: no successful validation receipt')
    actual = {key: fingerprint(path, root) for key, path in paths(root, people).items()}
    if actual != receipt['files']:
        raise ValueError(f'{people}: source/export bytes differ from the validated pair')
    expected = {name: sha(reports / name) for name in report_names(people)}
    if expected != receipt['reports']:
        raise ValueError(f'{people}: validation reports differ from the receipt')
    return receipt
