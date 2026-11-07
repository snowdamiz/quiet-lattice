"""Bounded read-only admission for this pilot's exact caches and task-local Vite routes."""
import os
from pathlib import Path
import re
import selectors
import subprocess
import time

from contract import require
from evidence import failure, raw

OWNER_SECONDS = 10
COMMAND_CAP = 256 * 1024
CHECK_CAP = 384 * 1024


def probe(argv, record, end):
    """Only caller-supplied ps/lsof argv. Charge bytes while reading; retain partial producer output."""
    row = {'argv': argv, 'pid': None, 'returncode': None, 'stdout': b'', 'stderr': b'', 'reaped': False}
    record['probes'].append(row)
    process = None
    try:
        require(time.monotonic() < end, 'Cache-owner check deadline')
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        row['pid'] = process.pid
        with selectors.DefaultSelector() as selected:
            for name in ('stdout', 'stderr'):
                stream = getattr(process, name)
                os.set_blocking(stream.fileno(), False)
                selected.register(stream, selectors.EVENT_READ, name)
            while selected.get_map():
                remaining = end - time.monotonic()
                require(remaining > 0, 'Cache-owner check deadline')
                for key, _ in selected.select(min(remaining, .1)):
                    used = len(row['stdout']) + len(row['stderr'])
                    limit = min(COMMAND_CAP - used, CHECK_CAP - record['bytes'])
                    block = os.read(key.fd, min(65536, max(1, limit + 1)))
                    if not block:
                        selected.unregister(key.fileobj)
                        continue
                    row[key.data] += block
                    record['bytes'] += len(block)
                    require(used + len(block) <= COMMAND_CAP and record['bytes'] <= CHECK_CAP, 'Cache-owner probe output cap')
            row['returncode'] = process.wait(timeout=max(.001, end - time.monotonic()))
            row['reaped'] = True
        return row
    except BaseException as error:
        row['failure'] = failure(error)
        raise
    finally:
        # These are only our direct ps/lsof children, never a native capture cohort or competing owner.
        if process is not None:
            try:
                if process.poll() is None:
                    process.kill()
                    row['stoppedOwnedProbe'] = True
                row['returncode'] = process.wait(timeout=.5)
                row['reaped'] = True
            except BaseException as error:
                row['cleanupFailure'] = failure(error)
            for stream in (process.stdout, process.stderr):
                if stream is not None:
                    try:
                        stream.close()
                    except BaseException as error:
                        row.setdefault('closeFailures', []).append(failure(error))


def lsof_records(value):
    """Keep every machine field; unknown/malformed output is not an empty owner set."""
    require(value['reaped'] and 'cleanupFailure' not in value and not value.get('closeFailures') and not value['stderr'], 'Uncertain lsof process/stderr')
    if value['returncode'] == 1 and not value['stdout']:
        return []
    # lsof may return 1 when one selection has no match while still producing owner records.
    # Those positive observations must survive before the caller refuses the nonzero query.
    require(value['returncode'] in (0, 1) and value['stdout'], 'Uncertain lsof exit/output')
    rows, current = [], None
    text = value['stdout'].decode('utf-8', errors='strict')
    require('\0' in text, 'Non-machine lsof output')
    for field in text.split('\0'):
        field = field.lstrip('\n')
        if not field:
            continue
        if field[0] == 'p':
            require(field[1:].isdigit(), 'Malformed lsof PID')
            current = {'pid': int(field[1:]), 'fields': []}
            rows.append(current)
        require(current is not None and len(field) > 1, 'Malformed lsof field')
        current['fields'].append(field)
    require(rows and all(any(f.startswith('n') for f in r['fields']) for r in rows), 'Incomplete lsof owner records')
    return rows


def check_cache_owners(ready, observations, phase, *, command=probe):
    record = {'phase': phase, 'status': 'UNKNOWN', 'paths': [], 'probes': [], 'conflicts': [], 'bytes': 0,
              'scope': 'Exact generated caches, task-root cwd subtree, and current-user task-local Node/Vite argv',
              'deadlineSeconds': OWNER_SECONDS, 'pointInTimeOnly': True}
    observations.append(record)  # Before stat, subprocess creation or any other fallible I/O.
    end = time.monotonic() + OWNER_SECONDS
    try:
        root = Path(ready['root'])
        require(root.resolve() == root and root.is_dir(), 'Unsafe task root for owner check')
        caches = ready['generatedCaches']
        require(isinstance(caches, list) and 1 <= len(caches) <= 2 and len(set(caches)) == len(caches), 'Exact cache paths required')
        for name in caches:
            path = Path(name)
            require(path.is_relative_to(root) and path != root and path.resolve() == path and not path.is_symlink(), 'Unsafe cache route')
            entry = {'path': name, 'exists': path.exists(), 'stampBefore': None, 'stampAfter': None}
            record['paths'].append(entry)
            if path.exists():
                before = path.stat()
                require(path.is_dir() and before.st_uid == os.getuid(), 'Cache type/ownership uncertainty')
                entry['stampBefore'] = [before.st_dev, before.st_ino]
                queried = command(['/usr/sbin/lsof', '-nP', '-F0pcuafDitn', '+D', name], record, end)
                owners = lsof_records(queried)
                entry['owners'] = owners
                after = path.stat()
                entry['stampAfter'] = [after.st_dev, after.st_ino]
                require(entry['stampBefore'] == entry['stampAfter'] and not path.is_symlink(), 'Cache identity changed during owner check')
                record['conflicts'].extend({'kind': 'open-cache-owner', 'cache': name, **row} for row in owners)
                require(not owners, 'Live owner of exact generated cache')

        process = command(['/bin/ps', '-ww', '-U', str(os.getuid()), '-o', 'pid=,ruid=,comm='], record, end)
        require(process['reaped'] and 'cleanupFailure' not in process and not process.get('closeFailures') and process['returncode'] == 0 and not process['stderr'], 'Uncertain task-process census')
        rows = {}
        for line in process['stdout'].decode('utf-8', errors='strict').splitlines():
            fields = line.split(None, 2)
            require(len(fields) == 3 and fields[0].isdigit() and fields[1].isdigit(), 'Malformed process census')
            pid, uid = int(fields[0]), int(fields[1])
            require(uid == os.getuid() and pid not in rows, 'Process census UID/identity ambiguity')
            rows[pid] = {'pid': pid, 'realUid': uid, 'executable': fields[2]}
        require(os.getpid() in rows, 'Incomplete process census')
        node_pids = {pid for pid, row in rows.items() if Path(row['executable']).name in ('node', 'nodejs', 'vite', 'pnpm', 'npm', 'npx', 'tsx', 'corepack')}
        require(len(node_pids) <= 64, 'Task Node/Vite census exceeds bounded candidate count')
        def require_absent(pids):
            if not pids:
                return
            absent = command(['/bin/ps', '-ww', '-p', ','.join(map(str, sorted(pids))), '-o', 'pid=,ruid=,comm='], record, end)
            require(absent['reaped'] and 'cleanupFailure' not in absent and not absent.get('closeFailures') and absent['returncode'] == 1 and not absent['stdout'] and not absent['stderr'], 'Node/Vite identity changed or remained unknown')
            record.setdefault('exitedNodePids', []).extend(sorted(pids))
        candidates, commands, cwd = [], {}, []
        if node_pids:
            arguments = command(['/bin/ps', '-ww', '-p', ','.join(map(str, sorted(node_pids))), '-o', 'pid=,ruid=,command='], record, end)
            require(arguments['reaped'] and 'cleanupFailure' not in arguments and not arguments.get('closeFailures') and arguments['returncode'] in (0, 1) and not arguments['stderr'], 'Uncertain Node/Vite argv census')
            for line in arguments['stdout'].decode('utf-8', errors='strict').splitlines():
                fields = line.split(None, 2)
                require(len(fields) == 3 and fields[0].isdigit() and fields[1].isdigit(), 'Malformed Node/Vite argv census')
                pid = int(fields[0])
                require(pid in node_pids and int(fields[1]) == os.getuid() and pid not in commands, 'Node/Vite identity ambiguity')
                commands[pid] = {**rows[pid], 'command': fields[2]}
            require_absent(node_pids - set(commands))
        if commands:
            cwd_result = command(['/usr/sbin/lsof', '-nP', '-a', '-p', ','.join(map(str, sorted(commands))), '-d', 'cwd', '-F0pcuafDitn'], record, end)
            cwd = lsof_records(cwd_result)
            record['nodeCwdOwners'] = cwd
            require(all(r['pid'] in commands and 'fcwd' in r['fields'] and 'tDIR' in r['fields'] for r in cwd), 'Uncertain Node/Vite cwd record')
            require_absent(set(commands) - {r['pid'] for r in cwd})
            require(cwd_result['returncode'] == 0 or not cwd, 'Nonzero partial Node/Vite cwd query; ownership uncertain')
        task_pids = {r['pid'] for r in cwd if any(f.startswith('n') and Path(f[1:]).is_relative_to(root) for f in r['fields'])}
        record['nodeCandidates'] = list(commands.values())
        for pid, row in commands.items():
            routed = str(root) + '/' in row['command'] or re.search(r'(?:^|\s)' + re.escape(str(root)) + r'(?:\s|$)', row['command'])
            if pid in task_pids or routed:
                candidates.append({'kind': 'task-local-node-vite-or-uncertain-owner', **row})
        record['conflicts'].extend(candidates)
        require(not candidates, 'Live task-local Node/Vite owner or uncertain route')
        require(time.monotonic() < end, 'Cache-owner check deadline')
        record['status'] = 'CLEAR'
        return record
    except BaseException as error:
        record['failure'] = failure(error)
        raise
    finally:
        record['elapsedSeconds'] = max(0, time.monotonic() - (end - OWNER_SECONDS))
        # Convert producer bytes for durable/in-memory publication without rereading or writing any path.
        record['probes'] = raw(record['probes'])
