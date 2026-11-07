import ast,sys,os,json,errno,hashlib,contextlib,signal
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
O=Path(__file__).parent;A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A))
# Use the reviewed original fixture builders, retaining actual dispatcher and final-inspection bodies.
source=A/'revision-07/green-repros/independent.py';tree=ast.parse(source.read_text());tree.body=[n for n in tree.body if not isinstance(n,(ast.For,ast.Expr)) or isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='exec']
space={'__name__':'review_fixture','__file__':str(O/'fixture-builders.py')};exec(compile(tree,str(source),'exec'),space)
native=space['native'];READY=space['READY'];rows=[]
def save(value):
 rows.append(value);(O/'additional-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(value['name'],value['status'],flush=True)
class ScanPort:
 def __init__(self,real,target,mode,events):self.real=real;self.target=target;self.mode=mode;self.events=events
 def __call__(self,path):
  if self.mode=='scan-open' and Path(path)==self.target:
   error=OSError(errno.EIO,'INJECTED_SCANDIR_OPEN_ERROR',str(path));self.events.append(dict(boundary='scandir',path=str(path),errno=error.errno));raise error
  stream=self.real(path);outer=self
  class Iterator:
   def __enter__(self):stream.__enter__();return self
   def __exit__(self,*args):return stream.__exit__(*args)
   def __iter__(self):return self
   def __next__(self):
    entry=next(stream)
    if Path(entry.path)!=outer.target or outer.mode!='entry-type':return entry
    class Entry:
     def __getattr__(self,key):return getattr(entry,key)
     def is_dir(self,*args,**kwargs):
      error=OSError(errno.EIO,'INJECTED_DIRENTRY_IS_DIR_ERROR',str(entry.path));outer.events.append(dict(boundary='DirEntry.is_dir',path=str(entry.path),errno=error.errno));raise error
    return Entry()
  return Iterator()
for mode in ['readable','scan-open','entry-type']:
 p,plan,adapter,jobs,video,mapping=space['final_fixture']('additional-packet-'+mode)
 hidden=p/'packet/extra-directory';hidden.mkdir();extra=hidden/'overbudget.bin'
 with extra.open('wb') as file:file.truncate(64*1024**2+1)
 events=[];port=ScanPort(os.scandir,hidden,mode,events)
 with patch.object(os,'scandir',port):result=native.run_sequence(READY,plan,{},adapter,lambda:None)
 assert signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
 assert jobs==native.JOBS and extra.stat().st_size==67108865
 assert result['status']=='HOLD'
 if mode=='entry-type':
  assert not events, 'The permissive is_dir boundary must not be used'
  assert result['outputInventory']['complete'] is True
  assert str(extra.relative_to(p/'packet')) in result['outputInventory']['paths']
  assert result['outputBytes']>=extra.stat().st_size
  assert result['terminalDelivery']['proof']['status']=='written'
  assert result['terminalDelivery']['packet']['status']=='written'
  assert json.loads((p/'proof/result.json').read_text())['status']=='HOLD'
  assert json.loads((p/'packet/integration-result.json').read_text())['status']=='HOLD'
 save(dict(name='packet-'+mode,status='PASS',injection=events,result=result,hiddenBytes=extra.stat().st_size,nativeProcesses=0))
# A partial enumeration closed by its consumer must never become complete.
import inventory_boundary as inventory
p=O/'abandoned-enumeration';p.mkdir();(p/'known').write_bytes(b'known');facts={};it=inventory.paths(p,facts);next(it);it.close();assert facts['complete'] is False
save(dict(name='abandoned-enumeration',status='PASS',facts=facts))
# Replay the same original observer boundary with an unbound path and two persistence schedules.
src=(A/'revision07-controls.py').read_text().split("for mode in ['hash-timeout'")[0]
src=src.replace("parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args();assert not args.report.exists()", "args=SimpleNamespace(report=O/'additional-observer-results.json')")
src=src.replace("O=Path(tempfile.mkdtemp(prefix='t02-r7-controls-',dir='/private/tmp'));A=Path(__file__).parent;sys.path.insert(0,str(A))", "O=O/'additional-observer';O.mkdir();A=A;sys.path.insert(0,str(A))")
src=src.replace("if mode=='path-error' and 'fault-armed-after-initial-observation' in events:fault()", "if mode=='path-error' and 'fault-armed-after-initial-observation' in events:fault()\n  if mode=='path-unbound' and 'fault-armed-after-initial-observation' in events:return str(p/'not-bound')")
src=src.replace("if mode=='stage-exit' else 'DeadlineExpired'", "if mode in ['stage-exit','path-unbound'] else 'DeadlineExpired'")
src=src.replace("mode not in ['stage-exit']", "mode not in ['stage-exit','path-unbound']")
ns={'__name__':'independent_observer_fixture','__file__':str(A/'revision07-controls.py'),'O':O,'A':A};exec(compile(src,str(A/'revision07-controls.py'),'exec'),ns)
for delivery in ['normal','helper-write','all-sinks']:
 ns['observer_case']('path-unbound',delivery);r=ns['RESULTS'][-1]
 assert r['result']['primaryFailure']['message'].startswith('Unbound CPU executable:')
 if delivery!='all-sinks':assert all(r['result']['terminalDelivery'][sink]['status']=='written' for sink in ['proof','packet'])
 save(dict(name='unbound-'+delivery,status='PASS',primary=r['result']['primaryFailure'],terminalDelivery=r['result']['terminalDelivery'],nativeProcesses=0))
print('completed',len(rows),'controls; all safe/refusal expectations')
