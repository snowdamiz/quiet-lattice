"""Finite packet write checks; no service, quota state, or process ownership."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import json,os,stat
from inventory_boundary import paths as inventory_paths
from pathlib import Path
from contract import METADATA_BYTES, FILE_COUNT, RECORD_BYTES, VIDEOS, STILLS, VIDEO_BYTES, IMAGE_BYTES
RESERVED={'failure.json','integration-result.json'}

def inventory(root):
    root=Path(root).resolve()
    result=dict(normalBytes=0,reservedBytes=0,files=0,reservedFiles=0,paths=[],totalBytes=0,complete=False,enumeration={})
    try:
        for p in inventory_paths(root,result['enumeration']):
            info=p.lstat();result['pendingPath']=str(p)
            assert not stat.S_ISLNK(info.st_mode),'Packet symlink refused'
            if stat.S_ISDIR(info.st_mode):continue
            assert stat.S_ISREG(info.st_mode),'Packet file kind refused'
            name=str(p.relative_to(root));size=info.st_size;result['paths'].append(name);result['files']+=1;result['totalBytes']+=size
            if name in VIDEOS:assert size<=VIDEO_BYTES,'Primary media byte ceiling'
            elif name in STILLS:assert size<=IMAGE_BYTES,'Still image byte ceiling'
            elif name in RESERVED:
                result['reservedBytes']+=size;result['reservedFiles']+=1
                assert size<=RECORD_BYTES,'Reserved record byte ceiling'
            else:result['normalBytes']+=size
        result.pop('pendingPath',None);result['complete']=True
        return result
    except BaseException as error:
        error.packetInventory=result
        raise


def before_write(root,target,count,*,atomic=False,reserved=False,metadata_limit=METADATA_BYTES,file_limit=FILE_COUNT,record_limit=RECORD_BYTES):
    root=Path(root).resolve();target=Path(target).absolute();name=str(target.relative_to(root))
    assert target.resolve()==target and type(count) is int and count>=0,'Packet target/count refused'
    assert name not in VIDEOS and not target.is_symlink()
    current=inventory(root)
    assert current['normalBytes']<=metadata_limit-2*record_limit,'Existing packet metadata ceiling'
    if reserved:
        assert name in RESERVED and count<=record_limit
        assert not target.exists(),'Reserved first/terminal record already exists; preserve it'
        assert current['reservedBytes']+count<=2*record_limit
        assert current['files']+1<=file_limit
    else:
        assert name not in RESERVED
        if atomic:assert not target.with_name(target.name+'.writing').exists(),'Interrupted packet write retained'
        # The old target remains while the temporary/new bytes exist. Check that peak, not net growth.
        assert current['normalBytes']+(0 if name in STILLS else count)<=metadata_limit-2*record_limit,'Aggregate packet metadata byte ceiling'
        assert name not in STILLS or count<=IMAGE_BYTES,'Still image byte ceiling'
        media_slot=len((VIDEOS | STILLS)-set(current['paths'])-{name})
        assert current['files']-current['reservedFiles']+1+media_slot<=file_limit-2,'Aggregate packet file-count ceiling'
    return current

def write_bytes(root,target,data,*,atomic=False,reserved=False):
    target=Path(target);before_write(root,target,len(data),atomic=atomic,reserved=reserved)
    if atomic:
        temp=target.with_name(target.name+'.writing')
        with temp.open('xb') as stream:stream.write(data)
        os.replace(temp,target)
    else:
        with target.open('xb') as stream:stream.write(data)

def write_json(root,target,value,*,reserved=False):
    write_bytes(root,target,(json.dumps(value,indent=2)+'\n').encode(),atomic=not reserved,reserved=reserved)

def first_failure(root,value):
    target=Path(root)/'failure.json'
    if target.exists():return # Keep the first failure verbatim.
    write_json(root,target,value,reserved=True)

def inspect(root):
    current=inventory(root)
    assert current['normalBytes']<=METADATA_BYTES-2*RECORD_BYTES and current['reservedBytes']<=2*RECORD_BYTES
    assert current['normalBytes']+current['reservedBytes']<=METADATA_BYTES and current['files']<=FILE_COUNT
    assert current['files']-current['reservedFiles']+len((VIDEOS | STILLS)-set(current['paths']))<=FILE_COUNT-2,'Packet reserved file slots consumed'
    assert not any(x.endswith('.writing') for x in current['paths']),'Interrupted packet write refused'
    return current
