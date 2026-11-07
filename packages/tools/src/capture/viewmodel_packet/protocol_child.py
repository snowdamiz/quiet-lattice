"""CPU-only actual helper/receipt fixture; all native process ports are inert."""
import sys,os,json,tempfile,subprocess,contextlib,copy,hashlib
from pathlib import Path
from unittest.mock import patch
E=Path(__file__).resolve().parent; P=Path(os.environ.get('VM_PACKET_UNDER_TEST', E));sys.path.insert(0,str(P))
assert len(sys.argv)==5 and sys.argv[1]=='--inert-cpu-fixture', 'CPU fixture arguments required'
index=int(sys.argv[3])
import native,boundary,bindings,caller
from test_boundary import Repo,digest
sys.path.insert(0,str(bindings.HELPERS));import round4_job_boundary as jb,run_round4_browser_proof as proof,run_round4_remaining8 as stages
frozen=json.loads((P/'readiness.json').read_text()); summaries=[]
for mode in [sys.argv[4]]:
 assert mode in ('success','publication','all-sinks','drain-refused','after-return'), 'Unknown inert fixture mode'
 root=Path(sys.argv[2]);repo=Repo.__new__(Repo);repo.root=root/'repo';repo.packet=repo.root/'packet';repo.ready_path=root/'ready.json';repo.ready=json.loads(repo.ready_path.read_text());repo.plan=json.loads((repo.packet/'inventory.json').read_text());repo.head=boundary.git(repo.root,'rev-parse','HEAD').decode().strip()
 spec=repo.plan['units'][index];paths=repo.ready['paths'][spec['id']]; trace=[]; temp=tempfile.mkdtemp; ports=(subprocess.run,subprocess.check_output,subprocess.Popen); rows=[{'pid':990001+i,'birth':[1,i],'uid':os.getuid(),'pgid':990001,'status':2} for i in range(4)]; binary=frozen['bindings']['browserBinary']; drained=False
 def mkdtemp(*a,**kw):kw['dir']=str(root);return temp(*a,**kw)
 def start(job):
  trace.append('inert-start');job.root=rows[0];job.coalition_id=111111
  private=Path(json.loads((job.scratch/'request.json').read_text())['env']['TMPDIR']); profile=private/'playwright_chromiumdev_profile-inert';profile.mkdir(mode=0o700)
  (job.scratch/'capture_stdout.txt').write_text(f'<launching> {binary} --use-angle=metal --user-data-dir={profile}\n<launched> pid={rows[0]["pid"]}\n')
 def status(job):
  if getattr(job,'tick',False):job.state['exits']['capture']=0
  job.tick=True;return job.state
 def drain(job,*_):
  global drained
  trace.append('inert-drain');drained=True;job.state.update(drained=mode!='drain-refused',clean=mode!='drain-refused');return job.state
 def run(argv,**kw):
  if argv[0]=='git':
   with patch.object(subprocess,'run',ports[0]),patch.object(subprocess,'check_output',ports[1]),patch.object(subprocess,'Popen',ports[2]):return ports[0](argv,**kw)
  assert argv[:2] in [['/bin/launchctl','bootout'],['/bin/launchctl','print']],argv
  trace.append(['inert-command',*argv[:2]]);return subprocess.CompletedProcess(argv,113 if argv[1]=='print' else 0,stdout='',stderr='')
 def check_output(argv,**kw):
  if argv[0]=='git':
   with patch.object(subprocess,'run',ports[0]),patch.object(subprocess,'check_output',ports[1]),patch.object(subprocess,'Popen',ports[2]):return ports[1](argv,**kw)
  assert argv==['/usr/bin/pmset','-g','assertions'];trace.append(['inert-command',*argv]);return ''
 def forbidden(*a,**kw):raise AssertionError('NO_NATIVE_PROCESS')
 def capture(ready,spec,paths,record):
  result=native.capture(ready,spec,paths,record)
  assert result['released'] and result['terminal']['namespace_absent']
  assert result['allocations'][0]['admission'] is result['privateRelease']['admission']
  trace.append('actual-native-returned-released')
  record['sharedAdmission']=result['privateRelease']['admission']
  record['unknownCycle']={'byte':b'\x00\xff'};record['unknownCycle']['self']=record['unknownCycle']
  for name in spec['files']:(Path(paths['output'])/name).write_text('INERT OUTPUT '+name)
  return result
 def decoder(ready,spec,paths,record,frozen):trace.append('inert-decoder');record['inspection']={'valid':True,'inert':True}
 def runner(*args):return caller.run_unit(*args,capture=capture,decoder=decoder,cache_copy=lambda r,e,rec:rec.update(initialCacheBytes=0),final_verify=lambda _: {})
 def writer(path,value):
  if str(path).endswith('.consumed.json'):return boundary.exclusive_json(path,value,cap=20*boundary.MIB)
  if mode=='all-sinks':raise OSError('ALL_SINKS_FAILURE')
  answer=boundary.exclusive_json(path,value,cap=20*boundary.MIB)
  if mode=='publication' and Path(path).name=='result.json':raise OSError('AFTER_REAL_RESULT_WRITE')
  return answer
 def emit(_):raise OSError('STDERR_SINK_FAILURE')
 with contextlib.ExitStack() as stack:
  for owner,name,value in [(tempfile,'mkdtemp',mkdtemp),(subprocess,'run',run),(subprocess,'check_output',check_output),(subprocess,'Popen',forbidden),(jb.StationJob,'start',start),(jb.StationJob,'status',status),(jb.StationJob,'drain',drain),(jb.StationJob,'members',lambda _:[] if drained else rows),(stages,'current_commands',lambda _: {r['pid']:binary+('' if i==0 else ' --type='+['gpu-process','renderer','utility'][i-1]) for i,r in enumerate(rows)}),(stages,'executable_path',lambda _:binary),(caller,'HERE',repo.packet)]:stack.enter_context(patch.object(owner,name,value))
  for module in (jb,proof,stages):
   for name,value in [('kernel_tasks',lambda _: {'live':0}),('identity',lambda pid: None if drained else next(r for r in rows if r['pid']==pid)),('coalition',lambda _: [111111,0])]:
    if hasattr(module,name):stack.enter_context(patch.object(module,name,value))
  try:
   kwargs={'writer':writer} if mode in ('publication','all-sinks') else {}
   code,result=caller.main(repo.ready_path,spec['id'],Path(paths['grant']),enabled=True,verifier=lambda _: {},runner=runner,emit=emit,**kwargs)
  except BaseException as error:
   print(json.dumps({'refused':str(error),'trace':trace}));sys.exit(1)
 disk=json.loads(Path(result['path']).read_text()) if result['path'] else None
 summary={'case':mode,'root':str(root),'head':repo.head,'code':code,'durable':result['durable'],'memoryChecksPassed':result['record']['checksPassed'],'diskKeys':list(disk) if disk else [],'trace':trace,'resultPath':result['path'],'consumptionPath':paths['consumption']}
 (root/('child-'+str(index)+'-'+mode+'.json')).write_text(json.dumps(summary,indent=2)+'\n')
 print(json.dumps(summary));sys.exit(1 if mode=='after-return' else code)
