"""Durable admission/settlement for this task's one local process lane."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import uuid


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_json(path, value, replace=False):
    """Persist bytes before publishing the name; never replace another run."""
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.pending')
    with temp.open('x') as f:
        json.dump(value, f, indent=2)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())
    if replace:
        os.replace(temp, path)
    else:
        os.link(temp, path)
        temp.unlink()
    sync_directory(path.parent)


def read(path):
    return json.loads(path.read_text())


@contextlib.contextmanager
def lane_lock(reports):
    reports.mkdir(parents=True, exist_ok=True)
    with (reports / 'lane.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def settled_runs(reports, *, promotion=False):
    """Missing/corrupt/partially published ownership never means an empty lane.

    Legacy receipts are frozen inputs, not new lifecycle proof. New failures may
    release admission after proved cleanup, but may never pass finalization.
    """
    legacy = read(Path(__file__).with_name('legacy-stages.json'))['stages']
    for files in legacy.values():
        for name, expected in files.items():
            if digest(reports / name) != expected:
                raise RuntimeError('historical evidence changed: ' + name)
    registered = {}
    for directory in sorted((reports / 'runs').glob('*')):
        if not directory.is_dir():
            raise RuntimeError('unknown ownership entry: ' + str(directory))
        try:
            admitted = read(directory / 'admitted.json')
            stage = admitted['stage']
            if stage != directory.name or admitted['schema'] != 2:
                raise ValueError('admission identity')
            receipt = reports / (stage + '.json')
            terminal = read(receipt)
            seal = read(directory / 'settled.json')
            if (terminal['runId'] != admitted['runId'] or terminal['stage'] != stage
                    or any(terminal.get(key) != value for key, value in admitted.items())
                    or terminal['schema'] != 2 or seal['runId'] != admitted['runId']
                    or seal['admissionSHA256'] != digest(directory / 'admitted.json')
                    or seal['terminalSHA256'] != digest(receipt)
                    or terminal['cleanup'] != 'verified' or terminal['remainingProcesses']
                    or not terminal['directChildReaped']):
                raise ValueError('unsettled or mismatched terminal evidence')
            if promotion and (terminal['outcome'] != 'success' or terminal['exit'] != 0
                              or terminal['errors'] or terminal['cancelSignals'] or terminal['stopReason']):
                raise ValueError('failed/cancelled run cannot promote')
            registered[stage] = terminal
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise RuntimeError(f'ownership unresolved: {directory.name}: {error}') from error
    for log in reports.glob('*.log'):
        if log.stem not in legacy and log.stem not in registered:
            raise RuntimeError('unregistered or unfinished stage log: ' + log.name)
    for path in reports.glob('*.json'):
        value = read(path)
        if isinstance(value, dict) and 'stage' in value and 'command' in value:
            if path.stem not in legacy and path.stem not in registered:
                raise RuntimeError('unregistered terminal record: ' + path.name)
    return registered


def admit(reports, name, command):
    settled_runs(reports)
    if (reports / (name + '.log')).exists() or (reports / (name + '.json')).exists():
        raise FileExistsError('stage name already used: ' + name)
    runs = reports / 'runs'
    runs.mkdir(exist_ok=True)
    sync_directory(reports)
    directory = runs / name
    directory.mkdir()  # Even a crash before admitted.json leaves admission closed.
    sync_directory(runs)
    admission = dict(schema=2, stage=name, runId=uuid.uuid4().hex,
                     supervisorPID=os.getpid(), command=command)
    write_json(directory / 'admitted.json', admission)
    return directory, admission


def settle(directory, receipt, run_id):
    write_json(directory / 'settled.json', dict(
        runId=run_id, admissionSHA256=digest(directory / 'admitted.json'),
        terminalSHA256=digest(receipt)))
