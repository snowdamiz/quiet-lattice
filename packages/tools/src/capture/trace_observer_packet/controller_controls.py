"""Fixed R1 whole-controller cases from independent review; native command ports remain inert."""
import sys, pathlib, json, os, subprocess, copy, time
from unittest.mock import patch
OUT=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else pathlib.Path(__import__('tempfile').mkdtemp(prefix='t13-r1-controller-')).resolve()
OUT.mkdir(parents=True,exist_ok=True)
ROOT=pathlib.Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'packages/tools/src/capture/trace_observer_packet'))
import launch, freeze, metadata
boundary,proof,stages=launch.native_helpers(ROOT)
allresults=[]
for fault in ['positive','bootstrap17-write','bootstrap0-write','partial-constructor','observer-raw','observer-save','terminal-audit','ledger-growth','ledger-unreadable','terminal-ledger','terminal-publish','terminal-all-sinks']:
 case=OUT/('controller-v2-'+fault);case.mkdir()
 frozen=case/'frozen';frozen.mkdir();(frozen/'inert.ts').write_text('1234')
 if fault=='ledger-growth':(frozen/'second').write_text('5678')
 binary=case/'inert-binary';binary.write_bytes(b'inert executable, never launched')
 prefix='bwt-'+'2'*32
 ready={'frozenRoot':str(frozen),'root':str(ROOT),'binding':{'output':str(case/'out'),'fallback':str(case/'fallback'),'prefix':prefix,'node':freeze.NODE,'tsx':str(ROOT/'node_modules/inert'),'launchPath':'/usr/bin:/bin','browser':str(binary),'binaries':[{'path':str(binary),'sha256':metadata.digest(binary.read_bytes())}]}}
 bridge=json.loads((freeze.HERE/'local-binding.json').read_text())
 bridge_kernel=bridge['pythonKernel']
 ready['binding']['binaries'].append(next(row for row in bridge['binaries'] if row['path']==bridge_kernel))
 observed=[];created=[];writes=[];native=[];terminalTimers=[]
 rows=[{'pid':624240+i,'uid':os.getuid(),'birth':[1,i],'status':2,'pgid':624240+i} for i in range(6)]
 class Job(boundary.StationJob):
  def __init__(self,*a,**k):
   created.append(self); self.env=k['env'];self.released=False;self.ended=False;self.status_calls=0
   super().__init__(*a,**k)
  def start(self):
   if fault.startswith('bootstrap'):return super().start()
   self.root=rows[0];self.coalition_id=123;self.known={str(r['pid']):r for r in rows}
   private=pathlib.Path(self.env['TMPDIR']);profile=private/'playwright_chromiumdev_profile-fixture';profile.mkdir()
   metadata.atomic(self.out.parent/'capture/browser-launch.json',metadata.encode({'kind':'T13_BROWSER_LAUNCH_CHILD_PROCESS_V1','provenance':'BrowserServer.process() ChildProcess','prefix':prefix,'pid':rows[1]['pid'],'spawnfile':str(binary),'spawnargs':[str(binary),'--use-angle=metal','--user-data-dir='+str(profile)],'at':'2026-11-07T00:00:00Z','monotonicNs':'1'}))
   metadata.atomic(self.out.parent/'capture/kernel-request.json',metadata.encode({'prefix':prefix,'browserPid':rows[1]['pid'],'processes':[{'id':rows[3]['pid'],'type':'renderer'}]}))
   packet={'kind':'T13_TRACE_OBSERVER_V1','status':'observed','failure':None,'cleanupErrors':[],'portSettlement':{'kind':'ports-settled'},'summary':{'budgetQualified':False},'steps':[{}]*12,'applicability':{'missingControls':0},'totals':{**{k:freeze.BOUNDS[k] for k in ('preparations','frames','dependentPasses','preflightFences','controlFences','png','queries','segments')},'warmUpFrames':1080,'bytes':100,'events':24,'reads':6}}
   metadata.atomic(self.out.parent/'capture/packet.json',metadata.encode(packet));return self
  def status(self):
   self.status_calls+=1
   if self.status_calls>=2:
    self.ended=True
    if fault=='ledger-unreadable' and not (frozen/'hidden').exists():
     hidden=frozen/'hidden';hidden.mkdir();(hidden/'data').write_bytes(b'x'*16);hidden.chmod(0)
    if fault.startswith('terminal-') and fault!='terminal-audit':
     bad=self.out.parent/'late-fifo'
     if not bad.exists():os.mkfifo(bad)
    if fault in ('terminal-publish','terminal-all-sinks'):
     for directory in [self.out.parent] + ([case/'fallback'] if fault=='terminal-all-sinks' else []):
      collision=directory/'result.json.writing'
      if not collision.exists():collision.write_text('retained publication collision')
   boundary.write(self.scratch/'worker.json',{'root':self.root,'launch_complete':True,'exits':{'capture':0,'caffeinate':0} if self.ended else {}})
   return super().status()
  def members(self):
   if (self.scratch/'release').exists():self.released=True
   return [] if self.released else [rows[0]] if self.ended else rows
 def ident(pid):
  j=created[-1]
  if (getattr(j,'scratch',case)/'release').exists():j.released=True
  return None if j.released else next((r for r in rows if r['pid']==pid and (not j.ended or r is rows[0])),None)
 def tasks(_):
  j=created[-1];j.members();return {'live':0 if j.released else 1 if j.ended else 6}
 realwrite=boundary.write
 def write(path,value):
  p=pathlib.Path(path);writes.append(str(p))
  if p.name=='request.json' and fault=='partial-constructor':raise OSError('ORIGINAL_CONSTRUCTOR_WRITE')
  if p.name=='bootstrap.json' and fault.startswith('bootstrap'):raise OSError('SECONDARY_BOOTSTRAP_RECEIPT_WRITE')
  if p.name=='boundary.json' and fault=='observer-save' and created[-1].state['errors']:raise OSError('SECONDARY_WAIT_RECEIPT_WRITE')
  return realwrite(path,value)
 def command(argv,**kw):
  native.append(argv)
  if argv[0]=='/bin/ps':
   if fault.startswith('observer'):
    error=subprocess.TimeoutExpired(argv,kw['timeout'],output=b'PRIMARY_OBSERVER_STDOUT\xff',stderr=b'PRIMARY_OBSERVER_STDERR\xfe');error.future={'nested':b'PRIMARY_OBSERVER_UNKNOWN'};raise error
   commands=['fixture-root','fixture-browser','fixture --type=gpu-process','fixture --type=renderer','fixture --type=utility',bridge_kernel+' -I -B -c task_metadata_bridge '+str(frozen)]
   return subprocess.CompletedProcess(argv,0,'\n'.join(str(row['pid'])+' '+cmd for row,cmd in zip(rows,commands)),'')
  if argv[:2]==['/bin/launchctl','bootstrap']:
   p=subprocess.CompletedProcess(argv,17 if fault=='bootstrap17-write' else 0,'BOOTSTRAP_STDOUT_UNKNOWN\0','BOOTSTRAP_STDERR_UNKNOWN');p.future={'bytes':b'BOOTSTRAP_FUTURE'}
   observed.append({'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'future':repr(p.future)});return p
  if argv[:2]==['/bin/launchctl','print']:
   count=sum(a[:2]==['/bin/launchctl','print'] for a in native)
   return subprocess.CompletedProcess(argv,0 if fault=='terminal-audit' and count==2 else 1,'TERMINAL_STDOUT_UNKNOWN','TERMINAL_STDERR_UNKNOWN')
  if argv[:2]==['/bin/launchctl','bootout']:return subprocess.CompletedProcess(argv,0,'BOOTOUT_RAW_STDOUT','BOOTOUT_RAW_STDERR')
  raise AssertionError('FORBIDDEN NATIVE COMMAND '+repr(argv))
 def executable(pid):
  return bridge_kernel if pid==rows[5]['pid'] else str(binary)
 realledger=launch.ledger
 realhash=metadata.file_hash
 def growhash(path,cap,**kwargs):
  path=pathlib.Path(path)
  if fault=='ledger-growth' and path.parent==frozen:path.write_bytes(b'12345678')
  return realhash(path,cap,**kwargs)
 def ledger(path,*a,**k):
  if pathlib.Path(path)==frozen and k.get('hash_files',True):
   import signal
   terminalTimers.append(signal.getitimer(signal.ITIMER_REAL))
  return realledger(path,*a,**k)
 with patch.object(launch,'LIMITS',{**launch.LIMITS,'frozenBytes':8 if fault.startswith('ledger-') else launch.LIMITS['frozenBytes']}),patch.object(metadata,'file_hash',growhash),patch.object(boundary,'write',write),patch.object(boundary.subprocess,'run',command),patch.object(boundary,'identity',ident),patch.object(stages,'identity',ident),patch.object(stages,'coalition',return_value=[123,0]),patch.object(boundary,'coalition',return_value=[123,0]),patch.object(stages,'executable_path',executable),patch.object(boundary,'kernel_tasks',tasks),patch.object(proof,'kernel_tasks',tasks),patch.object(stages,'kernel_tasks',tasks),patch.object(stages.subprocess,'check_output',return_value=''),patch.object(launch,'ledger',ledger):
  result=launch.run_owned(ready,{'value':{},'sha256':'a'*64},{'readiness':{'sha256':'b'*64}},(boundary,proof,stages),job_factory=Job)
 (case/'returned.json').write_text(json.dumps(result,indent=2))
 outputs='\n'.join(p.read_text(errors='replace') for p in case.rglob('*.json'))
 row={'fault':fault,'candidate':result['candidate'],'failure':result['failure'],'secondary':result['secondary'],'settlement':result['physicalSettlement'],'observedOracle':observed,'nativePortCalls':native,'terminalTimers':terminalTimers,'rawBootstrapRetained':'BOOTSTRAP_STDOUT_UNKNOWN' in outputs,'rawObserverRetained':'PRIMARY_OBSERVER_UNKNOWN' in outputs,'beforeDrain':result['beforeDrain']}
 allresults.append(row)
 if fault=='positive':
  assert result['candidate'] is True,result
  assert (case/'out/capture/kernel-release.json').exists()
  assert len(result['beforeDrain']['observer']['processes'])==6
  helpers=[p for p in result['beforeDrain']['observer']['processes'] if p['binary']==bridge_kernel]
  assert len(helpers)==1 and helpers[0]['role']=='owned-launch-helper' and helpers[0]['admitted']
  assert terminalTimers and all(timer[0]>0 for timer in terminalTimers)
 elif fault.startswith('bootstrap'):
  assert result['candidate'] is False and observed and row['rawBootstrapRetained']
  assert result['partialAllocation']['registered'] is False
  assert result['partialAllocation']['bootstrapProducer']['registeredMayExist'] == (fault=='bootstrap0-write')
  assert any(argv[:2]==['/bin/launchctl','bootout'] for argv in native) == (fault=='bootstrap0-write')
 elif fault.startswith('observer'):
  assert result['candidate'] is False and result['failure']['type']=='TimeoutExpired'
  assert metadata.base64.b64decode(result['failure']['attributes']['future']['nested']['base64'])==b'PRIMARY_OBSERVER_UNKNOWN'
  assert metadata.base64.b64decode(result['failure']['attributes']['output']['base64']).endswith(b'\xff')
  if fault=='observer-save':assert any('SECONDARY_WAIT_RECEIPT_WRITE' in json.dumps(e) for e in result['secondary'])
 elif fault=='partial-constructor':
  assert result['candidate'] is False and pathlib.Path(result['partialAllocation']['scratch']).exists()
 elif fault=='terminal-audit':
  assert result['candidate'] is False and result['physicalSettlement']=='UNPROVED'
  assert 'TERMINAL_STDOUT_UNKNOWN' in json.dumps(result['nativeProducerFacts'])
 elif fault.startswith('ledger-'):
  assert result['candidate'] is False and result['frozenTerminalLedger']['complete'] is False
  assert result['terminalPublication']['durable']
  if fault=='ledger-unreadable':(frozen/'hidden').chmod(0o700)
 elif fault.startswith('terminal-'):
  assert result['candidate'] is False and result['outputLedger']['complete'] is False
  assert result['physicalSettlement']=='DRAINED_ARCHIVED_AUDITED'
  assert terminalTimers and all(timer[0]>0 for timer in terminalTimers)
  assert result['terminalPublication']['durable'] == (fault!='terminal-all-sinks')
  if fault=='terminal-publish':assert result['terminalPublication']['receipt']['path']==str(case/'fallback/result.json')
  if fault=='terminal-all-sinks':assert 'result.json' in result['evidence']['undurable']
  import io,contextlib
  stderr=io.StringIO()
  ready['binding']['pythonLauncher']=str(pathlib.Path(sys.executable).resolve());ready['binding']['pythonKernel']='INERT_KERNEL'
  with patch.object(launch,'admit',return_value=(ready,{'value':{}},{})),patch.object(launch,'consume'),patch.object(launch,'run_owned',return_value=result),patch.object(proof,'executable_path',return_value='INERT_KERNEL'),contextlib.redirect_stderr(stderr):
   code=launch.main(['--readiness','inert','--readiness-sha256','a','--grant','inert','--grant-sha256','b'],helpers=lambda _:(boundary,proof,stages))
  assert code==1 and 'Ledger entry type' in stderr.getvalue() and 'DRAINED_ARCHIVED_AUDITED' in stderr.getvalue()
(OUT/'controller-results.json').write_text(json.dumps(allresults,indent=2))
print(json.dumps([{'case':r['fault'],'candidate':r['candidate'],'primary':r['failure'],'physical':r['settlement'],'bootstrapRawRetained':r['rawBootstrapRetained'],'observerRawRetained':r['rawObserverRetained'],'terminalTimers':r['terminalTimers']} for r in allresults],indent=2))
