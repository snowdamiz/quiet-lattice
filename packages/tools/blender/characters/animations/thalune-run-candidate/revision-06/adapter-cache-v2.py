import sys,os,json,ast,tempfile,hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode=True
A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A));import caller,resource_admission as res
O=Path(__file__).resolve().parent;root=Path(tempfile.mkdtemp(prefix='adapter-cache-',dir=O)).resolve();(root/'packet').mkdir();(root/'proof').mkdir();parent=root/'parent';parent.mkdir();cache=parent/'cache';cache.mkdir();file=cache/'data';file.write_bytes(b'abcdefgh')
ready=json.loads((A/'readiness.json').read_text());pl=json.loads((A/'native189-plan.json').read_text());pl.update(viteCachePaths=[str(cache)],cacheLeasePath=str(root/'spent-lock'));p=root/'native189-plan.json';p.write_text(json.dumps(pl))
local={**ready,'packetRoot':str(root/'packet'),'proofRoot':str(root/'proof'),'captureSeconds':600,'cleanupSeconds':60,'bindings':[*ready['bindings'],dict(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest())]}
f=A/'retained-station/round4_job_boundary.py';t=ast.parse(f.read_text());t.body=[n for n in t.body if not isinstance(n,ast.ImportFrom) or n.module!='round4_capture_children'];core=dict(__name__='inert_exact',__file__=str(f),identity=lambda _:None,LIBPROC=None,UnsafeCaptureGroup=RuntimeError);exec(compile(t,str(f),'exec'),core)
a=caller.StationAdapter.__new__(caller.StationAdapter);a.ready=local;a.grant={'authorizationId':'INERT'};a.resourceControls=True;a.cacheLease=None;a.core=SimpleNamespace(deadline=core['deadline'],identity=lambda p:dict(pid=p,birth=[1,2],uid=os.getuid()))
events=[];handles=[]
def reached(*args):events.append('PRIVATE_ALLOCATION_BOUNDARY_REACHED');raise RuntimeError('REVIEW_STOP_BEFORE_PRIVATE_ALLOCATION')
a.temp=SimpleNamespace(create_private_tmp=reached);actual_run=a.run
def run(d,h):handles.append(h);return actual_run(d,h)
a.run=run;real_open,real_close=os.open,os.close;live=set();opens=[];moved=root/'moved'
def opening(p,flags,*args,**kw):
 if Path(p)==file and not flags&os.O_DIRECTORY:
  parent.rename(moved);parent.symlink_to(moved,target_is_directory=True);fd=real_open(p,flags,*args,**kw);live.add(fd);opens.append(dict(path=str(p),resolved=str(Path(p).resolve()),ancestorLink=parent.is_symlink()));return fd
 return real_open(p,flags,*args,**kw)
def closing(fd):
 real_close(fd)
 if fd in live:parent.unlink();moved.rename(parent);live.remove(fd)
with patch.object(caller,'HERE',root),patch.object(res,'open_owners',lambda *args:dict(owners=[])),patch.object(os,'open',opening),patch.object(os,'close',closing):
 result=caller.run_sequence(local,a,root/'packet',root/'proof')
assert events==['PRIVATE_ALLOCATION_BOUNDARY_REACHED'] and opens and not live and len(handles)==1
receipt=handles[0]['receipt'];assert receipt['primaryFailure']['message']=='REVIEW_STOP_BEFORE_PRIVATE_ALLOCATION'
assert (root/'spent-lock').is_dir() and (Path(handles[0]['path']).parent/'vite-cache-retention/before/0/data').read_bytes()==b'abcdefgh'
(O/'adapter-cache-results.json').write_text(json.dumps(dict(status='DEFECT_REPRODUCED',scratch=str(root),result=result,receipt=receipt,events=events,opens=opens,nativeAllocations=0),indent=2))
print('DEFECT_REPRODUCED: actual caller dispatch/StationAdapter.prepare accepts ancestor-linked cache reads and reaches private allocation boundary; 0 allocations')
