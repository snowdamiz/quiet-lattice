from pathlib import Path
import json,subprocess,os,hashlib,time
O=Path(__file__).parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';ready=json.loads((A/'readiness.json').read_text());rows=[]
for name in ['independent','observer-native','close-failures']:
 p=O/'green-repros'/(name+'.py');argv=[ready['rgbPrimary']['python'],'-B',str(p)];start=time.monotonic();r=subprocess.run(argv,cwd=R,env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=90)
 (O/'green-repros'/(name+'.stdout')).write_text(r.stdout);(O/'green-repros'/(name+'.stderr')).write_text(r.stderr);rows.append(dict(argv=argv,cwd=str(R),exitCode=r.returncode,seconds=time.monotonic()-start,scriptSha256=hashlib.sha256(p.read_bytes()).hexdigest()));(O/'green-commands.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,r.returncode,r.stdout[-1500:],flush=True);assert r.returncode==0,r.stderr
