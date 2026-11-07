"""Real traversal ports and dispatcher controls; all native boundaries remain inert."""
import sys,os,ast,json,errno,signal,time,tempfile,argparse,contextlib,subprocess,importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.dont_write_bytecode=True
parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args();assert not args.report.exists()
A=Path(__file__).parent;sys.path.insert(0,str(A));O=Path(tempfile.mkdtemp(prefix='t02-r8-controls-',dir='/private/tmp'))
import inventory_boundary as inventory,packet_budget as budget,inspector,caller,native189 as native
source=A/'revision-07/green-repros/independent.py';tree=ast.parse(source.read_text());tree.body=[n for n in tree.body if not isinstance(n,(ast.For,ast.Expr)) or isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='exec'];space={'__name__':'inert_fixture','__file__':str(O/'fixture.py')};exec(compile(tree,str(source),'exec'),space)
core=space['core'];READY=space['READY'];PLAN=space['PLAN'];rows=[]
def save(name,**value):
 rows.append(dict(name=name,status='PASS',**value));args.report.write_text(json.dumps(dict(cases=rows,count=len(rows),scratch=str(O)),indent=2)+'\n');print(name,'PASS',flush=True)
class ScanPort:
 def __init__(self,target,kind,operation='stat'):
  self.target=target;self.kind=kind;self.operation=operation;self.real=os.scandir;self.errors=[];self.calls=[];self.opened=0;self.closed=0
 def fail(self,entry=None):
  self.calls.append(dict(operation=self.operation,path=str(self.target)))
  if self.kind=='deadline':time.sleep(.2)
  if self.kind=='real-permission':
   parent=self.target.parent;mode=parent.stat().st_mode&0o777;parent.chmod(0)
   try:return entry.stat(follow_symlinks=False)
   except PermissionError as error:self.errors.append(error);raise
   finally:parent.chmod(mode)
  if self.kind=='permission':error=PermissionError(errno.EACCES,'CLASSIFICATION_PERMISSION',str(self.target))
  elif self.kind=='cancel':error=KeyboardInterrupt()
  elif self.kind=='timeout':error=subprocess.TimeoutExpired(['inert-classification'],.1,output=b'PARTIAL\x00\xff',stderr=b'ERR\x80')
  else:error=OSError(errno.EIO,'CLASSIFICATION_IO',str(self.target))
  error.future={'unknown':b'FACT\xfe'};self.errors.append(error);raise error
 def __call__(self,path):
  if self.operation=='open' and Path(path)==self.target:self.fail()
  stream=self.real(path);self.opened+=1;outer=self
  class Scan:
   def __enter__(self):stream.__enter__();return self
   def __exit__(self,*a):
    try:return stream.__exit__(*a)
    finally:outer.closed+=1
   def __iter__(self):return self
   def __next__(self):
    entry=next(stream)
    if Path(entry.path)!=outer.target:return entry
    if outer.operation=='next':outer.fail()
    class Entry:
     def __getattr__(self,key):return getattr(entry,key)
     def stat(self,*a,**k):
      assert k=={'follow_symlinks':False}
      if outer.operation=='stat':return outer.fail(entry)
      return entry.stat(*a,**k)
    return Entry()
  return Scan()
 def verify(self):assert self.opened==self.closed and self.calls

def fixture(name):
 root=O/name;root.mkdir();(root/'known').write_bytes(b'known');hidden=root/'hidden';hidden.mkdir();(hidden/'later').write_bytes(b'unknown');return root,hidden
spec=importlib.util.spec_from_file_location('binding_fixture',A/'bind-local.py');binding=importlib.util.module_from_spec(spec);spec.loader.exec_module(binding)
for route in ['packet','budget','inspect','index','bytes','binding']:
 for kind in ['permission','io']:
  root,hidden=fixture(route+'-'+kind);facts={};port=ScanPort(hidden,kind);target=root/'new.json'
  functions={'packet':lambda:budget.inventory(root),'budget':lambda:budget.before_write(root,target,2),'inspect':lambda:budget.inspect(root),'index':lambda:inspector.tree_index(root,set()),'bytes':lambda:inventory.tree_bytes(root,facts),'binding':lambda:binding.files(root)}
  with patch.object(os,'scandir',port):
   try:functions[route]()
   except BaseException as error:
    assert error is port.errors[0];failure=caller.error_receipt(error)
   else:raise AssertionError('Incomplete classification accepted')
  port.verify();observed=failure['details']['inventoryObservation'];assert observed['complete'] is False and observed['pendingPath']==str(hidden)
  assert observed['directories'][0]['entries'][-1]['path']==str(hidden) and not target.exists()
  assert failure['details']['future']['unknown']==repr(b'FACT\xfe')
  save(route+'-'+kind,failure=failure,scans=dict(opened=port.opened,closed=port.closed))
for kind,operation in [('permission','stat'),('io','stat'),('real-permission','stat'),('timeout','stat'),('cancel','stat'),('deadline','stat'),('io','next'),('permission','open')]:
 name='dispatcher-'+kind+'-'+operation;p,plan,adapter,jobs,video,mapping=space['final_fixture'](name);hidden=p/'packet/hidden';hidden.mkdir();(hidden/'unknown').write_bytes(b'unknown');port=ScanPort(hidden,kind,operation)
 # Exercise the exact retained timer at a short test duration; no native process exists.
 real_deadline=core['deadline']
 if kind=='deadline':adapter.core.deadline=lambda seconds:real_deadline(.025)
 with patch.object(os,'scandir',port):result=native.run_sequence(READY,plan,{},adapter,lambda:None)
 port.verify();assert jobs==native.JOBS and result['status']=='HOLD' and signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
 expected='PermissionError' if kind in ['permission','real-permission'] else 'KeyboardInterrupt' if kind=='cancel' else 'TimeoutExpired' if kind=='timeout' else 'DeadlineExpired' if kind=='deadline' else 'OSError'
 assert result['primaryFailure']['type']==expected
 assert result['primaryFailure']['details']['inventoryObservation']['complete'] is False
 assert 'outputBytes' not in result and result['outputInventory']['complete'] is False
 assert result['terminalDelivery']['proof']['status']=='written' and result['terminalDelivery']['packet']['status']=='failed'
 assert json.loads((p/'proof/result.json').read_text())['status']=='HOLD'
 save(name,result=result,scans=dict(opened=port.opened,closed=port.closed),faults=port.calls)
# Exact archive helper bodies stop before native/copy/removal ports on type-query failure.
src=(A/'revision07-controls.py').read_text().split("for mode in ['hash-timeout'")[0]
src=src.replace("parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args();assert not args.report.exists()","args=SimpleNamespace(report=O/'unused.json')")
src=src.replace("O=Path(tempfile.mkdtemp(prefix='t02-r7-controls-',dir='/private/tmp'));A=Path(__file__).parent;sys.path.insert(0,str(A))","O=O/'helper-context';O.mkdir();A=A;sys.path.insert(0,str(A))")
helpers={'__name__':'exact_helper_fixture','__file__':str(A/'revision07-controls.py'),'A':A,'O':O};exec(compile(src,str(A/'revision07-controls.py'),'exec'),helpers)
for kind in ['profile','private']:
 for fault in ['permission','io']:
  root=O/('helper-'+kind+'-'+fault);root.mkdir(mode=0o700);private=root/'private';private.mkdir(mode=0o700);calls=[];facts=[]
  if kind=='profile':
   namespace=helpers['core'];directory=private/'playwright_chromiumdev_profile-owned';directory.mkdir();hidden=directory/'hidden';hidden.mkdir();(hidden/'bytes').write_bytes(b'unknown')
   job=namespace['StationJob'].__new__(namespace['StationJob']);job.out=root/'out';job.out.mkdir();job.scratch=root/'scratch';job.scratch.mkdir();job.target='INERT';job.state={'drained':True,'profiles':[str(directory)]}
   function=job.archive;pos=();kwargs={'profile_namespace':private,'profile_prefixes':('playwright_chromiumdev_profile-',)};key='subprocess';old=namespace[key]
   def command(*a,**k):calls.append('native');raise AssertionError('Native boundary forbidden')
   namespace[key]=SimpleNamespace(run=command)
  else:
   namespace=helpers['browser'];hidden=private/'hidden';hidden.mkdir();(hidden/'bytes').write_bytes(b'unknown');function=namespace['preserve_private_tmp'];pos=(private,namespace['tmp_admission'](private),root/'copy');kwargs={'no_process_launched':True};key='shutil';old=namespace[key]
   def copy(*a,**k):calls.append('copy-or-remove');raise AssertionError('Copy/removal forbidden')
   namespace[key]=SimpleNamespace(copytree=copy,rmtree=copy)
  old_ports=(namespace['os'],namespace['Path']);port=ScanPort(hidden,fault)
  try:
   with patch.object(os,'scandir',port):
    try:inventory.guarded_call(function,facts,*pos,**kwargs)
    except BaseException as error:assert error is port.errors[0];failure=caller.error_receipt(error)
    else:raise AssertionError('Incomplete helper accepted')
   port.verify();assert not calls and (namespace['os'],namespace['Path'])==old_ports and facts[-1]['complete'] is False
   save('helper-'+kind+'-'+fault,failure=failure,observations=facts,calls=calls)
  finally:namespace[key]=old
# The actual first-job archive acceptance must stop the next dispatcher job.
source=(A/'revision07-controls.py').read_text();tree=ast.parse(source);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='archive_dispatch');text=ast.get_source_segment(source,node)
text=text.replace("'archive-dispatch'","'classification-archive-dispatch'").replace('f.truncate(1024**3+1)',"f.write(b'unknown')").replace('hidden.chmod(0);hidden_paths.append(hidden)','hidden_paths.append(hidden)')
text=text.replace("result=native.run_sequence(local,plan,{},adapter,lambda:None)","port=ScanPort(None,'permission')\n  with patch.object(os,'scandir',port):result=native.run_sequence(local,plan,{},adapter,lambda:None)\n  port.verify()")
# Derive the target from the actual job's archive out path, not a guessed path.
text=text.replace("hidden=self.out/'hidden';hidden.mkdir();p=hidden/'over-budget'","hidden=self.out/'hidden';hidden.mkdir();p=hidden/'over-budget';target_path.append(hidden)")
text=text.replace("hidden_paths=[];starts=[];handles=[]","hidden_paths=[];starts=[];handles=[];target_path=[]")
text=text.replace("with patch.object(os,'scandir',port):result=", "original_scan=port.__call__\n  def scan(path):\n   if target_path:port.target=target_path[0]\n   return original_scan(path)\n  with patch.object(os,'scandir',scan):result=")
# Reuse the real dispatcher fixture and its first-attempt/no-validator assertions.
helpers.update(ScanPort=ScanPort,save=lambda value:save('actual-archive-stop',result=value));exec(compile(text,str(A/'revision07-controls.py'),'exec'),helpers);helpers['archive_dispatch']()
for topdown in [True,False]:
 root,hidden=fixture('positive-'+str(topdown));outside=O/('outside-'+str(topdown));outside.mkdir();(outside/'secret').write_bytes(b'not-traversed');(root/'link').symlink_to(outside,target_is_directory=True);facts={}
 tuples=list(inventory.walk(root,facts,topdown=topdown));assert facts['complete'] is True and len(tuples)==2 and all(str(outside)!=p for p,_,_ in tuples)
 assert 'link' in next(files for p,_,files in tuples if p==str(root))
 assert [p for p,_,_ in tuples]==([str(root),str(hidden)] if topdown else [str(hidden),str(root)])
 save('positive-'+str(topdown),facts=facts,tuples=tuples)
root,hidden=fixture('pruning-refused');facts={};it=inventory.walk(root,facts);_,dirs,_=next(it);dirs.clear()
try:list(it)
except AssertionError as error:assert facts['complete'] is False;failure=caller.error_receipt(error)
else:raise AssertionError('Pruning accepted')
save('pruning-refused',failure=failure)
print(json.dumps(dict(status='PASS',controls=len(rows),nativeJobs=0)))
