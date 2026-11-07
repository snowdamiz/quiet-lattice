"""Real CPU-only controls for Ulgani capture observer lifecycle; never opens a browser."""
from pathlib import Path
import ast,datetime,hashlib,json,os,re,shutil,signal,subprocess,sys,time
root=Path.cwd();base=root/'.claude/pause/characters-resume';out=base/'ulgani5-observer-controls';assert not out.exists();out.mkdir();utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();current=root/'packages/tools/blender/characters/capture_ulgani5.py';original=base/'ulgani5-capture/attempt-01/ulgani_head1/capture_ulgani5.original-8ad.py';assert sha(original)=='8ad21d3e8df837960413079b988d22dcf6d72611211821d800674e07f3f09358';result={'start_utc':utc(),'pid':os.getpid(),'pgid':os.getpgrp(),'scope':'Real owned ps/Python child lifecycle controls only;no browser/GPU/Blender','old_helper_sha256':sha(original),'new_helper_sha256':sha(current),'checks':[]};fixtures=[]
def namespace(path,label):
 tree=ast.parse(path.read_text());wanted={'processes','save','observe','cleanup','finalized'};functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in wanted];assert len(functions)==len(wanted)
 ns={**globals(),'observer_events':[],'report':{'cleanup':[]},'report_path':out/(label+'.json'),'known':{},'profiles':set(),'children':[],'jobdir':out,'identity':{'fixture':label}}
 exec(compile(ast.Module(body=functions,type_ignores=[]),str(path),'exec'),ns);ns['known'][os.getpid()]=ns['processes']()[os.getpid()];return ns

def check(name,run):
 start=utc();detail=run();result['checks'].append({'name':name,'start_utc':start,'end_utc':utc(),'status':'PASS','detail':detail});print('OBSERVER_CONTROL_PASS',name,flush=True)

def old_false():
 ns=namespace(original,'old')
 try:ns['cleanup']()
 except AssertionError as e:assert str(e)=='Owned process survived cleanup';error=str(e)
 else:raise AssertionError('Old cleanup did not reproduce its real self-observer false survivor')
 rows=namespace(current,'old-independent-audit')['processes']();observers=[x for p,x in ns['known'].items() if p!=os.getpid()];assert observers and all(Path(x['executable']).name in ('ps','(ps)') for x in observers);assert all(x['pid'] not in rows for x in observers)
 return {'actual_old_error':error,'reaped_ps_rows_in_old_known':observers,'independent_all_absent':True}

def clean_empty():
 ns=namespace(current,'empty');ns['cleanup']();assert all(x['reaped'] and x['group_absent'] for x in ns['observer_events']);assert any(x.get('self_row_present') for x in ns['observer_events']);return {'events':ns['observer_events'],'cleanup':ns['report']['cleanup']}

def natural():
 ns=namespace(current,'natural');child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(.08)'],start_new_session=True);fixtures.append(child);ns['children'].append(child);ns['known'][child.pid]=ns['processes']()[child.pid];child.wait(timeout=2);ns['cleanup']();assert child.returncode==0;return {'pid':child.pid,'exit_code':child.returncode,'events':ns['observer_events']}

def live_child():
 ns=namespace(current,'live');child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(10)'],start_new_session=True);fixtures.append(child);ns['children'].append(child);ns['known'][child.pid]=ns['processes']()[child.pid];entry={'identity':ns['identity'],'status':'FINALIZED_DRAINED','artifacts':[],'processes':[ns['known'][child.pid]]}
 try:ns['finalized'](entry)
 except AssertionError as e:assert str(e)=='Recorded owned process is still alive';error=str(e)
 else:raise AssertionError('Live owned child was ignored')
 ns['cleanup']();assert child.returncode is not None and ns['finalized'](entry);assert ns['report']['cleanup'];return {'pid':child.pid,'rejected_before_cleanup':error,'actual_exit_code':child.returncode,'cleanup':ns['report']['cleanup'],'events':ns['observer_events']}

def failed_observer(mode):
 ns=namespace(current,mode);late=out/('late-'+mode+'.json');sentinel=out/(mode+'-stable.json');sentinel.write_text('unchanged\n');before=sha(sentinel)
 writer="import time;from pathlib import Path;time.sleep(.4);Path("+repr(str(late))+").write_text('late')"
 spawn="import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',"+repr(writer)+"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);"
 code=spawn+('time.sleep(10)' if mode=='timeout' else 'sys.exit(7)' if mode=='failure' else 'sys.exit(0)')
 try:ns['processes']([sys.executable,'-c',code],observer_timeout=.08 if mode=='timeout' else 1)
 except subprocess.TimeoutExpired as e:assert mode=='timeout';error=repr(e)
 except subprocess.CalledProcessError as e:assert mode=='failure' and e.returncode==7;error=repr(e)
 except RuntimeError as e:assert mode=='success-with-live-child' and 'live child' in str(e);error=repr(e)
 else:raise AssertionError('Faulty observer returned stale/partial process rows')
 events=len(ns['observer_events']);time.sleep(.55);assert not late.exists() and sha(sentinel)==before and len(ns['observer_events'])==events;assert ns['observer_events'][-1]['reaped'] and ns['observer_events'][-1]['group_absent'];return {'error':error,'no_late_file_or_state_write':True,'events':ns['observer_events']}

print('OBSERVER_CONTROLS_BEGIN',result['start_utc'],result['pid'],result['pgid'],flush=True)
try:
 check('actual_old_ps_self_survivor_reproduced',old_false);check('specific_reaped_observer_excluded',clean_empty);check('positive_natural_owned_child_exit',natural);check('actual_live_owned_child_rejected_then_cleaned',live_child)
 for mode in ['failure','timeout','success-with-live-child']:check('observer_'+mode+'_no_late_writes',lambda mode=mode:failed_observer(mode))
 result['status']='PASS7_REAL_CPU_CONTROLS'
finally:
 for child in fixtures:
  if child.poll() is None:
   os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=2)
 result['end_utc']=utc();result['all_fixture_children_reaped']=all(c.returncode is not None for c in fixtures);(out/'report.json').write_text(json.dumps(result,indent=2)+'\n')
print('OBSERVER_CONTROLS_END',result['end_utc'],result['status'],sha(out/'report.json'),flush=True)
