import hashlib,importlib.util,json,os,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9dcc2975')
OUT=Path(__file__).parent
def load(p,name):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
t=load(ROOT/'packages/tools/blender/flora_trees/test_runner.py','tests')
INJECT='''
if os.environ.get('DENY_CANDIDATE_RENAME'):
 original_rename=Path.rename
 def rename(p,target):
  if p.name=='candidate.json': raise PermissionError(13,'controlled candidate rename denial')
  return original_rename(p,target)
 Path.rename=rename
if os.environ.get('FAIL_ARCHIVE_FSYNC'):
 real_fsync=m.os.fsync
 def fsync(fd):
  found=m.subprocess.check_output(['lsof','-a','-p',str(os.getpid()),'-d',str(fd),'-Fn'],text=True)
  if os.environ['FAIL_ARCHIVE_FSYNC'] in found: raise OSError(5,'controlled archive fsync failure')
  return real_fsync(fd)
 m.os.fsync=fsync
if os.environ.get('FAIL_GROUP_OBSERVATION'):
 original_output=m.subprocess.check_output
 def output(cmd,*args,**kw):
  if cmd==['ps','-axo','pid=,pgid=,rss=,stat=']: raise OSError(5,'controlled group observation failure')
  return original_output(cmd,*args,**kw)
 m.subprocess.check_output=output
if os.environ.get('FAIL_PENDING_UNLINK'):
 original_unlink=Path.unlink
 def unlink(p,*args,**kw):
  if p.name=='.receipt.json.pending': raise PermissionError(13,'controlled pending unlink denial after link')
  return original_unlink(p,*args,**kw)
 Path.unlink=unlink
'''
t.BOOT=t.BOOT.replace('sys.exit(m.main())',INJECT+'\nsys.exit(m.main())')
h=t.Harness(ROOT/'packages/tools/blender/flora_trees/run.py',OUT/'adverse',Path('/tmp/t04-r570e7f2-review/lifecycle.py'))
cases=[]
def setup(name,code='',action='export'):
 root=h.life.make_root(name)
 src,dst,cand=h.life.place_pair(root,b'ORIGINAL-SOURCE',b'CURRENT-GLB',{'status':'PASS'})
 prefix="import os,sys,time,subprocess\nfrom pathlib import Path\nr=Path(__file__).resolve().parents[4]\n(r/'child.pid').write_text(str(os.getpid()))\ndst=r/'packages/client/public/models/flora/tree_round_t04.glb'\nsrc=r/'assets/blend/flora/tree_round_t04.blend'\nprint('child-ready',flush=True)\n"
 script=root/'packages/tools/blender/flora_trees'/({'export':'export_saved.py','audit':'audit.py','seal':'seal.py'}[action])
 script.write_text(prefix+code)
 return root,src,dst,cand
def execute(root,action='export',**kw):
 result=h.run(root,[action,'round','--deadline','3'],**kw)
 recs=h.life.receipts(root)
 if not recs: recs=list((root/'assets/blend/flora/trees/evidence').glob('*/receipt-failure.json'))
 body=json.loads(recs[0].read_text()) if recs else None
 return result,body,recs[0].parent if recs else None
def add(name,ok,result,receipt,**facts):
 cases.append({'name':name,'expectation_met':bool(ok),'run':result,'receipt':receipt,**facts})
 print(name, bool(ok),flush=True)
def absent(*paths): return all(not os.path.lexists(p) for p in paths)
try:
 root,src,dst,cand=setup('candidate-rename-denied')
 result,body,run=execute(root,env={'DENY_CANDIDATE_RENAME':'1'})
 row=body['archives'][0]['entries'][0]
 add(root.name,result['exit']==body['exit']==1 and not body['child_started'] and not row['invalidated'] and row['errors'] and cand.is_file() and not dst.exists() and (run/'previous-historical.glb').read_bytes()==b'CURRENT-GLB',result,body)

 root,src,dst,cand=setup('candidate-detach-fsync-fails')
 result,body,run=execute(root,env={'FAIL_ARCHIVE_FSYNC':'previous-candidate.json'})
 row=body['archives'][0]['entries'][0]
 add(root.name,result['exit']==body['exit']==1 and absent(dst,cand) and row['errors'] and row['quarantine_retained'] and 'payload' not in row and (run/'previous-historical.glb').read_bytes()==b'CURRENT-GLB',result,body)

 root,src,dst,cand=setup('failed-output-detach-fsync-fails',"dst.write_bytes(b'NEW-GLB')\nsys.exit(7)\n")
 result,body,run=execute(root,env={'FAIL_ARCHIVE_FSYNC':'failed-historical.glb'})
 row=body['archives'][-1]['entries'][1]
 add(root.name,result['exit']==body['exit']==body['child_exit']==7 and absent(dst,cand) and row['errors'] and row['quarantine_retained'] and 'payload' not in row and (run/row['quarantine']).read_bytes()==b'NEW-GLB',result,body)

 for name,code in [('source-directory-after',"src.unlink(); src.mkdir()"),('source-retarget-same-bytes',"other=r/'replacement.blend';other.write_bytes(src.read_bytes());src.unlink();src.symlink_to(other)")]:
  root,src,dst,cand=setup(name,"dst.write_bytes(b'NEW-GLB')\n"+code+'\n')
  result,body,run=execute(root)
  add(name,result['exit']==body['exit']==1 and body['child_exit']==0 and absent(dst,cand) and body['export_sha256'] is None and (run/'failed-historical.glb').read_bytes()==b'NEW-GLB',result,body)

 root,src,dst,cand=setup('exit7-mutation',"dst.write_bytes(b'NEW-GLB');src.write_bytes(b'MUTATED');sys.exit(7)\n")
 result,body,run=execute(root)
 add(root.name,result['exit']==body['exit']==body['child_exit']==7 and body['reason']=='child exit' and body['source_mutation'] and absent(dst,cand),result,body)

 root,src,dst,cand=setup('child-signal-exit',"dst.write_bytes(b'NEW-GLB')\nos.kill(os.getpid(),15)\n")
 result,body,run=execute(root)
 add(root.name,result['exit']==body['exit']==143 and body['child_exit']==-15 and body['cleanup']['terminal'] and absent(dst,cand),result,body)

 root,src,dst,cand=setup('group-observation-fails',"time.sleep(20)\n")
 result,body,run=execute(root,env={'FAIL_GROUP_OBSERVATION':'1'})
 add(root.name,result['exit']==body['exit']!=0 and body['remaining_owned_children'] is None and body['child_reaped'] and body['cleanup']['errors'] and not body['cleanup']['terminal'] and (run.parent/'.lane.blocked.json').is_file() and absent(dst,cand),result,body)

 root,src,dst,cand=setup('read-action-source-failure',action='audit');src.chmod(0)
 result,body,run=execute(root,action='audit')
 add(root.name,result['exit']==body['exit']!=0 and not body['child_started'] and absent(dst,cand) and (run/'failed-historical.glb').read_bytes()==b'CURRENT-GLB',result,body)

 root,src,dst,cand=setup('receipt-postlink-unlink-fails',"dst.write_bytes(b'NEW-GLB')\n")
 result,body,run=execute(root,env={'FAIL_PENDING_UNLINK':'1'})
 add(root.name,result['exit']==body['exit']!=0 and absent(dst,cand,run/'receipt.json') and (run/'receipt-failure.json').is_file() and body['reason']=='receipt write',result,body)

 # Real producer stays alive after denied cleanup, then publishes only after the
 # supervisor has returned. A file barrier makes this independent of timing.
 code="deadline=time.monotonic()+20\nwhile not (r/'release-publish').exists() and time.monotonic()<deadline: time.sleep(.02)\nif not (r/'release-publish').exists(): sys.exit(9)\nstaged=r/'late-private.glb';staged.write_bytes(b'LATE-PUBLISHED-GLB');staged.rename(dst)\n(r/'published').write_text('done')\n"
 root,src,dst,cand=setup('late-publication-after-denied-cleanup',code)
 result,body,run=execute(root,sig=signal.SIGINT,env={'DENY_SIGNAL':'1'})
 before={'export_absent':not os.path.lexists(dst),'candidate_absent':not os.path.lexists(cand),'receipt_sha256':t.digest(run/'receipt.json'),'blocked':(run.parent/'.lane.blocked.json').is_file()}
 assert body['exit']==result['exit']==130 and not body['cleanup']['terminal'] and before['export_absent']
 (root/'release-publish').write_text('go')
 until=time.monotonic()+5
 while not (root/'published').exists() and time.monotonic()<until: time.sleep(.02)
 after={'export_exists':dst.exists(),'export_bytes':dst.read_text() if dst.exists() else None,'receipt_sha256':t.digest(run/'receipt.json'),'blocked':(run.parent/'.lane.blocked.json').is_file()}
 second=h.run(root,['export','round','--deadline','3'])
 add(root.name,not after['export_exists'],result,body,before=before,after=after,retry=second)
finally:
 h.cleanup()
 result={'cases':cases,'commands':h.records,'status':'PASS' if all(c['expectation_met'] for c in cases) else 'REVISE'}
 (OUT/'adverse-results.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'status':result['status'],'cases':len(cases),'failed':[c['name'] for c in cases if not c['expectation_met']]}))
sys.exit(0 if result['status']=='PASS' else 1)
