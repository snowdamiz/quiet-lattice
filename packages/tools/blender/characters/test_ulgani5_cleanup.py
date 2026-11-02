"""Real owned CPU fixtures execute the capture helper's exact function ASTs."""
from pathlib import Path
import ast,datetime,errno,hashlib,json,os,re,shutil,signal,subprocess,sys,time

root=Path.cwd();source=root/'packages/tools/blender/characters/capture_ulgani5.py'
out=root/'.claude/pause/characters-resume'/(sys.argv[1] if len(sys.argv)>1 else 'ulgani5-cleanup-controls')
assert not out.exists();out.mkdir();utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
result={'started_utc':utc(),'controller_pid':os.getpid(),'controller_pgid':os.getpgrp(),'helper_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'scope':'Real owned Python/caffeinate processes;CPU only,no browser/GPU/art work. OS error injections explicitly labeled. Actual helper functions,not mirrored cleanup.','checks':[]}
names={'processes','save','observe','cleanup','wait_for_capture_children','finish_failed_capture'}
functions=[node for node in ast.parse(source.read_text()).body if isinstance(node,ast.FunctionDef) and node.name in names]
assert len(functions)==len(names)
all_namespaces=[];all_fixtures=[];fixture_known={}

def namespace(label):
 jobdir=out/label;jobdir.mkdir();log=jobdir/'fixture.log';log.write_text('')
 ns={**globals(),'jobdir':jobdir,'report_path':jobdir/'report.json','log':log,'report':{'cleanup':[],'status':'fixture-starting','terminal':False},'known':{},'profiles':set(),'children':[],'observer_events':[]}
 exec(compile(ast.Module(body=functions,type_ignores=[]),str(source),'exec'),ns)
 ns['known'][os.getpid()]=ns['processes']()[os.getpid()];ns['real_processes']=ns['processes'];all_namespaces.append(ns);return ns

def remember(ns):
 ns['observe']()
 for pid,row in ns['known'].items():fixture_known[pid]=row.copy()

def spawn(ns,code):
 child=subprocess.Popen([sys.executable,'-c',code],start_new_session=True);all_fixtures.append(child);ns['children'].append(child);remember(ns);return child

def unreaped_state(child):
 deadline=time.monotonic()+3
 while True:
  state=subprocess.run(['ps','-p',str(child.pid),'-o','stat='],text=True,capture_output=True).stdout.strip()
  if state.startswith('Z'):assert child.returncode is None;return state
  assert time.monotonic()<deadline,(child.pid,state);time.sleep(.01)

def resistant(ns,label):
 marker=ns['jobdir']/(label+'.json')
 descendant="import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)"
 code="import subprocess,sys,signal,time,json,os;signal.signal(signal.SIGTERM,signal.SIG_IGN);p=subprocess.Popen([sys.executable,'-c',"+repr(descendant)+"]);open("+repr(str(marker))+",'w').write(json.dumps({'pid':os.getpid(),'descendant':p.pid}));time.sleep(60)"
 child=spawn(ns,code);deadline=time.monotonic()+3
 while not marker.exists():assert time.monotonic()<deadline;time.sleep(.01)
 remember(ns);ids=json.loads(marker.read_text());assert ids['descendant'] in ns['known'];return child,ids

def watcher(ns):
 target=subprocess.Popen([sys.executable,'-c','import time;time.sleep(.12)'],start_new_session=True);all_fixtures.append(target)
 child=subprocess.Popen(['/usr/bin/caffeinate','-i','-w',str(target.pid)],start_new_session=True);all_fixtures.append(child);ns['children'].append(child);remember(ns);target.wait(timeout=2);state=unreaped_state(child)
 return child,{'target_pid':target.pid,'watcher_pid':child.pid,'actual_unreaped_state':state}

def absence(ns,ids):
 rows=ns['real_processes']();return all(pid not in rows for pid in ids)

def emergency():
 for child in all_fixtures:child.poll()
 rows=all_namespaces[0]['real_processes']()
 for group in {p.pid for p in all_fixtures}:
  members=[p for p in rows.values() if p['pgid']==group]
  if not members:continue
  assert all(p['pid'] in fixture_known and p['fingerprint']==fixture_known[p['pid']]['fingerprint'] for p in members),('unverified fixture member',members)
  try:os.killpg(group,signal.SIGKILL)
  except ProcessLookupError:pass
  except PermissionError:
   for child in all_fixtures:child.poll()
   fresh=all_namespaces[0]['real_processes']();assert not any(p['pgid']==group for p in fresh.values())
 for child in all_fixtures:child.wait(timeout=3)
 end=time.monotonic()+3
 while True:
  rows=all_namespaces[0]['real_processes']();remaining=[p for pid,p in rows.items() if pid!=os.getpid() and pid in fixture_known and p['fingerprint']==fixture_known[pid]['fingerprint']]
  if not remaining or time.monotonic()>end:break
  time.sleep(.02)
 assert not remaining,remaining

def check(name,fn):
 item={'name':name,'started_utc':utc()};result['checks'].append(item)
 try:item['detail']=fn();item['status']='PASS';print('CLEANUP_CONTROL_PASS',name,flush=True)
 except BaseException as exc:item.update(status='FAILED',error=repr(exc));raise
 finally:
  emergency();item['completed_utc']=utc();(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')

def natural():
 ns=namespace('natural');child=spawn(ns,'import time;time.sleep(.05)');state=unreaped_state(child);ns['cleanup']();assert child.returncode==0 and ns['report']['owned_cleanup_settled'];assert ns['report']['cleanup']==[];return {'pid':child.pid,'actual_unreaped_state':state,'natural_exit':child.returncode}

def mixed():
 ns=namespace('mixed');zombie,z=watcher(ns);live,ids=resistant(ns,'resistant');ns['cleanup']();assert zombie.returncode==0 and live.returncode==-9 and absence(ns,[zombie.pid,*ids.values()]);signals=[x['signal'] for x in ns['report']['cleanup'] if x.get('pgid')==live.pid];assert signals==['SIGTERM','SIGKILL'];assert not any(x.get('pgid')==zombie.pid for x in ns['report']['cleanup']);return {**z,**ids,'signals':signals,'reaped_without_signaling_watcher':True}

def wait_entry():
 ns=namespace('sampler-timeout');zombie,z=watcher(ns);live,ids=resistant(ns,'sampler');ns['wait_for_capture_children']((live,zombie))
 waits=ns['report']['child_waits'];assert 'TimeoutExpired' in waits[0]['error'] and waits[1]['exit_code']==0 and zombie.returncode==0
 ns['cleanup']();before=len(ns['report']['cleanup']);ns['cleanup']();assert len(ns['report']['cleanup'])==before and ns['report']['owned_cleanup_settled'];assert absence(ns,[*ids.values(),zombie.pid]);return {**z,**ids,'actual_independent_waits':waits,'second_cleanup_added_no_signals':True}

class OSFault:
 def __init__(self,kill):self.killpg=kill
 def __getattr__(self,name):return getattr(os,name)

def exit_race():
 ns=namespace('exit-race');victim=spawn(ns,'import time;time.sleep(60)');peer,ids=resistant(ns,'peer');fired=[]
 def kill(group,sig):
  if group==victim.pid and not fired:
   victim.send_signal(signal.SIGTERM);state=unreaped_state(victim)
   fired.append({'group':group,'state_before_actual_signal':state})
  return os.killpg(group,sig)
 ns['os']=OSFault(kill);ns['cleanup']();assert fired and victim.returncode is not None and peer.returncode==-9 and absence(ns,[victim.pid,*ids.values()]);assert ns['report'].get('cleanup_races');return {'actual_exit_race':fired,'resolved_only_after_fresh_absence':ns['report']['cleanup_races']}

def permission_failure():
 ns=namespace('permission-failure');blocked,blocked_ids=resistant(ns,'blocked');peer,peer_ids=resistant(ns,'peer');calls=[]
 def kill(group,sig):
  calls.append([group,sig.name])
  if group==blocked.pid:raise PermissionError(errno.EPERM,'injected denial on real live owned group')
  return os.killpg(group,sig)
 ns['os']=OSFault(kill);ns['finish_failed_capture'](ValueError('primary capture failure'),7)
 assert blocked.poll() is None and peer.returncode==-9 and absence(ns,list(peer_ids.values()))
 report=ns['report'];assert report['error']=="ValueError('primary capture failure')" and report['exit_code']==7 and report['terminal'] is False and not report['owned_cleanup_settled'];assert report['status']=='FAILED_CLEANUP_INCOMPLETE_MANUAL_DRAIN_REQUIRED'
 assert any(x['stage']=='signal' and 'PermissionError' in x['error'] for x in report['cleanup_errors']);return {'fault_kind':'Injected EPERM,actual owned live processes','blocked_still_live_detected':blocked_ids,'other_group_drained':peer_ids,'signal_calls':calls,'terminal_refused':True}

def observer_failure():
 ns=namespace('observer-failure');peer,ids=resistant(ns,'peer');late=ns['jobdir']/'late-observer';real=ns['real_processes'];fired=[]
 code="import subprocess,sys;subprocess.Popen([sys.executable,'-c',"+repr("import time;from pathlib import Path;time.sleep(.5);Path("+repr(str(late))+").write_text('late')")+"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);sys.exit(9)"
 def faulty(*args,**kwargs):
  if not fired:fired.append(True);return real([sys.executable,'-c',code])
  return real(*args,**kwargs)
 ns['processes']=faulty;history=[];real_save=ns['save']
 def save():
  history.append({'status':ns['report']['status'],'terminal':ns['report'].get('terminal',False),'settled':ns['report'].get('owned_cleanup_settled',False)});real_save()
 ns['save']=save;ns['finish_failed_capture'](ValueError('original node error'),3)
 report=ns['report'];assert peer.returncode==-9 and absence(ns,list(ids.values()));assert report['status']=='FAILED_PRESERVED_NO_AUTOMATIC_RETRY' and report['terminal'] and report['error']=="ValueError('original node error')";assert report.get('drain_error') and any(x['stage']=='observe' for x in report['cleanup_errors']);assert all(not x['terminal'] or x['settled'] for x in history)
 before=hashlib.sha256(ns['report_path'].read_bytes()).hexdigest();events=len(ns['observer_events']);time.sleep(.65);assert not late.exists() and before==hashlib.sha256(ns['report_path'].read_bytes()).hexdigest() and events==len(ns['observer_events']);return {'actual_failed_observer_exit':9,'other_owned_group_drained':ids,'primary_failure_retained':True,'terminal_only_after_settlement':history,'no_late_file_or_report_write':True}

def profile_error():
 ns=namespace('profile-error');peer,ids=resistant(ns,'peer');profile=ns['jobdir']/'playwright_chromiumdev_profile-fixture';profile.mkdir();(profile/'evidence').write_text('preserve');ns['profiles'].add(str(profile));(ns['jobdir']/'profile-recovery').write_text('real obstruction')
 ns['finish_failed_capture'](RuntimeError('capture failed before cleanup'),5);assert peer.returncode==-9 and absence(ns,list(ids.values()));assert not ns['report']['terminal'] and profile.exists();assert any(x['stage']=='profile' and 'FileExistsError' in x['error'] for x in ns['report']['cleanup_errors'])
 (ns['jobdir']/'profile-recovery').unlink();ns['finish_failed_capture'](RuntimeError('capture failed before cleanup'),5);assert ns['report']['terminal'] and ns['report']['status']=='FAILED_PRESERVED_NO_AUTOMATIC_RETRY';assert (ns['jobdir']/'profile-recovery'/profile.name/'evidence').read_text()=='preserve';return {'actual_IO_error_retained':True,'resources_drained_despite_profile_error':ids,'profile_preserved_then_recovered':True,'primary_failure_never_success':True}

def report_error():
 ns=namespace('report-error');peer,ids=resistant(ns,'peer');ns['report_path'].unlink();ns['report_path'].mkdir();real_save=ns['save'];fired=[]
 def save():
  try:real_save()
  finally:
   if not fired:fired.append(True);ns['report_path'].rmdir()
 ns['save']=save
 try:ns['cleanup']()
 except RuntimeError:pass
 else:raise AssertionError('Actual report IO error was hidden')
 assert peer.returncode==-9 and absence(ns,list(ids.values())) and ns['report']['owned_cleanup_settled'];assert any(x['stage']=='save' and 'IsADirectoryError' in x['error'] for x in ns['report']['cleanup_errors']);return {'real_report_write_error_retained':True,'fresh_ownership_evidence_not_discarded':True,'owned_group_drained':ids}

def ownership_guards():
 ns=namespace('ownership');blocked,ids=resistant(ns,'guarded');peer,peers=resistant(ns,'peer');ns['known'][blocked.pid]['fingerprint']='wrong birth identity';calls=[]
 def kill(group,sig):calls.append(group);return os.killpg(group,sig)
 ns['os']=OSFault(kill)
 try:ns['cleanup']()
 except RuntimeError:pass
 else:raise AssertionError('Reused/unverified identity was accepted')
 assert blocked.pid not in calls and peer.returncode==-9 and blocked.poll() is None and absence(ns,list(peers.values()));assert any(x['stage']=='ownership' for x in ns['report']['cleanup_errors']);return {'refused_signal_to_mismatched_birth':ids,'independent_owned_group_drained':peers}

def invalid_groups():
 ns=namespace('invalid-groups');ns['known'][999999999]={'pid':999999999,'pgid':0,'fingerprint':'corrupted fixture metadata','executable':'fixture'};calls=[]
 ns['os']=OSFault(lambda group,sig:calls.append(group))
 try:ns['cleanup']()
 except RuntimeError:pass
 else:raise AssertionError('Zero group metadata did not fail closed')
 assert not calls and any(x['stage']=='group-guard' for x in ns['report']['cleanup_errors']);return {'synthetic_invalid_metadata':True,'zero_or_controller_group_never_signaled':True}

print('CLEANUP_CONTROLS_BEGIN',result['started_utc'],os.getpid(),os.getpgrp(),flush=True)
try:
 for name,fn in [('natural_exit',natural),('unreaped_caffeinate_plus_resistant_child_descendant',mixed),('actual_sampler_timeout_independent_assertion_wait_and_idempotence',wait_entry),('real_exit_between_snapshot_and_signal',exit_race),('live_permission_denial_failclosed_other_groups_drained',permission_failure),('actual_observer_failure_primary_error_and_no_late_writes',observer_failure),('real_profile_IO_error_preserves_failure_and_settles_other_resources',profile_error),('real_report_IO_error_does_not_discard_owned_snapshot',report_error),('birth_identity_guard_with_other_owned_group_drain',ownership_guards),('positive_group_guard',invalid_groups)]:check(name,fn)
 result['status']='PASS10_REAL_CPU_CLEANUP_CONTROLS'
finally:
 emergency();result['completed_utc']=utc();result['all_direct_fixture_children_reaped']=all(p.returncode is not None for p in all_fixtures);result['fixture_processes']=list(fixture_known.values());result['fixture_direct_children']=[{'pid':p.pid,'pgid':p.pid,'exit_code':p.returncode} for p in all_fixtures];result['observer_lifecycles']=[event for ns in all_namespaces for event in ns['observer_events']];(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print('CLEANUP_CONTROLS_END',result['completed_utc'],result['status'],flush=True)
