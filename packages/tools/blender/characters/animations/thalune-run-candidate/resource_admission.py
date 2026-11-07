"""Thalune task resource observations. Sampled stops, never an OS quota."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import hashlib, json, os, shutil, stat, subprocess, time
from pathlib import Path
from inspector import error_receipt, sha, write
from release_accounting import identity_key

RSS_LIMIT = 8 * 1024**3
COMBINED_RESERVE = 22066626560


def tree(path):
    """No links, special files, foreign owners, or unstable file reads."""
    path = Path(path)
    assert path.absolute()==path.resolve(), 'Cache path alias refused'
    if not path.exists() and not path.is_symlink(): return None
    rows = []
    for item in [path, *sorted(path.rglob('*'))]:
        before = item.lstat()
        assert not stat.S_ISLNK(before.st_mode) and before.st_uid == os.getuid(), 'Unowned cache path'
        assert stat.S_ISDIR(before.st_mode) or stat.S_ISREG(before.st_mode), 'Special cache file'
        row = dict(path=str(item.relative_to(path)), dev=before.st_dev, ino=before.st_ino,
                   uid=before.st_uid, mode=before.st_mode, bytes=before.st_size, mtime=before.st_mtime_ns)
        if item.is_file(): row['sha256'] = sha(item)
        assert item.lstat() == before, 'Cache changed while inventorying'
        rows.append(row)
    return rows


def content(rows):
    return None if rows is None else [{k:r[k] for k in ['path','mode','sha256'] if k in r} for r in rows]


def rss_read(pids):
    result = subprocess.run(['/bin/ps','-p',','.join(map(str,pids)),'-o','pid=,rss='],
                            capture_output=True, text=True, timeout=2, check=True)
    rows = [line.split() for line in result.stdout.splitlines()]
    assert all(len(r)==2 and all(v.isdecimal() for v in r) for r in rows), 'Unreadable RSS'
    values = {int(pid):int(kib)*1024 for pid,kib in rows}
    assert len(values)==len(rows) and set(values)==set(pids), 'Missing/duplicate RSS identities'
    return dict(bytesByPid=values, stdout=result.stdout, stderr=result.stderr)


class CohortRSS:
    def __init__(self, core, observations, read=rss_read, cancel=lambda:False):
        self.core, self.observations, self.read, self.cancel = core, observations, read, cancel
        self.last = -1

    def observe(self, job, force=False):
        if not force and time.monotonic()-self.last < .2: return
        self.last = time.monotonic()
        item = dict(monotonic=self.last, limitBytes=RSS_LIMIT, quota=False)
        self.observations.append(item)  # Before every fallible observation.
        try:
            with self.core.deadline(3):
                assert not self.cancel(), 'Parent cancelled unit'
                item['kernelBefore'] = self.core.kernel_tasks(job.coalition_id)
                item['members'] = job.members()
                keys = [identity_key(r) for r in item['members']]
                assert keys and len(keys)==len(set(keys)), 'Empty/duplicate owned cohort'
                assert item['kernelBefore']['live']==len(keys), 'Unclassified kernel task'
                item['before'] = [self.core.identity(r['pid']) for r in item['members']]
                assert all(r is not None for r in item['before']) and [identity_key(r) for r in item['before']]==keys, 'RSS birth/UID drift'
                item['rss'] = self.read([r['pid'] for r in item['members']])
                item['after'] = [self.core.identity(r['pid']) for r in item['members']]
                item['membersAfter'] = job.members()
                item['kernelAfter'] = self.core.kernel_tasks(job.coalition_id)
                assert all(r is not None for r in item['after']) and [identity_key(r) for r in item['after']]==keys, 'RSS reuse/departure'
                assert set(map(identity_key,item['membersAfter']))==set(keys), 'RSS cohort birth/departure during sample'
                assert item['kernelAfter']['live']==len(keys), 'RSS kernel drift'
                values = item['rss']['bytesByPid']
                assert set(values)=={r['pid'] for r in item['members']}, 'RSS missing identity'
                assert all(type(v) is int and v>=0 for v in values.values()), 'Unknown RSS'
                item['aggregateBytes'] = sum(values.values())
                assert item['aggregateBytes']<=RSS_LIMIT, 'Aggregate owned RSS exceeds 8 GiB'
                item['accepted'] = True
        except BaseException as error:
            item['failure'] = error_receipt(error)
            raise


def open_owners(paths, checkout, identity):
    """Read actual open paths and cwd; broad checkout cwd is conservatively unknown."""
    facts={'owners':[]}
    try:
        listing=subprocess.run(['/bin/ps','-axo','pid='],capture_output=True,text=True,timeout=2,check=True)
        births={}
        facts['enumeratedBirths']=births
        for p in listing.stdout.split():
            pid=int(p);births[pid]=identity(pid)
        facts['enumeratedBirths']=births
        result = subprocess.run(['/usr/sbin/lsof','-nP','-F0pcfn'], capture_output=True, timeout=3, cwd='/private/tmp')
        facts.update(exitCode=result.returncode, stdoutBytes=len(result.stdout), stdoutSha256=hashlib.sha256(result.stdout).hexdigest(),
                     stderr=result.stderr.decode(errors='backslashreplace'))
        if result.returncode!=0 or result.stderr:
            error=RuntimeError('Open-file enumeration incomplete');error.openFileFacts=facts;raise error
        pid = None; fd = None; command = None
        for field in result.stdout.replace(b'\n',b'').split(b'\0'):
            if not field: continue
            key, value = chr(field[0]), field[1:].decode(errors='strict')
            if key=='p': pid=int(value); command=None; fd=None
            elif key=='c': command=value
            elif key=='f': fd=value
            elif key=='n':
                hit = any(value==str(p) or value.startswith(str(p)+os.sep) for p in paths)
                cwd = fd=='cwd' and (value==str(checkout) or value.startswith(str(checkout)+os.sep))
                if hit or cwd:
                    before=births.get(pid); after=identity(pid)
                    facts['owners'].append(dict(pid=pid, command=command, fd=fd, path=value, before=before, after=after))
                    if before is None or after is None or identity_key(before)!=identity_key(after):
                        error=RuntimeError('Cache owner identity changed');error.openFileFacts=facts;raise error
        facts['enumeratedProcessCount']=len(births)
        del facts['enumeratedBirths']
        return facts
    except BaseException as error:
        error.openFileFacts=facts
        raise


class CacheLease:
    """Exclusive task lock plus repeated OS observations; retains all cache bytes in place."""
    def __init__(self, paths, checkout, lock, archive, observations, owners):
        self.paths, self.checkout = list(map(Path,paths)), Path(checkout)
        self.lock, self.archive = Path(lock), Path(archive)
        self.observations, self.owners = observations, owners
        self.lock_identity = None
        self.initial = None
        self.active = False

    def check(self, allowed=()):
        item = {}; self.observations.append(item)
        try:
            item['treesBefore'] = [tree(p) for p in self.paths]
            assert sum(r['bytes'] for rows in item['treesBefore'] if rows for r in rows if 'sha256' in r)<=384*1024**2, 'Vite snapshot exceeds archive reserve'
            assert sum(len(rows) for rows in item['treesBefore'] if rows)<=4096, 'Vite cache inventory file ceiling'
            item['openFiles'] = self.owners(self.paths, self.checkout)
            allowed = set(map(identity_key,allowed))
            for row in item['openFiles']['owners']:
                assert identity_key(row['before'])==identity_key(row['after']) and identity_key(row['after']) in allowed, 'Unknown Vite cache owner'
            item['treesAfter'] = [tree(p) for p in self.paths]
            assert item['treesBefore']==item['treesAfter'], 'Cache admission race'
            if self.lock_identity is not None:
                info=self.lock.lstat()
                assert (info.st_dev,info.st_ino,info.st_uid)==self.lock_identity, 'Cache lease replaced'
            item['accepted'] = True
            return item['treesAfter']
        except BaseException as error:
            item['failure']=error_receipt(error); raise

    def acquire(self):
        self.initial=self.check()
        allocation=dict(lock=str(self.lock),archive=str(self.archive),created=False)
        self.observations.append({'allocation':allocation})
        if self.lock_identity is None:
            self.lock.mkdir(mode=0o700)  # A spent lease is never reused by a different controller.
            info=self.lock.lstat(); self.lock_identity=(info.st_dev,info.st_ino,info.st_uid)
            allocation.update(created=True,identity=self.lock_identity)
        self.active=True
        self.archive.mkdir(parents=True, exist_ok=False)
        write(self.archive/'lease.json',dict(lock=str(self.lock), identity=self.lock_identity, paths=list(map(str,self.paths))))
        assert self.check()==self.initial, 'Cache changed around lease acquisition'
        self.copy('before', self.initial)

    def copy(self, name, observed):
        destination=self.archive/name; destination.mkdir()
        for i,(path,rows) in enumerate(zip(self.paths,observed)):
            if rows is None: continue
            shutil.copytree(path,destination/str(i),symlinks=True)
            assert content(tree(destination/str(i)))==content(rows), 'Cache archive bytes differ'
        assert [tree(p) for p in self.paths]==observed, 'Cache changed during archive'
        write(destination/'inventory.json',observed)

    def finish(self):
        current=self.check()  # Only after positive owned cohort release; no live owners allowed.
        self.copy('after',current)
        assert self.check()==current, 'Cache changed after archive'
        # No cache deletion: existing and generated bytes are retained at their actual paths.
        self.active=False
        # Retain the spent lease too: no check/unlink race can delete another owner's replacement.
        return dict(released=True, leaseRetained=True, cachesRetainedInPlace=True, archive=str(self.archive), before=self.initial, after=current)


def reserve(plan, observed_inventory):
    """Count the declared copies and named archives, then use current free bytes."""
    s=plan['storage']
    assert len(set(s['copySlots']))==4 and len(set(s['archiveSlots']))==11
    assert s['packetBytesPerCopy']==1111031808+106463232
    assert s['archiveBytesPerSlot']==1024**3
    assert observed_inventory['bytes']<=s['retainedInputCeiling']
    total=len(s['copySlots'])*s['packetBytesPerCopy']+len(s['archiveSlots'])*s['archiveBytesPerSlot']+16777216+1073741824+4294967296
    assert total==COMBINED_RESERVE and s['combinedReserveBytes']==total
    free=shutil.disk_usage(Path(plan['runRoot']).parent).free
    assert free>=total, 'Current combined reserve refused'
    return dict(reserveBytes=total,freeBytes=free,marginBytes=free-total,inventory=observed_inventory,
                copySlots=s['copySlots'],archiveSlots=s['archiveSlots'],quota=False)
