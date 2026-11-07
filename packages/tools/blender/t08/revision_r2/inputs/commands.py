import pathlib,subprocess,sys,json,time,os
OUT=pathlib.Path('/private/tmp/t08-r2-source-25d38590-x6AaWJ')
REPO=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-8895fab5')
PY='/opt/homebrew/opt/python@3.14/bin/python3.14'
ENV=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',OMP_NUM_THREADS='2',OPENBLAS_NUM_THREADS='2',MKL_NUM_THREADS='2',VECLIB_MAXIMUM_THREADS='2',NUMEXPR_NUM_THREADS='2')
def run(name,argv):
 start=time.monotonic()
 with (OUT/(name+'.log')).open('x') as f:
  p=subprocess.run(argv,cwd=REPO,env=ENV,stdout=f,stderr=subprocess.STDOUT,timeout=240)
 row={'name':name,'argv':argv,'cwd':str(REPO),'exit':p.returncode,'elapsedSeconds':time.monotonic()-start,'log':str(OUT/(name+'.log')),'failureTail20':(OUT/(name+'.log')).read_text().splitlines()[-20:] if p.returncode else []}
 with (OUT/(name+'-command.json')).open('x') as f:json.dump(row,f,indent=2)
 print(json.dumps(row),flush=True)
 return p.returncode
if __name__=='__main__':
 cases='symlink,relative_symlink,hardlink,old_unreadable,new_unreadable,batch_unreadable,sigterm,denied_cleanup_late_publish,runner_sigterm,runner_eperm,sites_happy,leader_exit_with_cohort,source_alias,signal_during_binding,runner_signal_during_result'
 for label,code in [('red',REPO/'packages/tools/blender/t08/revision_r1/baseline'),('green',REPO/'packages/tools/blender/t08')]:
  run(label,[PY,'-B',str(OUT/'focused.py'),'--code',str(code),'--evidence',str(OUT/label),'--cases',cases])
