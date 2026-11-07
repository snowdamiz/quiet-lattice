"""Thalune task resource observations. Sampled stops, never an OS quota."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import hashlib, json, os, shutil, stat, subprocess, time
from pathlib import Path
from contextlib import contextmanager
from inspector import error_receipt, sha, write
from release_accounting import identity_key

RSS_LIMIT = 8 * 1024**3
COMBINED_RESERVE = 22066626560


CACHE_BYTES = 384 * 1024**2
CACHE_ENTRIES = 4096
STAT_KEYS = ('dev','ino','uid','gid','mode','bytes','mtime','ctime','links')


def stat_row(name, info):
    return dict(path=name,dev=info.st_dev,ino=info.st_ino,uid=info.st_uid,gid=info.st_gid,
                mode=info.st_mode,bytes=info.st_size,mtime=info.st_mtime_ns,
                ctime=info.st_ctime_ns,links=info.st_nlink)


def same_stat(info, expected):
    actual=stat_row(expected['path'],info)
    return all(actual[k]==expected[k] for k in STAT_KEYS)


@contextmanager
def descriptor(path, expected, facts, directory=False):
    event=dict(path=str(path),operation='directory' if directory else 'content',closed=False)
    facts.setdefault('descriptors',[]).append(event)
    fd=None;primary=None
    try:
        flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK
        if directory:flags|=os.O_DIRECTORY
        fd=os.open(path,flags)
        opened=os.fstat(fd);event['opened']=stat_row(expected['path'],opened)
        assert (stat.S_ISDIR(opened.st_mode) if directory else stat.S_ISREG(opened.st_mode)), 'Cache descriptor type refused'
        assert same_stat(opened,expected), 'Cache descriptor identity/size changed'
        yield fd
        event['after']=stat_row(expected['path'],os.fstat(fd))
        assert all(event['after'][k]==expected[k] for k in STAT_KEYS), 'Cache descriptor changed during read'
    except BaseException as error:
        primary=error;event['failure']=error_receipt(error);raise
    finally:
        if fd is not None:
            try:os.close(fd);event['closed']=True
            except BaseException as error:
                event['closeFailure']=error_receipt(error)
                if primary is None:raise
                primary.descriptorCloseFailures=[*getattr(primary,'descriptorCloseFailures',[]),error_receipt(error)]


def inventory(paths, facts):
    """Admit all roots jointly by bounded enumeration/stat before content I/O."""
    trees=[];facts.update(paths=list(map(str,paths)),trees=trees,entriesSeen=0,statBytes=0)
    try:
        for path in map(Path,paths):
            assert path.absolute()==path.resolve(), 'Cache path alias refused'
            try:info=path.lstat()
            except FileNotFoundError:trees.append(None);continue
            rows=[];trees.append(rows)
            def add(name, info):
                row=stat_row(name,info);rows.append(row)
                assert info.st_uid==os.getuid() and not stat.S_ISLNK(info.st_mode), 'Unowned cache path'
                assert stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), 'Special cache file'
                if stat.S_ISREG(info.st_mode):
                    facts['statBytes']+=info.st_size
                    assert facts['statBytes']<=CACHE_BYTES, 'Vite snapshot exceeds archive reserve'
                return row
            def count(name):
                facts['entriesSeen']+=1
                facts['lastEntry']=str(path/name)
                assert facts['entriesSeen']<=CACHE_ENTRIES, 'Vite cache inventory file ceiling'
            count('.');root=add('.',info)
            assert stat.S_ISDIR(info.st_mode),'Cache root is not a directory'
            pending=[root]
            while pending:
                parent=pending.pop()
                with descriptor(path/parent['path'],parent,facts,directory=True) as fd:
                    with os.scandir(fd) as entries:
                        for entry in entries:
                            name=str(Path(parent['path'])/entry.name)
                            count(name)  # Stop at the first surplus entry, before even its stat.
                            row=add(name,entry.stat(follow_symlinks=False))
                            if stat.S_ISDIR(row['mode']):pending.append(row)
            rows.sort(key=lambda row:row['path'])  # At most 4096 already-admitted rows.
        return trees
    except BaseException as error:
        error.cacheInventory=facts
        raise


def metadata(rows):
    return None if rows is None else [{k:r[k] for k in ('path',*STAT_KEYS)} for r in rows]


def read_file(path, row, facts, consume=lambda data:None):
    item=dict(path=str(path),readBytes=0);facts.setdefault('files',[]).append(item)
    digest=hashlib.sha256();remaining=row['bytes']
    try:
        with descriptor(path,row,facts) as fd:
            while True:
                data=os.read(fd,min(1024**2,remaining+1))
                item['readBytes']+=len(data)
                facts['contentBytesRead']=facts.get('contentBytesRead',0)+len(data)
                assert len(data)<=remaining, 'Cache file grew beyond admitted bytes'
                if not data:
                    assert remaining==0,'Cache file truncated during read'
                    break
                digest.update(data);consume(data);remaining-=len(data)
        assert same_stat(Path(path).lstat(),row), 'Cache pathname replaced during read'
        item['sha256']=digest.hexdigest()
        return item['sha256']
    except BaseException as error:
        item['failure']=error_receipt(error);error.cacheRead=facts;raise


def trees(paths, facts):
    rows=inventory(paths,facts)
    for path,group in zip(map(Path,paths),rows):
        for row in group or []:
            if stat.S_ISREG(row['mode']):row['sha256']=read_file(path/row['path'],row,facts)
    after={};facts['afterInventory']=after
    current=inventory(paths,after)
    assert list(map(metadata,current))==list(map(metadata,rows)), 'Cache changed while inventorying'
    return rows


def tree(path):
    return trees([path],{})[0]


def content(rows):
    return None if rows is None else [{k:r[k] for k in ['path','mode','sha256'] if k in r} for r in rows]


def copy_tree(source, destination, rows, facts):
    """Only admitted rows are copied; every source read uses the bounded FD path."""
    parents={}
    for row in rows:
        relative=Path(row['path']);target=destination/relative
        if stat.S_ISDIR(row['mode']):
            target.mkdir(mode=stat.S_IMODE(row['mode']))
            os.chmod(target,stat.S_IMODE(row['mode']),follow_symlinks=False)
            parents[str(relative)]=stat_row(str(relative),target.lstat())
            continue
        # The new destination parent is held by identity while creating the file.
        parent=parents[str(relative.parent)]
        # Directory mtime/size changes as our previous children are added.
        current=target.parent.lstat()
        assert (current.st_dev,current.st_ino,current.st_uid)==(parent['dev'],parent['ino'],parent['uid']), 'Archive parent replaced'
        parent=stat_row(parent['path'],current)
        fd=None;primary=None;event=dict(path=str(target),closed=False)
        facts.setdefault('destinations',[]).append(event)
        try:
            # Source descriptor admission occurs in read_file before any content is copied.
            with descriptor(target.parent,parent,facts,directory=True) as parent_fd:
                fd=os.open(target.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=parent_fd)
                event['opened']=stat_row(row['path'],os.fstat(fd))
                assert stat.S_ISREG(event['opened']['mode']) and event['opened']['uid']==os.getuid(), 'Archive descriptor refused'
                def output(data):
                    assert os.write(fd,data)==len(data),'Incomplete cache copy write'
                digest=read_file(source/relative,row,facts,output)
                assert digest==row['sha256'], 'Cache changed before copy'
                os.fchmod(fd,stat.S_IMODE(row['mode']))
                # Updating our directory is expected; retain its observed identity.
                parent.update(stat_row(parent['path'],os.fstat(parent_fd)))
                assert (parent['dev'],parent['ino'],parent['uid'])==(current.st_dev,current.st_ino,current.st_uid)
        except BaseException as error:
            primary=error;event['failure']=error_receipt(error);raise
        finally:
            if fd is not None:
                try:os.close(fd);event['closed']=True
                except BaseException as error:
                    event['closeFailure']=error_receipt(error)
                    if primary is None:raise
                    primary.descriptorCloseFailures=[*getattr(primary,'descriptorCloseFailures',[]),error_receipt(error)]


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
                after_keys=list(map(identity_key,item['membersAfter']))
                assert len(after_keys)==len(set(after_keys))==len(keys) and set(after_keys)==set(keys), 'RSS cohort birth/departure/duplicate during sample'
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
            item['beforeInventory']={}
            item['treesBefore'] = trees(self.paths,item['beforeInventory'])
            item['openFiles'] = self.owners(self.paths, self.checkout)
            allowed = set(map(identity_key,allowed))
            for row in item['openFiles']['owners']:
                assert identity_key(row['before'])==identity_key(row['after']) and identity_key(row['after']) in allowed, 'Unknown Vite cache owner'
            item['afterInventory']={}
            item['treesAfter'] = trees(self.paths,item['afterInventory'])
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
        facts=dict(name=name,destination=str(self.archive/name))
        self.observations.append({'copy':facts})
        try:
            facts['beforeInventory']={}
            before=inventory(self.paths,facts['beforeInventory'])
            assert list(map(metadata,before))==list(map(metadata,observed)), 'Cache changed before copy admission'
            destination=self.archive/name;destination.mkdir()
            for i,(path,rows) in enumerate(zip(self.paths,observed)):
                if rows is None:continue
                copy_tree(path,destination/str(i),rows,facts)
                assert content(tree(destination/str(i)))==content(rows), 'Cache archive bytes differ'
            facts['afterInventory']={}
            after=inventory(self.paths,facts['afterInventory'])
            assert list(map(metadata,after))==list(map(metadata,observed)), 'Cache changed during archive'
            write(destination/'inventory.json',observed)
        except BaseException as error:
            facts['failure']=error_receipt(error);raise

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
