from pathlib import Path
import os,json,subprocess,hashlib,time
O=Path(__file__).parent;A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');ready=json.loads((A/'readiness.json').read_text());rows=[]
for name in ['independent','adapter-cache-v2']:
 p=O/(name+'.py');argv=[ready['rgbPrimary']['python'],'-B',str(p)];start=time.monotonic();r=subprocess.run(argv,cwd=A.parents[5],env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=60)
 (O/(name+'.stdout')).write_text(r.stdout);(O/(name+'.stderr')).write_text(r.stderr);rows.append(dict(argv=argv,exitCode=r.returncode,seconds=time.monotonic()-start,scriptSha256=hashlib.sha256(p.read_bytes()).hexdigest()));(O/'red-commands.json').write_text(json.dumps(rows,indent=2));print(name,r.returncode,r.stdout);assert r.returncode==0,r.stderr
