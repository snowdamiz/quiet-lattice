import subprocess,os,time,json,pathlib,hashlib,shutil
s=pathlib.Path(__file__).parent; a=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-46f90470'); old=pathlib.Path('/private/tmp/lark-r3-revise-source-review-945b2a'); env=dict(os.environ,TMPDIR=str(s/'tmp'),PYTHONDONTWRITEBYTECODE='1'); b='/Applications/Blender.app/Contents/MacOS/Blender'
def run(name,args):
 peak=0
 with open(s/(name+'.stdout'),'w') as out,open(s/(name+'.stderr'),'w') as err:
  p=subprocess.Popen(args,stdout=out,stderr=err,env=env)
  while p.poll() is None:
   try:r=int(subprocess.check_output(['ps','-o','rss=','-p',str(p.pid)]).strip() or 0)
   except:r=0
   peak=max(peak,r)
   if r>8*1024**2 or shutil.disk_usage(s).free<12*1024**3:p.kill();raise RuntimeError('resource boundary')
   time.sleep(.5)
 json.dump({'exit':p.returncode,'peak_rss_kib':peak,'args':args},open(s/(name+'.run.json'),'w')); print(name,p.returncode,peak,flush=True)
run('materials',[b,'-b','-t','2','--factory-startup','--python-exit-code','1','-P',str(s/'materials.py'),'--',str(s/'materials.json')])
