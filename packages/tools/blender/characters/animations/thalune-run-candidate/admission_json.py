"""Bounded single-snapshot JSON for this candidate's grants and receipts."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import hashlib, json, os, stat
from pathlib import Path

LIMIT=2*1024**2

def snapshot(path, expected=None, limit=LIMIT):
    path=Path(path);facts=dict(path=str(path),limitBytes=limit,readBytes=0)
    try:
        before=path.lstat();facts['before']=dict(mode=before.st_mode,bytes=before.st_size,dev=before.st_dev,ino=before.st_ino)
        assert stat.S_ISREG(before.st_mode) and before.st_size<=limit,'Admission JSON type/size refused before read'
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,'rb',buffering=0) as stream:
            opened=os.fstat(stream.fileno())
            assert stat.S_ISREG(opened.st_mode) and opened.st_size<=limit,'Admission JSON opened type/size refused'
            assert (opened.st_dev,opened.st_ino)==(before.st_dev,before.st_ino),'Admission JSON replaced before open'
            data=stream.read(limit+1);facts['readBytes']=len(data)
            after=os.fstat(stream.fileno())
        assert len(data)<=limit and len(data)==opened.st_size,'Admission JSON grew/truncated'
        assert (opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),'Admission JSON changed during read'
        digest=hashlib.sha256(data).hexdigest();facts['sha256']=digest
        assert expected is None or digest==expected,'Admission JSON hash mismatch'
        value=json.loads(data)
        assert isinstance(value,dict),'Admission JSON object required'
        return dict(value=value,sha256=digest,bytes=len(data),observation=facts)
    except BaseException as error:
        error.admissionObservation=facts
        raise

def read(path, expected=None):return snapshot(path,expected)['value']
