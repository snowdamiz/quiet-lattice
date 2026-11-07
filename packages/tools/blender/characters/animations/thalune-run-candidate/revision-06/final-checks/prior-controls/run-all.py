import os,json,subprocess,pathlib,time
O=pathlib.Path(__file__).resolve().parent; R=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406'); A=R/'packages/tools/blender/characters/animations/thalune-run-candidate'
r=json.loads((A/'readiness.json').read_text()); py=r['rgbPrimary']['python'];env={**os.environ,'PATH':r['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MKL_NUM_THREADS':'1'}
rows=[]
for name,argv,expected in [
 ('supplied224',[py,'-B',str(O/'run-controls.py')],0),
 ('supplied78',[py,'-B',str(O/'run-new-bound.py')],0),
 ('revision05-74',[py,'-B',str(A/'revision05-controls.py'),'--report',str(O/'revision05-74.json')],0),
 ('retained-adverse17',[py,'-B',str(O/'adverse-green.py')],0),
 ('native-preflight',[py,'-B',str(A/'native189.py')],0),
 ('native-disabled',[py,'-B',str(A/'native189.py'),'--execute'],1),
]:
 start=time.monotonic()
 with (O/(name+'.stdout')).open('wb') as out,(O/(name+'.stderr')).open('wb') as err:p=subprocess.run(argv,cwd=R,env=env,stdout=out,stderr=err,timeout=400)
 row=dict(name=name,argv=argv,cwd=str(R),exitCode=p.returncode,expected=expected,elapsedSeconds=time.monotonic()-start);rows.append(row);(O/'commands.json').write_text(json.dumps(dict(environment={k:env[k] for k in ['PATH','PYTHONDONTWRITEBYTECODE','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']},commands=rows),indent=2))
 print(name,p.returncode,flush=True)
 assert p.returncode==expected,(O/(name+'.stderr')).read_text()[-3000:]
print('PASS supplied393 plus native preflight and disabled refusal',flush=True)
