"""One gated fresh Ulgani5 variant; separate --finalize proves controller drain.

No waiting controller, Blender, source save, bake, export or CPU-stage replay.
A defined parent subset authorizes sequential invocations with a fresh consumed
per-invocation gate. Reuse only finalized current-source/harness/hash-bound cases.
"""
from pathlib import Path
import argparse,datetime,hashlib,json,os,re,shutil,signal,struct,subprocess,sys,time,zlib
root=Path.cwd();base=root/'.claude/pause/characters-resume';validation=root/'assets/renders/characters/validate';sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
assert root==Path('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41')
p=argparse.ArgumentParser();p.add_argument('--verify-only',action='store_true');p.add_argument('--finalize',action='store_true');p.add_argument('--variant');p.add_argument('--attempt',default='attempt-01');args=p.parse_args();variants=[f'ulgani_{kind}{i}' for kind,n in [('head',6),('suit',4)] for i in range(1,n+1)];assert args.variant is None or args.variant in variants;assert re.fullmatch(r'attempt-\d{2,}',args.attempt)
ready_path=validation/'ulgani-review5-cpu-ready.json';ready=json.loads(ready_path.read_text());assert ready['stage_count']==16 and len(ready['artifacts'])==61
assert sha(root/'assets/blend/characters/ulgani.blend')==ready['source_sha256']=='06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b'
assert sha(root/'packages/client/public/models/characters/ulgani.glb')==ready['export_sha256']=='9b956af47acd35440db346fffa971a063b17b963b79457b67b018788bdf27682'
assert sha(root/ready['cpu_stage_record']['path'])==ready['cpu_stage_record']['sha256']
for item in ready['artifacts']+ready['dialogue_support']['artifacts']:assert sha(root/item['path'])==item['sha256'],item['path']
prep_path=validation/'ulgani-review5-capture-only-preparation.json';prep=json.loads(prep_path.read_text());assert prep['cpu_ready']['sha256']==sha(ready_path)
for item in prep['helpers']+prep['harness']:assert sha(root/item['path'])==item['sha256'],item['path']
identity={'source_sha256':ready['source_sha256'],'export_sha256':ready['export_sha256'],'cpu_ready_sha256':sha(ready_path),'harness_sha256':hashlib.sha256(json.dumps(prep['harness'],sort_keys=True).encode()).hexdigest()}
cache_path=validation/'ulgani-review5-browser-cache.json';cache=json.loads(cache_path.read_text()) if cache_path.exists() else {'identity':identity,'completed':{}}
assert cache['identity']==identity

observer_events=[]
def processes(observer_command=None, observer_timeout=2):
 # This exact helper appears in its own snapshot. Exclude its PID only after
 # communicate() has completed and reaped it; all other process rows stay live data.
 command=observer_command or ['ps','-axo','pid=,ppid=,pgid=,lstart=,comm=']
 event={'started_utc':utc(),'command':command}
 observer=subprocess.Popen(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 event.update(pid=observer.pid,pgid=observer.pid)
 def group_members():
  # Signal permission is not process-group liveness on Darwin. A bounded
  # secondary ps probe is reaped first; it is in our controller group, not
  # this dedicated observer group, so it cannot count itself as a member.
  probe=subprocess.Popen(['ps','-axo','pid=,pgid=,stat='],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:output,error=probe.communicate(timeout=1)
  except subprocess.TimeoutExpired:
   probe.kill();probe.communicate(timeout=1);raise
  event.setdefault('group_probes',[]).append({'pid':probe.pid,'exit_code':probe.returncode,'reaped':True})
  if probe.returncode:raise subprocess.CalledProcessError(probe.returncode,probe.args,output,error)
  return [{'pid':int(a[0]),'state':a[2]} for line in output.splitlines() if len(a:=line.split())==3 and int(a[1])==observer.pid]
 def group_exists():return bool(group_members())
 def drain_helper():
  for sig in (signal.SIGTERM,signal.SIGKILL):
   members=group_members()
   if not members:break
   if all(x['state'].startswith('Z') for x in members):continue
   try:os.killpg(observer.pid,sig)
   except ProcessLookupError:pass
   except PermissionError:
    remaining=group_members()
    if any(not x['state'].startswith('Z') for x in remaining):raise
   try:observer.communicate(timeout=.2)
   except subprocess.TimeoutExpired:pass
  observer.communicate(timeout=1)
  deadline=time.monotonic()+2
  while group_exists() and time.monotonic()<deadline:time.sleep(.02)
  assert not group_exists(),'Observation helper group survived its bounded cleanup'
 try:
  output,error=observer.communicate(timeout=observer_timeout)
  if observer.returncode!=0:
   drain_helper();raise subprocess.CalledProcessError(observer.returncode,command,output,error)
  if group_exists():
   drain_helper();raise RuntimeError('Observation helper exited but left a live child')
 except BaseException as exc:
  try:drain_helper()
  finally:
   event.update(completed_utc=utc(),exit_code=observer.returncode,reaped=observer.returncode is not None,group_absent=not group_exists(),error=repr(exc));observer_events.append(event)
  raise
 rows={}
 for line in output.splitlines():
  a=line.strip().split(None,8)
  if len(a)==9:rows[int(a[0])]={'pid':int(a[0]),'ppid':int(a[1]),'pgid':int(a[2]),'fingerprint':' '.join(a[3:8]),'executable':a[8]}
 contained_self=observer.pid in rows
 rows.pop(observer.pid,None)
 event.update(completed_utc=utc(),exit_code=observer.returncode,reaped=True,group_absent=True,self_row_present=contained_self,excluded_reaped_observer_pid=observer.pid);observer_events.append(event)
 return rows

def png_size(path):
 data=path.read_bytes();assert data[:8]==b'\x89PNG\r\n\x1a\n';at=8;compressed=bytearray();header=None;ended=False
 while at<len(data):
  length=struct.unpack_from('>I',data,at)[0];kind=data[at+4:at+8];payload=data[at+8:at+8+length];crc=struct.unpack_from('>I',data,at+8+length)[0];assert zlib.crc32(kind+payload)&0xffffffff==crc
  if kind==b'IHDR':header=struct.unpack('>IIBBBBB',payload)
  if kind==b'IDAT':compressed.extend(payload)
  at+=length+12
  if kind==b'IEND':ended=True;break
 assert ended and header and header[6]==0 and at==len(data)
 w,h,depth,color,_,_,_=header;channels={0:1,2:3,3:1,4:2,6:4}[color];decoded=zlib.decompress(compressed);assert len(decoded)==h*(1+(w*channels*depth+7)//8)
 return [w,h]

def finalized(entry):
 assert entry['identity']==identity and entry['status']=='FINALIZED_DRAINED'
 for item in entry['artifacts']:assert sha(root/item['path'])==item['sha256']
 rows=processes()
 for item in entry['processes']:
  assert item['pid'] not in rows or rows[item['pid']]['fingerprint']!=item['fingerprint'],'Recorded owned process is still alive'
 return True
for entry in cache['completed'].values():finalized(entry)
if args.verify_only:
 print('ULGANI5_CAPTURE_READY',16,61,'completed_variants',list(cache['completed']),'no runtime launched',flush=True);sys.exit(0)
assert args.variant
if args.variant in cache['completed']:
 print('ULGANI5_CAPTURE_REUSED',args.variant,'verified current identity and13outputs;no runtime launched',flush=True);sys.exit(0)
jobdir=base/'ulgani5-capture'/args.attempt/args.variant;report_path=jobdir/'report.json'
if args.finalize:
 report=json.loads(report_path.read_text());assert report['status']=='CAPTURED_CHILDREN_DRAINED_CONTROLLER_EXIT_PENDING' and report['exit_code']==0
 entry={**report,'status':'FINALIZED_DRAINED','finalized_utc':utc()};finalized(entry);cache['completed'][args.variant]=entry;cache_path.write_text(json.dumps(cache,indent=2)+'\n');print('ULGANI5_VARIANT_FINALIZED',args.variant,entry['finalized_utc'],flush=True);sys.exit(0)
assert not (base/'hold-ulgani5-gpu').exists()
assert not jobdir.exists();gate=base/f'gpu-review-release-ulgani5-{args.variant}.json';authorization=json.loads(gate.read_text());assert authorization['parent_gpu_go'] is True and args.variant in authorization['allowed_variants'];assert all(v in variants for v in authorization['allowed_variants']);assert authorization['identity']==identity and authorization['preparation_sha256']==sha(prep_path)
outdir=root/'assets/renders/review/characters/ulgani-review5'/args.attempt;target=outdir/'ulgani'/args.variant;assert not target.exists();jobdir.mkdir(parents=True);gate.rename(jobdir/'consumed-gate.json');log=jobdir/'capture.log';log.write_text('');written=jobdir/'written.json';command=['pnpm','exec','tsx','packages/tools/src/capture/ulgani5-review.ts','--variant',args.variant,'--out-dir',str(outdir.relative_to(root)),'--written',str(written)]
report={'identity':identity,'preparation_sha256':sha(prep_path),'variant':args.variant,'attempt':args.attempt,'started_utc':utc(),'controller_pid':os.getpid(),'controller_pgid':os.getpgrp(),'command':command,'outdir':str(target.relative_to(root)),'log':str(log.relative_to(root)),'gate':authorization,'processes':[],'profiles':[],'cleanup':[],'status':'starting'}
known={os.getpid():processes()[os.getpid()]};profiles=set();children=[]
def save():report['processes']=list(known.values());report['profiles']=sorted(profiles);report['observer_lifecycles']=observer_events.copy();report_path.write_text(json.dumps(report,indent=2)+'\n')
def observe(persist=True):
 rows=processes();owned={pid for pid,item in known.items() if pid in rows and rows[pid]['fingerprint']==item['fingerprint']}
 while True:
  found={pid for pid,item in rows.items() if item['ppid'] in owned}
  if found<=owned:break
  owned|=found
 for pid in owned:
  if pid in rows and (pid not in known or rows[pid]['fingerprint']==known[pid]['fingerprint']):known[pid]=rows[pid]
 ids=[str(pid) for pid in owned if pid in rows]
 if ids:
  commands=subprocess.run(['ps','-p',','.join(ids),'-o','command='],capture_output=True,text=True).stdout
  for name in re.findall(r'--user-data-dir=([^\s]+)',commands):
   path=Path(name)
   if path.name.startswith('playwright_chromiumdev_profile-'):profiles.add(str(path))
 if persist:save()
 return rows

def wait_for_capture_children(wait_children,timeout=5):
 # A sampler timeout must not skip waiting/reaping the assertion or any peer.
 for child in wait_children:
  event={'pid':child.pid,'started_utc':utc()}
  try:event['exit_code']=child.wait(timeout=timeout)
  except Exception as exc:event['error']=repr(exc)
  event['completed_utc']=utc();report.setdefault('child_waits',[]).append(event)
 save()

def cleanup():
 run={'started_utc':utc()};report.setdefault('cleanup_runs',[]).append(run)
 report['owned_cleanup_settled']=False;errors=[];deadline=time.monotonic()+12
 def error(stage,exc,**detail):
  event={'utc':utc(),'stage':stage,'error':repr(exc),**detail};errors.append(event);report.setdefault('cleanup_errors',[]).append(event)
 def reap():
  changed=False
  for child in children:
   previous=child.returncode
   try:child.poll()
   except Exception as exc:error('poll',exc,pid=child.pid)
   changed|=previous is None and child.returncode is not None
  return changed
 def snapshot():
  reap()
  try:rows=observe(persist=False)
  except Exception as exc:error('observe',exc);return None
  # A telemetry write error must not discard a valid fresh ownership snapshot.
  try:save()
  except Exception as exc:error('save',exc)
  return rows
 def members(rows,group):return [item for item in rows.values() if item['pgid']==group]
 def verified(items):return all(item['pid'] in known and item['fingerprint']==known[item['pid']]['fingerprint'] for item in items)
 def groups():return {item['pgid'] for pid,item in known.items() if pid!=os.getpid()}
 # Reap BEFORE selecting signal candidates, including exited caffeinate children.
 # A fresh snapshot still has to prove every member of every signaled group.
 reap();snapshot()
 for sig in (signal.SIGTERM,signal.SIGKILL):
  for group in sorted(groups()):
   if not isinstance(group,int) or group<=1 or group==os.getpgrp():
    error('group-guard',RuntimeError('Refuse zero/system/controller process group'),pgid=group);continue
   if time.monotonic()>deadline:
    error('deadline',TimeoutError('Owned cleanup deadline exceeded'),pgid=group);continue
   for attempt in range(2):
    rows=snapshot()
    if rows is None:break
    current=members(rows,group)
    if not current:break
    if not verified(current):
     error('ownership',RuntimeError('Group contains unowned/reused process;manual drain required'),pgid=group);break
    if reap():continue # The snapshot preceded a direct-child reap; refresh it.
    try:os.killpg(group,sig)
    except (ProcessLookupError,PermissionError) as exc:
     # Exit can race even the final snapshot. EPERM is resolved ONLY by a
     # reap plus positive fresh proof of group absence, never by errno alone.
     reap();fresh=snapshot()
     if fresh is not None and not members(fresh,group):
      report.setdefault('cleanup_races',[]).append({'utc':utc(),'pgid':group,'signal':sig.name,'error':repr(exc),'fresh_group_absent':True})
     else:error('signal',exc,pgid=group,signal=sig.name)
     break
    except Exception as exc:error('signal',exc,pgid=group,signal=sig.name);break
    else:
     report['cleanup'].append({'utc':utc(),'pgid':group,'signal':sig.name});break
  time.sleep(.5);reap()
 # Independently settle every direct Popen, even if an earlier one times out.
 wait_deadline=min(deadline,time.monotonic()+2)
 for child in children:
  try:child.wait(timeout=max(0,wait_deadline-time.monotonic()))
  except Exception as exc:error('wait',exc,pid=child.pid)
 reap();rows=snapshot();end=min(deadline,time.monotonic()+2)
 while rows is not None and any(members(rows,group) for group in groups()) and time.monotonic()<end:
  time.sleep(.02);rows=snapshot()
 surviving=[] if rows is None else [item for item in rows.values() if item['pgid'] in groups()]
 settled=rows is not None and not surviving and all(child.returncode is not None for child in children)
 if not settled:error('survivors',RuntimeError('Owned process/group settlement incomplete'),survivors=surviving)
 # Never move a profile while a potentially owning process remains live.
 if settled:
  for name in profiles:
   try:
    path=Path(name)
    if path.exists():
     recovery=jobdir/'profile-recovery';recovery.mkdir(exist_ok=True);shutil.move(str(path),str(recovery/path.name));report['cleanup'].append({'utc':utc(),'preserved_profile':name})
   except Exception as exc:error('profile',exc,path=name);settled=False
  if any(Path(name).exists() for name in profiles):settled=False
 report['child_exit_codes']=[{'pid':child.pid,'exit_code':child.returncode} for child in children]
 report['owned_cleanup_settled']=settled
 if settled:report['children_and_profiles_drained_utc']=utc()
 run.update(completed_utc=utc(),settled=settled,error_count=len(errors));save()
 if errors or not settled:raise RuntimeError('Owned cleanup reported errors;see cleanup_errors and owned_cleanup_settled')

def finish_failed_capture(exc,code):
 report.update(status='FAILED_CLEANUP_PENDING',terminal=False,error=repr(exc),exit_code=code,failed_utc=utc())
 try:save()
 except Exception as save_error:report.setdefault('cleanup_errors',[]).append({'utc':utc(),'stage':'failure-save','error':repr(save_error)})
 try:cleanup()
 except Exception as drain:report['drain_error']=repr(drain)
 settled=report.get('owned_cleanup_settled',False)
 report.update(status='FAILED_PRESERVED_NO_AUTOMATIC_RETRY' if settled else 'FAILED_CLEANUP_INCOMPLETE_MANUAL_DRAIN_REQUIRED',terminal=settled,cleanup_finished_utc=utc())
 save()
 with log.open('a') as output:output.write(('ULGANI5_GPU_END failure ' if settled else 'ULGANI5_FAILURE_CLEANUP_INCOMPLETE ')+utc()+'\n')

save();code=1
try:
 env={**os.environ,'SMOKE_GL':'metal','OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2','ART_CAPTURE_CONTROLLER_PID':str(os.getpid()),'ART_CAPTURE_LOG':str(log),'ART_CAPTURE_LOAD_OUT':str(jobdir/'load-samples.json')}
 with log.open('a') as output:
  sampler=subprocess.Popen(['python3','-u',str(root/'packages/tools/blender/characters/sample_ulgani5_capture.py')],cwd=root,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True);children.append(sampler);known[sampler.pid]=processes()[sampler.pid]
  output.write('ULGANI5_BROWSER_CAPTURE_BEGIN '+utc()+'\n');output.flush();node=subprocess.Popen(command,cwd=root,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True);children.append(node);known[node.pid]=processes()[node.pid]
  assertion=subprocess.Popen(['/usr/bin/caffeinate','-i','-w',str(node.pid)],start_new_session=True);children.append(assertion);known[assertion.pid]=processes()[assertion.pid];report.update(status='capturing',node_pid=node.pid,sampler_pid=sampler.pid,caffeinate_pid=assertion.pid);save();print('ULGANI5_VARIANT_BEGIN',args.variant,report['started_utc'],json.dumps(report['processes']),flush=True)
  deadline=time.monotonic()+480
  while node.poll() is None:
   observe()
   if time.monotonic()>deadline:
    report['timeout_utc']=utc();code=124;save();raise TimeoutError('Single-variant480second bound exceeded;no automatic retry')
   time.sleep(.5)
  code=node.returncode;report.update(exit_code=code,cli_end_utc=utc());output.write('ULGANI5_GPU_END '+report['cli_end_utc']+'\n');output.flush()
  wait_for_capture_children((sampler,assertion))
 cleanup();assert code==0,'Capture failed;partial outputs preserved;no retry'
 files=json.loads(written.read_text())['files'];assert len(files)==13 and len(set(files))==13
 artifacts=[]
 for name in files:
  path=Path(name);assert path.parent==target and path.stat().st_mtime>=datetime.datetime.fromisoformat(report['started_utc']).timestamp();item={'path':str(path.relative_to(root)),'sha256':sha(path),'bytes':path.stat().st_size}
  if path.suffix=='.png':
   item['size']=png_size(path);item['complete_png_decode']=True;assert item['size']==([1920,3444] if path.name=='sheet.png' else [1920,1080])
  artifacts.append(item)
 perf=json.loads((target/'perf.json').read_text());assert perf['asset']=='ulgani' and perf['variant']==args.variant and perf['gl']=='metal' and perf['viewport']==[1920,1080] and len(perf['perf'])==3 and len(perf['far'])==2 and perf['errors']==[]
 assert sha(root/'assets/blend/characters/ulgani.blend')==identity['source_sha256'] and sha(root/'packages/client/public/models/characters/ulgani.glb')==identity['export_sha256']
 report.update(artifacts=artifacts,status='CAPTURED_CHILDREN_DRAINED_CONTROLLER_EXIT_PENDING',completed_utc=utc(),timing_limit='Raw one-session observations only;retain every unreliable flag/error;no qualified60fps,budget,regression or pair-level attribution claim');save();print('ULGANI5_VARIANT_END',args.variant,report['completed_utc'],'run --finalize after controller exit',flush=True)
except BaseException as exc:
 try:finish_failed_capture(exc,code)
 except Exception as finalization_error:print('Capture failure cleanup/report error: '+repr(finalization_error),file=sys.stderr,flush=True)
 raise
