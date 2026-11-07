import os,sys,json,subprocess,time,pathlib,resource,signal,datetime
ROOT=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');OUT=ROOT/'packages/tools/blender/characters/animations/thalune-run-candidate/revision-03';commands=[]
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def run(name,argv,env=None,blender=False):
 log=OUT/(name+'.txt');start=now();begin=time.monotonic();samples=[];cause=None
 def limits():
  resource.setrlimit(resource.RLIMIT_CPU,(300,300));resource.setrlimit(resource.RLIMIT_FSIZE,(64*1024**2,64*1024**2));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 with log.open('x') as stream:
  p=subprocess.Popen(argv,cwd=ROOT,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','MKL_NUM_THREADS':'2','NUMEXPR_NUM_THREADS':'2','VECLIB_MAXIMUM_THREADS':'2',**(env or {})},stdout=stream,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=limits)
  while p.poll() is None:
   read=subprocess.run(['/bin/ps','-o','rss=','-p',str(p.pid)],capture_output=True,text=True,timeout=3)
   rss=int(read.stdout.strip() or '0')*1024;samples.append(rss)
   if rss>8*1024**3 or time.monotonic()-begin>300:
    cause='RSS_8_GiB' if rss>8*1024**3 else 'WALL_300_SECONDS';os.killpg(p.pid,signal.SIGKILL);break
   time.sleep(.5)
  code=p.wait(timeout=10)
  stream.write(f'\nEND_OF_CAPTURE exit={code}\n')
 row=dict(name=name,argv=argv,environment=env or {},startedUtc=start,finishedUtc=now(),exitCode=code,wallSeconds=time.monotonic()-begin,peakSampledRootRssBytes=max(samples,default=0),rssSamplingSeconds=.5,rootRssRefusalBytes=8*1024**3,cpuLimitSeconds=300,wallLimitSeconds=300,fileLimitBytes=64*1024**2,refusal=cause,log=str(log.relative_to(ROOT)),blenderProcesses=1 if blender else 0)
 commands.append(row);(OUT/'cpu-commands.json').write_text(json.dumps(commands,indent=2)+'\n');print(json.dumps(row),flush=True);assert code==0 and cause is None,row
blender='/Applications/Blender.app/Contents/MacOS/Blender';script='packages/tools/blender/characters/animations/export_saved.py';receipts=OUT/'library-receipts';assert not receipts.exists()
run('blender-validate-selftest',[blender,'-b','-t','2','--factory-startup','--disable-autoexec','--python-exit-code','1','-P',script,'--','--validate-only','--selftest','--report-dir',str(receipts)],blender=True)
run('actual-library-tests',['pnpm','exec','vitest','run','packages/client/src/characters/animationLibrary.test.js','packages/client/src/characters/sharedRig.test.js','--maxWorkers=1','--no-file-parallelism'],env={'ANIMATION_PROOF_PATH':str(OUT/'animation-proof.json'),'SHARED_RIG_PROOF_PATH':str(OUT/'shared-rig-proof.json')})
run('typecheck',['pnpm','typecheck'])
run('scoped-eslint',['pnpm','exec','eslint','packages/client/src/characters/animationLibrary.test.js','packages/tools/blender/characters/animations/capture_bind.mjs'])
run('scoped-prettier',['pnpm','exec','prettier','--check','--ignore-path','/dev/null','packages/client/src/characters/animationLibrary.test.js','packages/client/src/characters/fixtures/animation-clips.json','packages/tools/blender/characters/animations/capture_bind.mjs'])
