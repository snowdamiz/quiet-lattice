"""Thalune task resource observations. Sampled stops, never an OS quota."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import hashlib, json, os, shutil, stat, subprocess, time
from pathlib import Path
from contextlib import contextmanager, ExitStack
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


def descriptor_failure(error):
    # These owned facts remain attached to the original exception and outer receipt.
    # Re-embedding them at every ancestor would recursively multiply the evidence.
    details={k:v for k,v in vars(error).items() if k not in ['cacheRead','cacheInventory']}
    try:message=str(error)
    except BaseException:message='<original error could not be stringified>'
    return dict(type=type(error).__name__,message=message,
                details=json.loads(json.dumps(details,default=str)),
                retainedObservationFields=[k for k in ['cacheRead','cacheInventory'] if hasattr(error,k)])


@contextmanager
def descriptor(path, expected, facts, directory=False, dir_fd=None, strict=True):
    event=dict(path=str(path),parentFd=dir_fd,operation='directory' if directory else 'content',closed=False)
    facts.setdefault('descriptors',[]).append(event)
    fd=None;primary=None
    try:
        flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK
        if directory:flags|=os.O_DIRECTORY
        fd=os.open(path,flags,dir_fd=dir_fd)
        opened=os.fstat(fd);event['opened']=stat_row(expected['path'],opened)
        assert (stat.S_ISDIR(opened.st_mode) if directory else stat.S_ISREG(opened.st_mode)), 'Cache descriptor type refused'
        assert same_stat(opened,expected), 'Cache descriptor identity/size changed'
        yield fd
        event['after']=stat_row(expected['path'],os.fstat(fd))
        keys=STAT_KEYS if strict else ('dev','ino','uid','gid','mode')
        assert all(event['after'][k]==expected[k] for k in keys), 'Cache descriptor changed during read'
        linked=os.stat(path,dir_fd=dir_fd,follow_symlinks=False)
        assert all(stat_row(str(path),linked)[k]==expected[k] for k in keys), 'Cache directory/file link replaced'
    except BaseException as error:
        primary=error;event['failure']=descriptor_failure(error);raise
    finally:
        if fd is not None:
            try:os.close(fd);event['closed']=True
            except BaseException as error:
                event['closeFailure']=error_receipt(error)
                if primary is None:raise
                primary.descriptorCloseFailures=[*getattr(primary,'descriptorCloseFailures',[]),error_receipt(error)]


def directory_chain(path, facts, stack, optional=False):
    """Hold every ancestor; no full-path OS open may resolve through a link."""
    path=Path(path)
    assert path.is_absolute() and '..' not in path.parts and len(path.parts)<=CACHE_ENTRIES, 'Cache path form refused'
    parent=None
    for part in path.parts:
        try:info=os.stat(part,dir_fd=parent,follow_symlinks=False)
        except FileNotFoundError:
            if optional:return None
            raise
        assert stat.S_ISDIR(info.st_mode) and info.st_uid in [0,os.getuid()], 'Cache ancestor type/owner refused'
        expected=stat_row(part,info)
        parent=stack.enter_context(descriptor(part,expected,facts,directory=True,dir_fd=parent,strict=False))
    return parent


def admitted_inventory(paths, facts, stack):
    """All roots share the stat budget; hold admitted directory FDs until use ends."""
    trees=[];views=[];facts.update(paths=list(map(str,paths)),trees=trees,entriesSeen=0,statBytes=0)
    try:
        for path in map(Path,paths):
            assert path.absolute()==path.resolve(), 'Cache path alias refused'
            fd=directory_chain(path,facts,stack,optional=True)
            if fd is None:trees.append(None);views.append(None);continue
            rows=[];view={};trees.append(rows);views.append(view)
            def add(name, info):
                row=stat_row(name,info);rows.append(row)
                assert info.st_uid==os.getuid() and not stat.S_ISLNK(info.st_mode), 'Unowned cache path'
                assert stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), 'Special cache file'
                if stat.S_ISREG(info.st_mode):
                    facts['statBytes']+=info.st_size
                    assert facts['statBytes']<=CACHE_BYTES, 'Vite snapshot exceeds archive reserve'
                return row
            def count(name):
                facts['entriesSeen']+=1;facts['lastEntry']=str(path/name)
                assert facts['entriesSeen']<=CACHE_ENTRIES, 'Vite cache inventory file ceiling'
            count('.');root=add('.',os.fstat(fd));view['.']=(fd,root)
            pending=[root]
            while pending:
                parent=pending.pop();parent_fd=view[parent['path']][0]
                with os.scandir(parent_fd) as entries:
                    for entry in entries:
                        name=str(Path(parent['path'])/entry.name);count(name)
                        row=add(name,entry.stat(follow_symlinks=False))
                        if stat.S_ISDIR(row['mode']):
                            child=stack.enter_context(descriptor(entry.name,row,facts,directory=True,dir_fd=parent_fd))
                            view[name]=(child,row);pending.append(row)
            rows.sort(key=lambda row:row['path'])
        return trees,views
    except BaseException as error:
        error.cacheInventory=facts;raise


def inventory(paths, facts):
    with ExitStack() as stack:return admitted_inventory(paths,facts,stack)[0]


def metadata(rows):
    return None if rows is None else [{k:r[k] for k in ('path',*STAT_KEYS)} for r in rows]


def read_file(path, row, facts, consume=lambda data:None, parent_fd=None):
    item=dict(path=str(path),readBytes=0);facts.setdefault('files',[]).append(item)
    digest=hashlib.sha256();remaining=row['bytes']
    try:
        with ExitStack() as stack:
            if parent_fd is None:parent_fd=directory_chain(Path(path).parent,facts,stack)
            fd=stack.enter_context(descriptor(Path(path).name,row,facts,dir_fd=parent_fd))
            while True:
                data=os.read(fd,min(1024**2,remaining+1))
                item['readBytes']+=len(data)
                facts['contentBytesRead']=facts.get('contentBytesRead',0)+len(data)
                assert len(data)<=remaining, 'Cache file grew beyond admitted bytes'
                if not data:
                    assert remaining==0,'Cache file truncated during read'
                    break
                digest.update(data);consume(data);remaining-=len(data)
            assert same_stat(os.stat(Path(path).name,dir_fd=parent_fd,follow_symlinks=False),row), 'Cache pathname replaced during read'
        item['sha256']=digest.hexdigest()
        return item['sha256']
    except BaseException as error:
        item['failure']=error_receipt(error);error.cacheRead=facts;raise


def trees(paths, facts):
    with ExitStack() as stack:
        rows,views=admitted_inventory(paths,facts,stack)
        for path,group,view in zip(map(Path,paths),rows,views):
            for row in group or []:
                if stat.S_ISREG(row['mode']):
                    row['sha256']=read_file(path/row['path'],row,facts,parent_fd=view[str(Path(row['path']).parent)][0])
        after={};facts['afterInventory']=after
        current=inventory(paths,after)
        assert list(map(metadata,current))==list(map(metadata,rows)), 'Cache changed while inventorying'
        return rows


def tree(path):
    return trees([path],{})[0]


def content(rows):
    return None if rows is None else [{k:r[k] for k in ['path','mode','sha256'] if k in r} for r in rows]


def create_directory(name, parent_fd, facts, stack, mode=0o700):
    os.mkdir(name,mode=mode,dir_fd=parent_fd)
    row=stat_row(name,os.stat(name,dir_fd=parent_fd,follow_symlinks=False))
    return stack.enter_context(descriptor(name,row,facts,directory=True,dir_fd=parent_fd,strict=False))


def copy_tree(source, destination, rows, facts, view, destination_fd, stack):
    """Source and destination descendants use only held, admitted parent FDs."""
    parents={'.':destination_fd}
    for row in rows:
        relative=Path(row['path']);target=destination/relative
        if stat.S_ISDIR(row['mode']):
            fd=destination_fd if str(relative)=='.' else create_directory(relative.name,parents[str(relative.parent)],facts,stack,stat.S_IMODE(row['mode']))
            parents[str(relative)]=fd
            continue
        fd=None;primary=None;event=dict(path=str(target),closed=False)
        facts.setdefault('destinations',[]).append(event)
        try:
            parent_fd=parents[str(relative.parent)]
            fd=os.open(relative.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=parent_fd)
            event['opened']=stat_row(row['path'],os.fstat(fd))
            assert stat.S_ISREG(event['opened']['mode']) and event['opened']['uid']==os.getuid(), 'Archive descriptor refused'
            def output(data):assert os.write(fd,data)==len(data),'Incomplete cache copy write'
            digest=read_file(source/relative,row,facts,output,parent_fd=view[str(relative.parent)][0])
            assert digest==row['sha256'], 'Cache changed before copy'
            os.fchmod(fd,stat.S_IMODE(row['mode']))
        except BaseException as error:
            primary=error;event['failure']=descriptor_failure(error);raise
        finally:
            if fd is not None:
                try:os.close(fd);event['closed']=True
                except BaseException as error:
                    event['closeFailure']=error_receipt(error)
                    if primary is None:raise
                    primary.descriptorCloseFailures=[*getattr(primary,'descriptorCloseFailures',[]),error_receipt(error)]


def archive_json(name, value, parent_fd):
    fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=parent_fd)
    with os.fdopen(fd,'wb') as stream:stream.write((json.dumps(value,indent=2)+'\n').encode())


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
        with ExitStack() as stack:
            if self.lock_identity is None:
                parent_fd=directory_chain(self.lock.parent,allocation,stack)
                lock_fd=create_directory(self.lock.name,parent_fd,allocation,stack)
                info=os.fstat(lock_fd);self.lock_identity=(info.st_dev,info.st_ino,info.st_uid)
                allocation.update(created=True,identity=self.lock_identity)
            self.active=True
            parent_fd=directory_chain(self.archive.parent,allocation,stack)
            archive_fd=create_directory(self.archive.name,parent_fd,allocation,stack)
            archive_json('lease.json',dict(lock=str(self.lock), identity=self.lock_identity, paths=list(map(str,self.paths))),archive_fd)
        assert self.check()==self.initial, 'Cache changed around lease acquisition'
        self.copy('before', self.initial)

    def copy(self, name, observed):
        facts=dict(name=name,destination=str(self.archive/name))
        self.observations.append({'copy':facts})
        try:
            with ExitStack() as stack:
                facts['beforeInventory']={}
                before,views=admitted_inventory(self.paths,facts['beforeInventory'],stack)
                assert list(map(metadata,before))==list(map(metadata,observed)), 'Cache changed before copy admission'
                archive_fd=directory_chain(self.archive,facts,stack)
                destination=self.archive/name;destination_fd=create_directory(name,archive_fd,facts,stack)
                for i,(path,rows,view) in enumerate(zip(self.paths,observed,views)):
                    if rows is None:continue
                    root_fd=create_directory(str(i),destination_fd,facts,stack,stat.S_IMODE(rows[0]['mode']))
                    copy_tree(path,destination/str(i),rows,facts,view,root_fd,stack)
                    assert content(tree(destination/str(i)))==content(rows), 'Cache archive bytes differ'
                facts['afterInventory']={}
                after=inventory(self.paths,facts['afterInventory'])
                assert list(map(metadata,after))==list(map(metadata,observed)), 'Cache changed during archive'
                archive_json('inventory.json',observed,destination_fd)
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
