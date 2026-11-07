"""Real task-local publisher and unchanged stock exporter, real unwritable guard parent."""
import importlib.util, pathlib, sys, tempfile, os, subprocess, signal, json, hashlib
from commands import OUT,REPO,PY,ENV
source=REPO/'packages/tools/blender/t08/revision_r1/test_lifecycle.py'
spec=importlib.util.spec_from_file_location('retained_harness',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=tempfile.mkdtemp
def scoped_temp(*args,**kwargs):
 if kwargs.get('dir')=='/tmp':kwargs['dir']=str(OUT)
 return original(*args,**kwargs)
tempfile.mkdtemp=scoped_temp
h=m.Harness(REPO/'packages/tools/blender/t08',OUT/'fence-probe')
rows=[]
try:
 for writable in [True,False]:
  name='guard_writable' if writable else 'guard_unwritable'
  root,here,src,dst,env=h.prepare(name,'deny')
  with (root/'cpu_dependencies/sitecustomize.py').open('a') as f:
   f.write('\nimport tempfile\n_t=tempfile.mkdtemp\ndef private_tmp(*a,**kw):\n if kw.get("dir")=="/tmp":kw["dir"]=str(root)\n return _t(*a,**kw)\ntempfile.mkdtemp=private_tmp\n')
  guard_parent=here/'evidence';guard_parent.mkdir(mode=0o755 if writable else 0o555)
  command=[PY,'-B',str(here/'export_saved.py'),'--label','first','--only','cargo_pod']
  row={'case':name,'guardParentMode':oct(guard_parent.stat().st_mode&0o777),'command':command,'scratch':str(root),'codeSHA256':{f:m.sha(here/f) for f in ['run.py','export_saved.py']}}
  with (h.evidence/(name+'-first.log')).open('x') as log:
   proc=subprocess.Popen(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);h.processes.append(proc)
   row['supervisorPID']=proc.pid
   m.until(lambda:(root/'validation-entered').exists())
   first_producer=int((root/'producer.pid').read_text());h.groups.add(first_producer);row['firstProducer']=first_producer
   os.kill(proc.pid,signal.SIGTERM)
   row['firstExit']=proc.wait(timeout=15)
  first_receipt=next((here/'exports').glob('*/producer/run/result.json'))
  first_binding=next((here/'exports').glob('*/binding.json'))
  row['firstReceipt']=m.jsonfile(first_receipt);row['firstBinding']=m.jsonfile(first_binding)
  row['guardExists']=(guard_parent/'.lane-blocked.json').exists()
  row['firstAliveBeforeRetry']=m.group(first_producer)
  prior=(root/'substitution.jsonl').read_text().splitlines()
  retry_env=dict(env,T08_CASE='ok');retry_env.pop('T08_DENY_KILL',None)
  retry_command=[*command];retry_command[4]='second'
  row['retryCommand']=retry_command
  with (h.evidence/(name+'-retry.log')).open('x') as log:
   retry=subprocess.Popen(retry_command,cwd=root,env=retry_env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);h.processes.append(retry)
   row['retryExit']=retry.wait(timeout=15)
  row['firstAliveAfterRetry']=m.group(first_producer)
  current=(root/'substitution.jsonl').read_text().splitlines()
  row['producerLaunchesBeforeRetry']=len(prior);row['producerLaunchesAfterRetry']=len(current)
  row['bindings']=[m.jsonfile(p) for p in sorted((here/'exports').glob('*/binding.json'))]
  row['canonicalExistsAfterRetry']=dst.exists()
  row['expectationMet']=bool(row['firstAliveBeforeRetry'] and row['firstAliveAfterRetry'] and row['retryExit']!=0 and len(prior)==len(current))
  # Release first only after the attempted retry has finished; preserve evidence permissions.
  (root/'release').write_text('go');m.until(lambda:not m.group(first_producer),10)
  h.groups.add(int((root/'producer.pid').read_text()))
  row['firstReceiptUnchanged']=m.sha(first_receipt)==hashlib.sha256(json.dumps(row['firstReceipt']).encode()).hexdigest() if False else m.jsonfile(first_receipt)==row['firstReceipt']
  row['stockMoves']=[json.loads(line) for line in (root/'stock-moves.jsonl').read_text().splitlines()]
  rows.append(row);h.rows.append(row)
  with (h.evidence/(name+'.json')).open('x') as f:json.dump(row,f,indent=2)
  print(name,'safeRefusal',row['expectationMet'],'first',row['firstExit'],'retry',row['retryExit'],'launches',len(prior),len(current),'firstAliveDuringRetry',bool(row['firstAliveAfterRetry']),flush=True)
 h.complete=True
finally:h.finish()
sys.exit(0 if all(r['expectationMet'] for r in rows) else 1)
