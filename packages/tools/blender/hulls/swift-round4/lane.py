"""One owned CPU process group; immutable attempt logs, bounded resources, reap before unlock."""
import argparse, json, os, signal, subprocess, sys, time, shutil, hashlib, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
EVIDENCE = ROOT / 'assets/renders/hulls/swift-round4-current'
LOCK = Path(__file__).with_name('.lane-lock')

def processes(timeout=5, executable='ps'):
    rows = subprocess.check_output([executable,'-axo','pid=,ppid=,pgid=,rss=,stat='], text=True, stderr=subprocess.PIPE, timeout=timeout)
    return [line.split() for line in rows.splitlines() if line.strip()]

def resources():
    rows = processes()
    vm = subprocess.check_output(['vm_stat'],text=True)
    counts = {line.split(':')[0]: int(line.split(':')[1].strip().strip('.')) for line in vm.splitlines()[1:] if ':' in line}
    return {'diskFree': shutil.disk_usage(ROOT).free,
            'memoryFreeInactive': (counts['Pages free']+counts['Pages inactive'])*16384,
            'allRssKiB': sum(int(row[3]) for row in rows), 'vmStat': vm}

def existing_sizes(paths):
    for path in paths:
        try:
            size=path.stat().st_size
        except FileNotFoundError:
            continue  # Blender/encoder scratch files can disappear after enumeration.
        if path.is_file():
            yield path,size

def output_usage():
    total=count=image_bytes=0
    for folder,dirs,names in os.walk(EVIDENCE):
        for path,size in existing_sizes(Path(folder)/name for name in names):
            total+=size
            if path.suffix.lower() in ('.png','.jpg','.jpeg','.webp') and 'scratch' not in path.relative_to(EVIDENCE).parts:
                count+=1;image_bytes+=size
    return total,count,image_bytes

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_json(path, value):
    # Never expose a partially flushed/fsynced document under its final name.
    # Retain the private bytes on failure; final names never overwrite evidence.
    private = path.with_name('.' + path.name + '.writing')
    with private.open('x') as f:
        json.dump(value, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.link(private, path)
    sync_directory(path.parent)
    private.unlink()


def error_fact(operation, exc):
    def text(value):
        return value.decode(errors='replace') if isinstance(value, bytes) else value
    return {'operation': operation, 'type': type(exc).__name__, 'message': str(exc),
            'errno': getattr(exc, 'errno', None), 'returncode': getattr(exc, 'returncode', None),
            'stdout': text(getattr(exc, 'stdout', None)), 'stderr': text(getattr(exc, 'stderr', None))}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--label', required=True)
    p.add_argument('--timeout', type=int, default=600)
    p.add_argument('--rss-mib', type=int, default=10000)
    p.add_argument('command', nargs=argparse.REMAINDER)
    a = p.parse_args()
    command = a.command[1:] if a.command[:1] == ['--'] else a.command
    assert command and '/' not in a.label and 0 < a.timeout <= 3600 and a.rss_mib > 0
    if Path(__file__).with_name('HEAVY_HOLD.json').exists():
        raise SystemExit('Parent resource hold active: no new lane admissions until explicit parent release.')
    LOCK.mkdir()
    supervisor = None
    read_fd = write_fd = None
    temp_alias = job = receipt = None
    reason = None
    committed = False
    owner_ready = False
    publication = None
    group_empty = True
    code = 1
    started = time.monotonic()

    def cancel(sig, frame):
        nonlocal reason
        if not committed:
            reason = reason or f'cancelled signal {sig}'

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, cancel)
    try:
        durable_json(LOCK / 'owner.json', {'pid': os.getpid(), 'cwd': str(ROOT), 'label': a.label})
        owner_ready = True
        job = EVIDENCE / a.label
        job.mkdir(parents=True, exist_ok=False)
        publication = job / '.publication-open'
        durable_json(publication, {'protocol': 'durable-stage-v2', 'runnerPid': os.getpid()})
        inputs = {}
        for path in [ROOT / 'assets/blend/hulls/swift.blend', ROOT / 'packages/client/public/models/hulls/swift.glb']:
            if path.exists():
                with path.open('rb') as f:
                    inputs[str(path.relative_to(ROOT))] = {'sha256': hashlib.file_digest(f, 'sha256').hexdigest(), 'bytes': path.stat().st_size}
        receipt = {'format': 3, 'publicationProtocol': 'durable-stage-v2', 'inputs': inputs, 'command': command, 'cwd': str(ROOT),
                   'runnerPid': os.getpid(), 'preflight': resources(), 'timeout': a.timeout, 'rssLimitMiB': a.rss_mib}
        if receipt['preflight']['diskFree'] < 8 * 1024**3 or receipt['preflight']['memoryFreeInactive'] < 2 * 1024**3:
            raise RuntimeError('preflight resource floor')
        scratch = job / 'scratch'
        scratch.mkdir()
        temp_alias = Path('/tmp') / f'swift-r4-{os.getpid()}'
        temp_alias.symlink_to(scratch, target_is_directory=True)
        receipt['temporaryAlias'] = {'path': str(temp_alias), 'target': str(scratch)}
        env = os.environ.copy()
        env.update({k: '2' for k in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'NUMEXPR_NUM_THREADS', 'BLENDER_THREADS', 'ART_KTX_THREADS']})
        env.update({'ART_KTX_JOBS': '1', 'PYTHONDONTWRITEBYTECODE': '1', 'SWIFT_JOB': str(job), 'TMPDIR': str(temp_alias), 'SWIFT_TEMP_ALIAS': str(temp_alias)})
        durable_json(job / 'launch.json', receipt)
        read_fd, write_fd = os.pipe()
        with (job / 'process.log').open('xb') as log:
            # No producer exists until this independent owner receives the handshake.
            supervisor = subprocess.Popen([sys.executable, str(Path(__file__).with_name('supervise.py')), str(read_fd), str(os.getpid())], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, pass_fds=(read_fd,), start_new_session=True)
            os.close(read_fd)
            read_fd = None
            os.write(write_fd, b'start\n' if not reason else reason.encode() + b'\n')
            sent_cancel = bool(reason)
            while supervisor.poll() is None:
                if reason and not sent_cancel:
                    try:
                        os.write(write_fd, reason.encode() + b'\n')
                    except BrokenPipeError:
                        pass
                    sent_cancel = True
                time.sleep(.05)
        # This is the actual wait result, not a success prediction by the child.
        supervisor.wait()
        guardian = json.loads((job / 'guardian.json').read_text())
        group_empty = guardian['childGroupEmpty'] and supervisor.returncode == 0
        reason = reason or guardian['failureReason']
        code = guardian['commandExit'] if not reason and group_empty else 1
        receipt.update(pid=guardian['commandGroup'], guardianPid=supervisor.pid,
                       guardianExit=supervisor.returncode,
                       guardianSha256=hashlib.sha256((job / 'guardian.json').read_bytes()).hexdigest(),
                       peakRssKiB=guardian['peakRssKiB'])
    except BaseException as exc:
        reason = reason or f'{type(exc).__name__}: {exc}'
        traceback.print_exc()
    finally:
        # Signal handlers only record cancellation; repeated signals cannot unwind drain.
        if read_fd is not None:
            os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)
        if supervisor is not None:
            supervisor.wait(timeout=a.timeout + 35)
            proof = job / 'guardian.json'
            group_empty = supervisor.returncode == 0 and proof.exists() and json.loads(proof.read_text())['childGroupEmpty']
        if group_empty and temp_alias is not None and temp_alias.is_symlink():
            assert os.readlink(temp_alias) == str(job / 'scratch')
            temp_alias.unlink()
        publication_errors = []
        if receipt:
            try:
                postflight = resources()
            except Exception as exc:
                postflight = None
                publication_errors.append(error_fact('postflight resources', exc))
                reason = reason or 'postflight observation failed'
            receipt.update(exit=code if not reason and group_empty else 1, reason=reason,
                           seconds=round(time.monotonic() - started, 2),
                           peakRssKiB=receipt.get('peakRssKiB', 0), childGroupEmpty=group_empty,
                           postflight=postflight, publicationErrors=publication_errors)
            # All these documents remain provisional while .publication-open exists.
            # In particular, a failed final directory fsync must not open the gate.
            durable_json(job / 'receipt.json', receipt)
            print(json.dumps({k: receipt[k] for k in ['exit', 'reason', 'seconds', 'peakRssKiB', 'childGroupEmpty']}), flush=True)
            if code == 0 and not reason and group_empty:
                bindings = {name: hashlib.sha256((job / name).read_bytes()).hexdigest()
                            for name in ['launch.json', 'supervisor-launch.json', 'dispatch.json', 'guardian.json', 'receipt.json']}
                durable_json(job / 'publication.json', {'protocol': 'durable-stage-v2',
                             'producerExit': receipt['exit'], 'supervisorExit': receipt['guardianExit'],
                             'runnerPid': os.getpid(), 'files': bindings})
        if group_empty and owner_ready:
            (LOCK / 'owner.json').unlink(missing_ok=True)
            # The retained private ownership file is evidence, not an active claim.
            (LOCK / '.owner.json.writing').unlink(missing_ok=True)
            LOCK.rmdir()
        else:
            print('CLEANUP UNPROVEN: LOCK RETAINED', file=sys.stderr)
        if receipt and code == 0 and not reason and group_empty:
            # Commit point: every required file/dir sync and fallible operation above
            # has finished. No required write follows this atomic gate removal.
            # Crash rollback can restore the gate (a refusal), never unsync its inputs.
            publication.unlink()
            committed = True
    return 0 if committed else code if not reason and group_empty and code != 0 else 1


if __name__ == '__main__':
    sys.exit(main())
