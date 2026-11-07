"""Fixed R1 whole-controller cases from independent review; native command ports remain inert."""
import sys, pathlib, json, os, subprocess, copy, time, threading
from unittest.mock import patch
OUT=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else pathlib.Path(__import__('tempfile').mkdtemp(prefix='t13-r1-controller-')).resolve()
OUT.mkdir(parents=True,exist_ok=True)
ROOT=pathlib.Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'packages/tools/src/capture/trace_observer_packet'))
import launch, freeze, metadata
boundary,proof,stages=launch.native_helpers(ROOT)
allresults=[]
cases = ['live-writer-private','live-writer-output','live-writer-frozen','namespace-cache','namespace-mode-error','namespace-mode-ignored','helper-read-failure','helper-ancestor','bootstrap-timeout','bootstrap-decode','bootstrap-bootout-error','predrain-stall','positive','bootstrap17-write','bootstrap0-write','partial-constructor','observer-raw','observer-save','terminal-audit','ledger-growth','ledger-unreadable','terminal-ledger','terminal-publish','terminal-all-sinks']
selected=sys.argv[2:] or cases
assert all(case in cases for case in selected)
for fault in selected:
 case=OUT/('controller-v2-'+fault);case.mkdir()
 frozen=case/'frozen';frozen.mkdir();(frozen/'inert.ts').write_text('1234')
 if fault=='ledger-growth':(frozen/'second').write_text('5678')
 binary=case/'inert-binary';binary.write_bytes(b'inert executable, never launched')
 prefix='bwt-'+'2'*32
 ready={'frozenRoot':str(frozen),'root':str(ROOT),'binding':{'output':str(case/'out'),'fallback':str(case/'fallback'),'prefix':prefix,'node':freeze.NODE,'tsx':str(ROOT/'node_modules/inert'),'launchPath':'/usr/bin:/bin','browser':str(binary),'binaries':[{'path':str(binary),'sha256':metadata.digest(binary.read_bytes())}]}}
 bridge=json.loads((freeze.HERE/'local-binding.json').read_text())
 bridge_kernel=bridge['pythonKernel']
 ready['binding']['binaries'].append(next(row for row in bridge['binaries'] if row['path']==bridge_kernel))
 observed=[];created=[];writes=[];native=[];terminalTimers=[];owned_child=[];read_fds=[];payload_reads=[];pre_timers=[];ancestor_swapped=[];live_writes=[]
 rows=[{'pid':624240+i,'uid':os.getuid(),'birth':[1,i],'status':2,'pgid':624240+i} for i in range(6)]
 class Job(boundary.StationJob):
  def __init__(self,*a,**k):
   created.append(self); self.env=k['env'];self.released=False;self.ended=False;self.status_calls=0
   super().__init__(*a,**k)
  def start(self):
   if fault.startswith('bootstrap'):return super().start()
   if fault=='predrain-stall':
    child=subprocess.Popen([sys.executable,'-I','-B','-c',"import sys; print('ready',flush=True); sys.stdin.buffer.read(1)"],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    owned_child.append(child);assert child.stdout.readline()==b'ready\n'
   self.root=rows[0];self.coalition_id=123;self.known={str(r['pid']):r for r in rows}
   private=pathlib.Path(self.env['TMPDIR']);profile=private/'playwright_chromiumdev_profile-fixture';profile.mkdir()
   if fault.startswith('live-writer-'):
    target={'live-writer-private':private,'live-writer-output':self.out.parent,'live-writer-frozen':frozen}[fault]
    (target/'writing').write_bytes(b'')
    transient=target/'deps_temp';transient.mkdir();(transient/'entry').write_bytes(b'cache')
   if fault.startswith('namespace-'):
    # Actual native failure shape: an unrelated tsx cache survives profile/scratch archival.
    cache=private/'tsx-501';cache.mkdir(mode=0o755);cache.chmod(0o755)
    (cache/'cache-entry').write_bytes(b'CPU fixture of retained native cache\0\xff')
    for name,mode in [('empty',0o750),('readonly',0o550),('shared',0o1770)]:
     directory=cache/name;directory.mkdir();directory.chmod(mode)
    (profile/'profile-entry').write_bytes(b'profile archived before namespace')
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
  def drain(self,*args,**kwargs):
   result=super().drain(*args,**kwargs)
   for child in owned_child:
    child.stdin.close();assert child.wait(timeout=3)==0;child.stdout.close()
   return result
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
   if fault in ('bootstrap-timeout','bootstrap-bootout-error'):
    error=subprocess.TimeoutExpired(argv,kw['timeout'],output=b'BOOTSTRAP_PARTIAL\xff',stderr=b'BOOTSTRAP_STDERR\xfe');error.future={'uncertainty':'command dispatched; completion unknown'};raise error
   if fault=='bootstrap-decode':raise UnicodeDecodeError('utf-8',b'BOOTSTRAP_RAW\xff',13,14,'invalid start byte')
   p=subprocess.CompletedProcess(argv,17 if fault=='bootstrap17-write' else 0,'BOOTSTRAP_STDOUT_UNKNOWN\0','BOOTSTRAP_STDERR_UNKNOWN');p.future={'bytes':b'BOOTSTRAP_FUTURE'}
   observed.append({'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'future':repr(p.future)});return p
  if argv[:2]==['/bin/launchctl','print']:
   count=sum(a[:2]==['/bin/launchctl','print'] for a in native)
   return subprocess.CompletedProcess(argv,0 if fault=='terminal-audit' and count==2 else 1,'TERMINAL_STDOUT_UNKNOWN','TERMINAL_STDERR_UNKNOWN')
  if argv[:2]==['/bin/launchctl','bootout'] and fault=='bootstrap-bootout-error':
   error=subprocess.TimeoutExpired(argv,kw['timeout'],output=b'BOOTOUT_PARTIAL\xff');error.future={'release':'UNKNOWN'};raise error
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
  target=({'live-writer-private':pathlib.Path(created[-1].env['TMPDIR']),'live-writer-output':case/'out','live-writer-frozen':frozen}.get(fault) if created else None)
  if target is not None and pathlib.Path(path)==target and k.get('hash_files') is False and not live_writes:
   go,done=threading.Event(),threading.Event();errors=[];stat=os.stat
   def writer():
    try:
     assert go.wait(3)
     if fault=='live-writer-output':(target/'deps_temp').rename(target/'deps')
     else:(target/'writing').write_bytes(b'ordinary owned live bytes')
    except BaseException as error:errors.append(error)
    finally:done.set()
   def observe_stat(name,*args,**kwargs):
    match=kwargs.get('dir_fd') is not None and str(name)==('deps_temp' if fault=='live-writer-output' else 'writing') and not live_writes
    if match and fault=='live-writer-output':live_writes.append(str(target));go.set();assert done.wait(3)
    info=stat(name,*args,**kwargs)
    if match and fault!='live-writer-output':live_writes.append(str(target));go.set();assert done.wait(3)
    return info
   worker=threading.Thread(target=writer);worker.start()
   try:
    with patch.object(os,'stat',observe_stat):return realledger(path,*a,**k)
   finally:go.set();worker.join(3);assert not worker.is_alive() and not errors
  if pathlib.Path(path)==frozen and k.get('hash_files',True):
   import signal
   terminalTimers.append(signal.getitimer(signal.ITIMER_REAL))
  return realledger(path,*a,**k)
 real_open,real_read,real_fsync,real_close=metadata.os.open,metadata.os.read,metadata.os.fsync,metadata.os.close
 real_chmod=metadata.os.fchmod
 def chmod(fd,mode):
  if __import__('stat').S_ISDIR(os.fstat(fd).st_mode) and fault.startswith('namespace-mode-'):
   if fault=='namespace-mode-ignored':return
   error=OSError('DIRECTORY_MODE_FAILED');error.unknown=b'RAW_DIRECTORY_MODE\xff';raise error
  return real_chmod(fd,mode)
 capture=case/'out/capture';held=case/'out/capture-held'
 def opening(path,flags,*args,**kwargs):
  target=str(path)==str(capture/'browser-launch.json') or (str(path)=='browser-launch.json' and kwargs.get('dir_fd') is not None)
  if fault.startswith('helper-') and target and not flags & (os.O_WRONLY|os.O_DIRECTORY):
   if fault=='helper-ancestor':capture.rename(held);capture.symlink_to(held,target_is_directory=True);ancestor_swapped.append(True)
   fd=real_open(path,flags,*args,**kwargs);info=os.fstat(fd);read_fds.append((fd,info.st_dev,info.st_ino));return fd
  return real_open(path,flags,*args,**kwargs)
 def reading(fd,size):
  info=os.fstat(fd)
  if fault=='helper-read-failure' and (fd,info.st_dev,info.st_ino) in read_fds:
   if payload_reads:
    error=OSError('PRIMARY_RETAINED_READ');error.unknown=b'RAW_UNKNOWN\xff';raise error
   size=1
  raw=real_read(fd,size)

  if fault.startswith('helper-'):
   info=os.fstat(fd)
   if (fd,info.st_dev,info.st_ino) in read_fds:payload_reads.append(len(raw))
  return raw
 def closing(fd):
  info=os.fstat(fd);tracked=(fd,info.st_dev,info.st_ino) in read_fds
  real_close(fd)
  if fault=='helper-read-failure' and tracked:raise OSError('SECONDARY_RETAINED_CLOSE')
 def syncing(fd):
  target=case/'out/before-physical-drain.json.writing'
  if fault=='predrain-stall' and target.exists() and os.fstat(fd).st_ino==target.stat().st_ino:
   import signal
   pre_timers.append(signal.getitimer(signal.ITIMER_REAL));assert pre_timers[-1][0]>0,'missing product pre-drain timer'
   assert owned_child[0].poll() is None
   while True:signal.pause()  # The actual product deadline, with its own handler, must interrupt.
  return real_fsync(fd)
 with patch.object(metadata.os,'fchmod',chmod),patch.object(metadata.os,'open',opening),patch.object(metadata.os,'read',reading),patch.object(metadata.os,'fsync',syncing),patch.object(metadata.os,'close',closing),patch.object(launch,'LIMITS',{**launch.LIMITS,'frozenBytes':8 if fault.startswith('ledger-') else launch.LIMITS['frozenBytes']}),patch.object(metadata,'file_hash',growhash),patch.object(boundary,'write',write),patch.object(boundary.subprocess,'run',command),patch.object(boundary,'identity',ident),patch.object(stages,'identity',ident),patch.object(stages,'coalition',return_value=[123,0]),patch.object(boundary,'coalition',return_value=[123,0]),patch.object(stages,'executable_path',executable),patch.object(boundary,'kernel_tasks',tasks),patch.object(proof,'kernel_tasks',tasks),patch.object(stages,'kernel_tasks',tasks),patch.object(stages.subprocess,'check_output',return_value=''),patch.object(launch,'ledger',ledger):
  result=launch.run_owned(ready,{'value':{},'sha256':'a'*64},{'readiness':{'sha256':'b'*64}},(boundary,proof,stages),job_factory=Job)
 assert stages.os is os and all(module.Path is pathlib.Path for module in (boundary,proof,stages))
 for child in owned_child:
  if child.poll() is None:child.kill();child.wait(timeout=3);raise AssertionError('mandatory drain did not reap owned control child')
 if capture.is_symlink():capture.unlink();held.rename(capture)
 (case/'returned.json').write_text(json.dumps(result,indent=2))
 outputs='\n'.join(p.read_text(errors='replace') for p in case.rglob('*.json'))
 row={'fault':fault,'candidate':result['candidate'],'failure':result['failure'],'secondary':result['secondary'],'settlement':result['physicalSettlement'],'observedOracle':observed,'nativePortCalls':native,'terminalTimers':terminalTimers,'rawBootstrapRetained':'BOOTSTRAP_STDOUT_UNKNOWN' in outputs,'rawObserverRetained':'PRIMARY_OBSERVER_UNKNOWN' in outputs,'beforeDrain':result['beforeDrain']}
 row['retainedReadControl']={'openedDescriptors':read_fds,'payloadReadCounts':payload_reads,'ancestorSwapped':bool(ancestor_swapped)}
 row['preDrainTimers']=pre_timers
 row['ownedCPUChildren']=[{'pid':child.pid,'argv':child.args,'observedExit':child.returncode,'waited':child.returncode is not None} for child in owned_child]
 allresults.append(row)
 if fault.startswith('live-writer-'):
  assert live_writes and result['candidate'] is True,result['failure']
  assert result['frozenTerminalLedger']['complete'] and result['outputLedger']['complete']
  assert len(result['latestLiveResourceSamples'])==4
  assert all(s['sampleComplete'] and not s['complete'] and not s['quotaGuaranteed'] and s['contentBytesRead']==0 for s in result['latestLiveResourceSamples'].values())
  if fault=='live-writer-output':assert any(s['transitions'] for s in result['latestLiveResourceSamples'].values())
 elif fault=='namespace-cache':
  assert result['candidate'] is True and result['physicalSettlement']=='DRAINED_ARCHIVED_AUDITED',result['secondary']
  assert not pathlib.Path(created[-1].env['TMPDIR']).exists()
  cache=case/'out/preserved-private-tmp/tsx-501'
  assert (cache/'cache-entry').read_bytes()==b'CPU fixture of retained native cache\0\xff'
  for name,mode in [('',0o755),('empty',0o750),('readonly',0o550),('shared',0o1770)]:
   assert __import__('stat').S_IMODE((cache/name).stat().st_mode)==mode
  assert (case/'out/owned_job/preserved_playwright_chromiumdev_profile-fixture/profile-entry').read_bytes()==b'profile archived before namespace'
 elif fault.startswith('namespace-mode-'):
  assert result['candidate'] is False and result['physicalSettlement']=='UNPROVED'
  assert pathlib.Path(created[-1].env['TMPDIR']).exists() and (case/'out/preserved-controller-scratch').exists()
  assert result['outputLedger']['complete'] and result['terminalPublication']['durable']
  if fault=='namespace-mode-error':assert 'RAW_DIRECTORY_MODE' in json.dumps(result['secondary']) or metadata.base64.b64encode(b'RAW_DIRECTORY_MODE\xff').decode() in json.dumps(result['secondary'])
 if fault=='helper-read-failure':
  assert result['candidate'] is False and payload_reads==[1]
  assert 'PRIMARY_RETAINED_READ' in json.dumps(result['failure'])
  assert 'SECONDARY_RETAINED_CLOSE' in json.dumps(result['failure'])
  record=result['retainedReadFacts'][0]
  assert metadata.base64.b64decode(record['raw_base64'])==b'{' and record['descriptor']['complete'] is False
  assert metadata.base64.b64decode(record['failure']['attributes']['unknown']['base64'])==b'RAW_UNKNOWN\xff'
  for fd,_,_ in read_fds:
   try:os.fstat(fd)
   except OSError:pass
   else:raise AssertionError('failed retained read descriptor leaked')
  assert result['terminalPublication']['durable']
 elif fault=='helper-ancestor':
  assert ancestor_swapped and result['candidate'] is False
  assert not payload_reads, payload_reads
  assert result['beforeDrain']['observer']['structured_launch']['admitted_ever'] is False
  for fd,_,_ in read_fds:
   try:os.fstat(fd)
   except OSError:pass
   else:raise AssertionError('retained read descriptor leaked')
 elif fault=='predrain-stall':
  assert pre_timers and pre_timers[0][0]>0
  assert result['physicalSettlement']=='DRAINED_ARCHIVED_AUDITED' and result['candidate'] is False
  assert owned_child[0].returncode==0
  assert 'IODeadline' in json.dumps(result['secondary'])
  assert result['beforeDrain']['complete'] is True
  assert result['terminalPublication']['durable']
 elif fault in ('bootstrap-timeout','bootstrap-decode','bootstrap-bootout-error'):
  assert result['failure']['type'] in ('TimeoutExpired','UnicodeDecodeError')
  assert result['partialAllocation']['bootstrapProducer']['registeredMayExist'] is True
  bootouts=[a for a in native if a[:2]==['/bin/launchctl','bootout']]
  assert bootouts==[['/bin/launchctl','bootout',result['partialAllocation']['target']]]
  assert result['physicalSettlement']=='UNPROVED' and result['candidate'] is False
  if fault!='bootstrap-decode':assert metadata.base64.b64decode(result['failure']['attributes']['output']['base64'])==b'BOOTSTRAP_PARTIAL\xff'
  if fault=='bootstrap-bootout-error':
   stopped=[e for e in result['secondary'] if e['type']=='TimeoutExpired']
   assert len(stopped)==1 and metadata.base64.b64decode(stopped[0]['attributes']['output']['base64'])==b'BOOTOUT_PARTIAL\xff'
   assert stopped[0]['attributes']['future']['release']=='UNKNOWN'
  assert result['terminalPublication']['durable']
 elif fault=='positive':
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
