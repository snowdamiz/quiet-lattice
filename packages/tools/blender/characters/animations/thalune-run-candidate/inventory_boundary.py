"""Complete task-local enumeration, including the immutable archive helper ports."""
import sys
sys.dont_write_bytecode=True
from assertion_guard import require_assertions
require_assertions(__debug__)
import os,stat
from pathlib import Path


def walk(root, facts, *, topdown=True, onerror=None, followlinks=False):
    facts.update(root=str(root),complete=False,directories=[])
    def failed(error):raise error
    try:
        info=Path(root).lstat()
        assert stat.S_ISDIR(info.st_mode),'Inventory root must be a directory'
        assert followlinks is False,'Inventory cannot follow directory links'
        for directory,dirs,files in os.walk(root,topdown=topdown,onerror=failed,followlinks=False):
            facts['directories'].append(dict(path=str(directory),directories=list(dirs),files=list(files)))
            yield directory,dirs,files
        facts['complete']=True
    except GeneratorExit:
        raise  # An abandoned partial iterator is never marked complete.
    except BaseException as error:
        from inspector import error_receipt
        facts['failure']=error_receipt(error)
        error.inventoryObservation=facts
        raise


def paths(root, facts=None):
    facts={} if facts is None else facts
    try:
        for directory,dirs,files in walk(root,facts):
            for name in dirs+files:
                path=Path(directory)/name;facts['pendingPath']=str(path)
                path.lstat()
                yield path
        facts.pop('pendingPath',None)
    except GeneratorExit:raise
    except BaseException as error:
        from inspector import error_receipt
        if getattr(error,'inventoryObservation',None) is not facts:facts['failure']=error_receipt(error)
        facts['complete']=False;error.inventoryObservation=facts;raise


def tree_bytes(root, facts):
    facts.update(bytes=0,entries=[])
    try:
        for path in paths(root,facts.setdefault('enumeration',{})):
            info=path.lstat();row=dict(path=str(path),mode=info.st_mode,bytes=info.st_size)
            facts['entries'].append(row)
            assert stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode),'Unsupported inventory entry'
            if not stat.S_ISDIR(info.st_mode):facts['bytes']+=info.st_size
        facts['complete']=True
        return facts['bytes']
    except BaseException as error:
        facts['complete']=False;error.byteInventory=facts;raise


def guarded_call(function, observations, *args, **kwargs):
    """Keep helper algorithms intact; make their enumeration ports fail closed."""
    namespace=getattr(function,'__func__',function).__globals__
    prior={key:(key in namespace,namespace.get(key)) for key in ['os','Path']}
    original_os=namespace.get('os',os)
    def observed_walk(root,topdown=True,onerror=None,followlinks=False):
        facts={'operation':function.__name__+'.walk'};observations.append(facts)
        return walk(root,facts,topdown=topdown,onerror=onerror,followlinks=followlinks)
    class OsPort:
        def __getattr__(self,key):return getattr(original_os,key)
        walk=staticmethod(observed_walk)
    class StrictPath(type(Path())):
        def rglob(self,pattern):
            assert pattern=='*','Unexpected helper inventory pattern'
            facts={'operation':function.__name__+'.rglob'};observations.append(facts)
            return paths(self,facts)
    try:
        namespace['os']=OsPort();namespace['Path']=StrictPath
        return function(*args,**kwargs)
    except BaseException as error:
        error.helperInventoryObservations=observations
        raise
    finally:
        for key,(existed,value) in prior.items():
            if existed:namespace[key]=value
            else:namespace.pop(key,None)
