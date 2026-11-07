from pathlib import Path
import json,subprocess,os,sys,time,signal
s=Path(__file__).parent
node='/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node'
repo='/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521'
env={'PATH':str(Path(node).parent)+':/usr/bin:/bin','TMPDIR':str(s/'tmp'),'TMP':str(s/'tmp'),'TEMP':str(s/'tmp'),'XDG_CACHE_HOME':str(s/'cache'),'NODE_COMPILE_CACHE':str(s/'cache'),'NODE_OPTIONS':'--import '+str(s/'boundary.mjs'),'GIT_OPTIONAL_LOCKS':'0','COREPACK_ENABLE_NETWORK':'0','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD':'1','PWTEST_CACHE_DIR':str(s/'pw-cache'),'PYTHONDONTWRITEBYTECODE':'1'}
name=sys.argv[1];argv=sys.argv[2:];start=time.time();out=s/'logs'/(name+'.log')
assert not out.exists(), name
with out.open('xb') as f:
 p=subprocess.Popen(argv,cwd=s,env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
 timeout=False
 try: code=p.wait(timeout=120)
 except subprocess.TimeoutExpired:
  timeout=True;os.killpg(p.pid,signal.SIGTERM)
  try:code=p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);code=p.wait(timeout=5)
record={'name':name,'argv':argv,'cwd':str(s),'env':env,'pid':p.pid,'exit':code,'seconds':time.time()-start,'timeout':timeout,'output':str(out)}
with (s/'commands.jsonl').open('a') as f:f.write(json.dumps(record)+'\n')
print(json.dumps(record));print('\n'.join(out.read_text(errors='replace').splitlines()[-22:]))
size=sum(p.stat().st_size for p in s.rglob('*') if p.is_file() and not p.is_symlink())
print('scratch bytes',size)
assert size<=256*1024**2
sys.exit(code)
