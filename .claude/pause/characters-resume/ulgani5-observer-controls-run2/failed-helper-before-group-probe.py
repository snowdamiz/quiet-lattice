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
 def group_exists():
  try:os.killpg(observer.pid,0);return True
  except ProcessLookupError:return False
 def drain_helper():
  for sig in (signal.SIGTERM,signal.SIGKILL):
   if not group_exists():break
   os.killpg(observer.pid,sig)
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
def observe():
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
 save();return rows

def cleanup():
 rows=observe();groups={item['pgid'] for pid,item in known.items() if pid!=os.getpid() and pid in rows and rows[pid]['fingerprint']==item['fingerprint']};groups.discard(os.getpgrp())
 for sig in (signal.SIGTERM,signal.SIGKILL):
  for group in groups:
   rows=observe();members=[x for x in rows.values() if x['pgid']==group]
   if not members:continue
   assert all(x['pid'] in known and x['fingerprint']==known[x['pid']]['fingerprint'] for x in members),'Group contains unowned/reused process;manual drain required'
   try:os.killpg(group,sig)
   except ProcessLookupError:continue
   report['cleanup'].append({'utc':utc(),'pgid':group,'signal':sig.name})
  time.sleep(.5)
  # poll() reaps only our completed direct Popen children before escalation.
  # A still-running descendant remains in the fresh identity/group check.
  for child in children:child.poll()
 for child in children:
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:raise RuntimeError('Owned child did not drain')
 rows=observe()
 assert all(pid==os.getpid() or pid not in rows or rows[pid]['fingerprint']!=item['fingerprint'] for pid,item in known.items()),'Owned process survived cleanup'
 for name in profiles:
  path=Path(name)
  if path.exists():
   recovery=jobdir/'profile-recovery';recovery.mkdir(exist_ok=True);shutil.move(str(path),str(recovery/path.name));report['cleanup'].append({'utc':utc(),'preserved_profile':name})
 assert not any(Path(name).exists() for name in profiles)
 report['child_exit_codes']=[{'pid':child.pid,'exit_code':child.returncode} for child in children]
 report['children_and_profiles_drained_utc']=utc();save()

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
  try:sampler.wait(timeout=5);assertion.wait(timeout=5)
  except subprocess.TimeoutExpired:pass
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
 report.update(status='FAILED_PRESERVED_NO_AUTOMATIC_RETRY',error=repr(exc),exit_code=code,failed_utc=utc());save()
 try:
  with log.open('a') as f:f.write('ULGANI5_GPU_END failure '+utc()+'\n')
  cleanup()
 except BaseException as drain:report['drain_error']=repr(drain);save()
 raise
