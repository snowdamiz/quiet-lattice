import pathlib,json,os,subprocess,time
O=pathlib.Path(__file__).parent; R=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406'); A=R/'packages/tools/blender/characters/animations/thalune-run-candidate'
ready=json.loads((A/'readiness.json').read_text()); env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2'};py=ready['rgbPrimary']['python']; rows=[]
def run(name,argv,timeout=180):
 t=time.monotonic();p=subprocess.run(argv,cwd=R,env=env,capture_output=True,text=True,timeout=timeout)
 (O/(name+'.stdout')).write_text(p.stdout);(O/(name+'.stderr')).write_text(p.stderr)
 rows.append(dict(name=name,argv=argv,cwd=str(R),exitCode=p.returncode,seconds=time.monotonic()-t));(O/'final-commands.json').write_text(json.dumps(rows,indent=2)+'\n')
 print(name,p.returncode,p.stdout[-700:],flush=True); assert p.returncode==0,p.stderr[-3000:]
run('freeze',[py,'-B',str(A/'freeze.py')])
F=O/'final-controls';F.mkdir()
for name in ['run-controls.py','run-new-bound.py']:
 s=(pathlib.Path('/tmp/t02-native189-independent-VXo4dc')/name).read_text()
 if name=='run-controls.py':s=s.replace("env={**os.environ,'TMPDIR'", "env={**os.environ,'PATH':ready['pathEnvironment'],'TMPDIR'")
 (F/name).write_text(s)
 run(name[:-3],[py,'-B',str(F/name)],300)
old=json.loads((A/'revision-04/commands.json').read_text())['commands']
for row in old:
 if row['name'] in ['typecheck','lint','format']:run(row['name'],row['argv'],300)
run('python-parse',[py,'-B','-c',f"import ast,pathlib; files=list(pathlib.Path({str(A)!r}).glob('*.py')); [ast.parse(p.read_text(),filename=str(p)) for p in files]; print('PASS',len(files),'Python AST files')"])
