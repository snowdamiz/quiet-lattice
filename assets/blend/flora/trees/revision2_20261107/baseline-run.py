"""Exclusive CPU jobs: retire current outputs, preserve bytes, then seal the outcome."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
EVIDENCE = ROOT / 'assets/blend/flora/trees/evidence'
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
KINDS = ('round', 'conifer', 'palm', 'mushroom', 'spiral', 'coral', 'blob', 'cactus')
WRITERS = ('author', 'seal', 'export')


def error_fact(error):
    return {'type': type(error).__name__, 'errno': getattr(error, 'errno', None), 'message': str(error)}


def write_json(path, value):
    # A failed write/fsync must never leave a parseable current PASS receipt.
    pending = path.with_name('.'+path.name+'.pending')
    with pending.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.link(pending, path)  # Atomic and exclusive, including an existing symlink.
    pending.unlink()


def read_bound(path):
    """Read regular bytes through the caller's name; detect replacement during read."""
    resolved = path.resolve(strict=True)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK), 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f'not a regular payload: {path}')
        data = stream.read()
        after = os.fstat(stream.fileno())
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    if identity(before) != identity(after) or identity(after) != identity(path.stat()) or path.resolve(strict=True) != resolved:
        raise RuntimeError(f'input changed during read: {path}')
    return {'path': str(path), 'resolved_path': str(resolved), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}, data


def sha(path):
    return read_bound(path)[0]['sha256']


def archive_outputs(paths, run, phase):
    """Move every removable name before reading any payload; detach readable bytes.

    Unreadable regular entries remain in quarantine with an error and no digest.
    Symlink metadata is recorded, but a live alias is never an archived payload.
    """
    escrow = run/(phase+'-quarantine')
    escrow.mkdir()
    rows = []
    for path, archive_name in paths:
        row = {'path': str(path), 'archive': archive_name, 'invalidated': False, 'errors': []}
        rows.append(row)
        try:
            info = path.lstat()
            row['entry'] = {'mode': info.st_mode, 'links': info.st_nlink}
            if stat.S_ISLNK(info.st_mode):
                row['link'] = os.readlink(path)
                row['target'] = str(path.resolve(strict=False))
        except FileNotFoundError:
            row['absent'] = True
            row['invalidated'] = True
        except (OSError, RuntimeError) as error:
            row['errors'].append(error_fact(error))
    for row in rows:
        if row.get('absent'):
            continue
        held = escrow/Path(row['path']).name
        try:
            Path(row['path']).rename(held)
            row['invalidated'] = True
            row['quarantine'] = str(held.relative_to(run))
        except OSError as error:
            row['errors'].append(error_fact(error))
    relocated = {str(Path(row['path']).absolute()): run/row['quarantine'] for row in rows if 'quarantine' in row and 'link' not in row}
    for row in rows:
        if 'quarantine' not in row:
            continue
        held = run/row['quarantine']
        try:
            source = held
            if 'link' in row:
                source = relocated.get(row['target'], Path(row['target']))
            bound, data = read_bound(source)
            target = run/row['archive']
            with target.open('xb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            if sha(target) != bound['sha256'] or read_bound(source)[0] != bound:
                raise RuntimeError(f'archive changed while detaching: {source}')
            row['payload'] = {'sha256': bound['sha256'], 'bytes': bound['bytes']}
        except (OSError, RuntimeError, ValueError, KeyError) as error:
            row['errors'].append(error_fact(error))
    # Keep relocated targets until every alias has been copied.
    for row in rows:
        if 'quarantine' not in row:
            continue
        held = run/row['quarantine']
        if 'payload' in row or held.is_symlink():
            try:
                held.unlink()
            except OSError as error:
                row['errors'].append(error_fact(error))
        row['quarantine_retained'] = os.path.lexists(held)
    return rows


def group(pid):
    rows = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,rss=,stat='], text=True, timeout=2).splitlines()
    return [{'pid': int(p), 'rss_kib': int(r), 'state': s} for line in rows for p, g, r, s in [line.split()] if int(g) == pid]


def stop(child):
    """Bounded cleanup. Failed signals are facts, never evidence of termination."""
    errors = []
    observed = None
    def observe():
        nonlocal observed
        child.poll()  # Reap the direct child when it has actually exited.
        try:
            observed = group(child.pid)
            return [row for row in observed if not row['state'].startswith('Z')]
        except Exception as error:
            errors.append(error_fact(error))
            observed = None
            return None
    for sig in (signal.SIGTERM, signal.SIGKILL):
        active = observe()
        if active == [] and child.returncode is not None:
            break
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass
        except OSError as error:
            errors.append({**error_fact(error), 'signal': sig.value})
        until = time.monotonic()+2
        while time.monotonic() < until:
            active = observe()
            if active == [] and child.returncode is not None:
                break
            time.sleep(.05)
    try:
        child.wait(timeout=1)
    except subprocess.TimeoutExpired as error:
        errors.append(error_fact(error))
    active = observe()
    return {'errors': errors, 'observed_group': observed, 'remaining_owned_children': active,
            'child_exit': child.returncode, 'child_reaped': child.returncode is not None,
            'terminal': active == [] and child.returncode is not None}


def attempt(args, run, lock, blocked, interrupted):
    source = ROOT/'assets/blend/flora'/f'tree_{args.kind}_t04.blend'
    export = ROOT/'packages/client/public/models/flora'/f'tree_{args.kind}_t04.glb'
    candidate = EVIDENCE.parent/'candidate.json'
    start = time.monotonic()
    receipt = {'schema': 2, 'action': args.action, 'kind': args.kind, 'cwd': str(ROOT),
               'source': str(source.relative_to(ROOT)), 'output': str(export.relative_to(ROOT)),
               'deadline_s': args.deadline, 'rss_limit_mib': 6144, 'log_limit_mib': 32,
               'source_before': None, 'source_after': None, 'export_sha256': None,
               'errors': [], 'archives': [], 'child_exit': None, 'remaining_owned_children': [],
               'child_reaped': False, 'child_started': False}
    rc = 0
    reason = 'exit'
    child = None
    before = None
    peak = 0
    def fail(why, error=None, code=1):
        nonlocal rc, reason
        if rc == 0:
            rc, reason = code, why
        if error is not None:
            receipt['errors'].append({'stage': why, **error_fact(error)})
    def archive(phase):
        rows = archive_outputs([(candidate, phase+'-candidate.json'), (export, phase+'-historical.glb')], run, phase)
        receipt['archives'].append({'phase': phase, 'entries': rows})
        if any(row['errors'] or not row['invalidated'] for row in rows):
            fail('output preservation failed', RuntimeError(f'see {phase} archive entries'))
    try:
        # Nothing reads source/output content until every current name is retired.
        if args.action in WRITERS:
            archive('previous')
        try:
            before, data = read_bound(source)
            receipt['source_before'] = before['sha256']
            receipt['source_binding'] = before
            if args.action in WRITERS:
                with (run/'previous-source.blend').open('xb') as stream:
                    stream.write(data)
        except FileNotFoundError as error:
            if args.action != 'author':
                fail('source before', error)
        except Exception as error:
            fail('source before', error)
        resources = {
            'load': os.getloadavg(), 'free_disk': shutil.disk_usage(ROOT).free,
            'memory': subprocess.check_output(['memory_pressure'], text=True, timeout=5).splitlines()[-1],
            'processes': subprocess.check_output(['ps', '-axo', 'pid,pcpu,rss,comm'], text=True, timeout=2).splitlines()
        }
        resources['processes'] = sorted(resources['processes'][1:], key=lambda s: float(s.split()[1]), reverse=True)[:15]
        receipt['resources'] = resources
        receipt['head'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, timeout=5).strip()
        if resources['load'][0] > 20 or resources['free_disk'] < 12*1024**3:
            fail('contention; no Blender launched', code=75)
        script = {'author': HERE/'author.py', 'seal': HERE/'seal.py', 'export': HERE/'export_saved.py',
                  'validate': HERE.parent/'validate.py', 'preview': HERE/'preview.py', 'audit': HERE/'audit.py', 'packet': HERE/'packet.py'}[args.action]
        extra = {'author': [args.kind], 'seal': [args.kind], 'export': [args.kind, str(run)],
                 'validate': ['--family', 'flora', '--report-dir', str(run/'reports'), str(source), str(export)],
                 'preview': [args.kind, str(run)], 'audit': [args.kind, str(run)], 'packet': [str(run)]}[args.action]
        cmd = [BLENDER, '-b', '--factory-startup', '-t', '2', '--python-exit-code', '1', '--python', str(script), '--', *extra]
        env = os.environ.copy()
        keys = ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS')
        env.update(dict.fromkeys(keys, '2'))
        env.update(ART_KTX_JOBS='1', PYTHONDONTWRITEBYTECODE='1', CUDA_VISIBLE_DEVICES='', KTX=str(HERE/'ktx_one.py'),
                   T04_CODEC_LOCK=str(EVIDENCE/'.codec.lock'),
                   T04_KTX_REAL='/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx')
        receipt.update(command=cmd, tool_hashes={str(p.relative_to(ROOT)): sha(p) for p in HERE.iterdir() if p.suffix in ('.py', '.mjs')},
                       environment={k: env[k] for k in (*keys, 'ART_KTX_JOBS', 'PYTHONDONTWRITEBYTECODE', 'CUDA_VISIBLE_DEVICES', 'KTX', 'T04_KTX_REAL', 'T04_CODEC_LOCK')}, codec_threads=1)
        if interrupted:
            fail('interrupted', code=128+interrupted[0])
        if rc == 0:
            with (run/'process.log').open('xb') as log:
                child = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, pass_fds=(lock.fileno(),))
                receipt.update(pid=child.pid, child_started=True)
                while True:
                    if interrupted:
                        fail('interrupted', code=128+interrupted[0]); break
                    if time.monotonic()-start > args.deadline:
                        fail('deadline', code=124); break
                    status = child.poll()
                    if status is not None:
                        if status != 0:
                            fail('child exit', code=status if status > 0 else 128-status)
                        break
                    rss = sum(row['rss_kib'] for row in group(child.pid))
                    peak = max(peak, rss)
                    if rss > 6144*1024:
                        fail('RSS limit', code=125); break
                    if log.tell() > 32*1024**2:
                        fail('log limit', code=125); break
                    time.sleep(.1)
    except Exception as error:
        fail('attempt exception', error)
    finally:
        if child is not None:
            try:
                cleanup = stop(child)
                receipt['cleanup'] = cleanup
                for key in ('child_exit', 'child_reaped', 'remaining_owned_children'):
                    receipt[key] = cleanup[key]
                if not cleanup['terminal'] or cleanup['errors']:
                    fail('cleanup', RuntimeError('see cleanup facts'), code=125)
                if not cleanup['terminal']:
                    # A timed-out/unsignable group must not open the lane to a peer.
                    write_json(blocked, {'attempt': str(run), 'pid': child.pid, 'cleanup': cleanup})
            except Exception as error:
                receipt['remaining_owned_children'] = None
                fail('cleanup exception', error, code=125)
                try:
                    write_json(blocked, {'attempt': str(run), 'pid': child.pid, 'error': error_fact(error)})
                except Exception as guard_error:
                    fail('cleanup guard', guard_error, code=125)
        try:
            after, _ = read_bound(source)
            receipt['source_after'] = after['sha256']
            receipt['source_unchanged'] = before == after
            if args.action not in ('author', 'seal') and before != after:
                receipt['source_mutation'] = True
                fail('source mutation', RuntimeError('source binding changed after producer exit'))
        except Exception as error:
            receipt['source_unchanged'] = False
            fail('source after', error)
        if interrupted:
            fail('interrupted', code=128+interrupted[0])
        # Finish source/cleanup validation before publishing a success receipt.
        if rc == 0 and args.action == 'export':
            try:
                receipt['export_sha256'] = sha(export)
            except Exception as error:
                fail('export after', error)
        if rc != 0:
            try:
                archive('failed')
            except Exception as error:
                fail('failed output quarantine', error)
            receipt['export_sha256'] = None
        elif os.path.lexists(export):
            try:
                receipt['export_sha256'] = sha(export)
            except Exception as error:
                fail('export after', error)
                try:
                    archive('failed')
                except Exception as archive_error:
                    fail('failed output quarantine', archive_error)
        receipt.update(exit=rc, reason=reason, elapsed_s=round(time.monotonic()-start, 3), peak_group_rss_kib=peak,
                       signals=interrupted, status='PASS' if rc == 0 else 'FAIL')
        try:
            write_json(run/'receipt.json', receipt)
        except Exception as error:
            fail('receipt write', error)
            receipt.update(exit=rc, reason=reason, status='FAIL', export_sha256=None)
            try:
                archive('unsealed')
                receipt['archives'].append({'phase': 'unsealed receipt', 'entries': archive_outputs(
                    [(run/'receipt.json', 'unsealed-receipt.json')], run, 'receipt')})
                write_json(run/'receipt-failure.json', receipt)
            except Exception as last_error:
                receipt['errors'].append({'stage': 'receipt fallback', **error_fact(last_error)})
            # Last available evidence if the filesystem cannot persist either file.
            print(json.dumps(receipt), file=sys.stderr, flush=True)
    print(json.dumps({'receipt': str((run/'receipt.json').relative_to(ROOT)), 'exit': rc, 'reason': reason, 'peak_rss_mib': round(peak/1024, 1)}), flush=True)
    return rc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('action', choices=(*WRITERS, 'validate', 'preview', 'audit', 'packet'))
    ap.add_argument('kind', choices=KINDS)
    ap.add_argument('--deadline', type=int, default=900)
    args = ap.parse_args()
    if args.deadline <= 0:
        ap.error('deadline must be positive')
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    with (EVIDENCE/'.lane.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('T04 lane already owned'); return 75
        blocked = EVIDENCE/'.lane.blocked.json'
        if os.path.lexists(blocked):
            print(f'T04 lane requires cleanup inspection: {blocked}'); return 75
        run = EVIDENCE/(time.strftime('%Y%m%dT%H%M%S')+'_'+args.action+'_'+args.kind+'_'+uuid.uuid4().hex[:8])
        try:
            run.mkdir()
        except FileExistsError:
            print('T04 attempt already exists'); return 73
        interrupted = []
        def interrupt(signum, _frame):
            if not interrupted:
                interrupted.append(signum)
        handlers = {sig: signal.signal(sig, interrupt) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            return attempt(args, run, lock, blocked, interrupted)
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)


if __name__ == '__main__':
    sys.exit(main())
