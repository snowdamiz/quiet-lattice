from pathlib import Path
import json,os,subprocess,sys,time
O=Path(__file__).parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate'
name=sys.argv[1];expected=int(sys.argv[2]);argv=sys.argv[3:];ready=json.loads((A/'readiness.json').read_text());env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'}
assert not (O/(name+'-command.json')).exists();start=time.monotonic();r=subprocess.run(argv,cwd=R,env=env,capture_output=True,timeout=120)
(O/(name+'.stdout')).write_bytes(r.stdout);(O/(name+'.stderr')).write_bytes(r.stderr)
(O/(name+'-command.json')).write_text(json.dumps(dict(argv=argv,cwd=str(R),environmentOverrides={k:env[k] for k in ['PATH','PYTHONDONTWRITEBYTECODE']},timeoutSeconds=120,exitCode=r.returncode,expectedExit=expected,seconds=time.monotonic()-start,stdout=str(O/(name+'.stdout')),stderr=str(O/(name+'.stderr'))),indent=2)+'\n')
print(json.dumps(dict(name=name,exitCode=r.returncode,expected=expected,stdoutTail=r.stdout.decode(errors='replace')[-500:],stderrTail=r.stderr.decode(errors='replace')[-500:])));assert r.returncode==expected
