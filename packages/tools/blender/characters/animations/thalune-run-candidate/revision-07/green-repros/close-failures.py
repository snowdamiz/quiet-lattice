import os,sys,json,subprocess,contextlib
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
O=Path(__file__).parent;A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A))
import caller,resource_admission as res
p=O/'all-close';p.mkdir();c=p/'cache';c.mkdir();(c/'data').write_bytes(b'abcdefgh');obs=[]
lease=res.CacheLease([c],p,p/'lock',p/'archive',obs,lambda *a:dict(owners=[]));lease.acquire()
op,rd,cl=os.open,os.read,os.close;fds={};closes=[];sourceError=subprocess.TimeoutExpired(['fixture-source-read'],1,output=b'ORIGINAL\x00\xff',stderr=b'STDE\x80');sourceError.future={'raw':b'UNKNOWN\xfe'}
def opening(n,flags,*a,**kw):
 path=Path(n) if Path(n).is_absolute() else fds[kw['dir_fd']]/n;fd=op(n,flags,*a,**kw);fds[fd]=path;return fd
def reading(fd,n):
 if fds[fd]==c/'data':raise sourceError
 return rd(fd,n)
def closing(fd):
 cl(fd);v=dict(fd=fd,path=str(fds[fd]));closes.append(v);e=OSError('CLOSE_'+str(len(closes)));e.fdFact=v;raise e
with patch.object(os,'open',opening),patch.object(os,'read',reading),patch.object(os,'close',closing):
 try:lease.copy('failed',lease.initial)
 except BaseException as e:error=e
 else:raise AssertionError('expected copy refusal')
assert error is sourceError and len(error.descriptorCloseFailures)==len(closes)
for fd in fds:
 try:os.fstat(fd)
 except OSError:pass
 else:raise AssertionError('fd survived')
receipt=caller.error_receipt(error);assert receipt['details']['output']==repr(sourceError.output) and receipt['details']['future']['raw']==repr(sourceError.future['raw'])
assert (p/'archive/failed/0/data').exists() and (p/'archive/before/0/data').read_bytes()==b'abcdefgh' and (c/'data').read_bytes()==b'abcdefgh' and (p/'lock').exists()
(O/'close-failures-results.json').write_text(json.dumps(dict(status='PASS',originalIdentity=True,closeErrors=len(closes),closes=closes,failure=receipt,observations=obs),indent=2));print('PASS original raw TimeoutExpired and all',len(closes),'close failures retained; every real FD closed')
