from pathlib import Path
import sys,os,time,json,subprocess
out=Path(__file__).parent; name=sys.argv[1];argv=sys.argv[2:];start=time.monotonic()
p=subprocess.run(argv,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
(out/(name+'.stdout')).write_bytes(p.stdout);(out/(name+'.stderr')).write_bytes(p.stderr)
with (out/'commands.jsonl').open('a') as f:f.write(json.dumps({'name':name,'argv':argv,'cwd':os.getcwd(),'exit':p.returncode,'seconds':time.monotonic()-start,'stdoutBytes':len(p.stdout),'stderrBytes':len(p.stderr)})+'\n')
print(name,'exit',p.returncode,'stdout',len(p.stdout),'stderr',len(p.stderr));print(p.stderr[-1800:].decode(errors='replace'));sys.exit(p.returncode)
