import os,sys,subprocess,pathlib,time,json,signal
out=pathlib.Path(__file__).parent
node='/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node'
cmd=[node,'--single-threaded','--v8-pool-size=1','--max-old-space-size=512',str(out/'measure.cjs')]
env=os.environ.copy();env.update({'UV_THREADPOOL_SIZE':'1','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','VECLIB_MAXIMUM_THREADS':'1','MKL_NUM_THREADS':'1','BLIS_NUM_THREADS':'1','NUMEXPR_NUM_THREADS':'1','PYTHONDONTWRITEBYTECODE':'1','TMPDIR':str(out)})
for k in ['NODE_OPTIONS','NODE_COMPILE_CACHE']:env.pop(k,None)
launch={'command':cmd,'cwd':str(out),'environmentOverrides':{k:env[k] for k in ['UV_THREADPOOL_SIZE','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','VECLIB_MAXIMUM_THREADS','MKL_NUM_THREADS','BLIS_NUM_THREADS','NUMEXPR_NUM_THREADS','PYTHONDONTWRITEBYTECODE','TMPDIR']},'limits':{'wallSeconds':90,'sampledRSSBytes':805306368,'privateOutputBytes':33554432},'note':'synchronous Meshopt decoder with no worker registration; V8 background workers disabled; libuv pool one. No encoder or image decompressor invoked.'}
(out/'launch.json').write_text(json.dumps(launch,indent=2)+'\n')
start=time.monotonic();peak=0;reason=None
with (out/'measure.stdout').open('xb') as so,(out/'measure.stderr').open('xb') as se:
 p=subprocess.Popen(cmd,cwd=out,env=env,stdout=so,stderr=se,start_new_session=True)
 while p.poll() is None:
  r=subprocess.run(['/bin/ps','-o','rss=','-p',str(p.pid)],text=True,capture_output=True)
  rss=sum(int(x)*1024 for x in r.stdout.split());peak=max(peak,rss)
  total=sum(x.stat().st_size for x in out.iterdir() if x.is_file())
  if time.monotonic()-start>90:reason='wall limit'
  if rss>805306368:reason='RSS limit'
  if total>33554432:reason='output limit'
  if reason:os.killpg(p.pid,signal.SIGKILL);break
  time.sleep(.1)
 p.wait()
# No subprocess is launched by the measurement. Confirm the session's process group has no members.
try:os.killpg(p.pid,0);empty=False
except ProcessLookupError:empty=True
receipt={'pid':p.pid,'exit':p.returncode,'seconds':time.monotonic()-start,'peakSampledRSSBytes':peak,'limitReason':reason,'processGroupEmpty':empty}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));print((out/'measure.stderr').read_text());assert p.returncode==0 and not reason and empty
