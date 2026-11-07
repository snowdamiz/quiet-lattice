from pathlib import Path
import json,os,subprocess,time,shutil
O=Path(__file__).parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';ready=json.loads((A/'readiness.json').read_text());env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'};py=ready['rgbPrimary']['python'];rows=[]
def run(name,argv,expected=0,timeout=180):
 start=time.monotonic()
 with (O/(name+'.stdout')).open('wb') as out,(O/(name+'.stderr')).open('wb') as err:p=subprocess.run(argv,cwd=R,env=env,stdout=out,stderr=err,timeout=timeout)
 rows.append(dict(name=name,argv=argv,cwd=str(R),exitCode=p.returncode,expected=expected,seconds=time.monotonic()-start));(O/'final-commands.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True);assert p.returncode==expected,(O/(name+'.stderr')).read_text()[-2500:]
run('freeze',[py,'-B',str(A/'freeze.py')])
P=O/'prior';P.mkdir()
for name in ['run-controls.py','run-new-bound.py','run-all.py','adverse-green.py']:
 s=(A/'revision-06/final-checks/prior-controls'/name).read_text()
 if name=='run-controls.py':
  key="assert adapted!=prior"
  replace='''assert adapted!=prior
adapted=adapted.replace('real_rglob=Path.rglob','real_inventory=release.budget.inventory').replace('def rglob(self,pattern):','def inventory(self):').replace('return real_rglob(self,pattern)','return real_inventory(self)').replace("(Path,'rglob',rglob)","(release.budget,'inventory',inventory)")'''
  assert key in s;s=s.replace(key,replace)
 (P/name).write_text(s)
run('prior393',[py,'-B',str(P/'run-all.py')],timeout=400)
run('prior47',[py,'-B',str(A/'revision06-controls.py'),'--report',str(O/'prior47.json')])
run('new39',[py,'-B',str(A/'revision07-controls.py'),'--report',str(O/'new39.json')])
run('new28',[py,'-B',str(A/'revision08-controls.py'),'--report',str(O/'new28.json')])
G=O/'independent11';G.mkdir()
for name in ['independent','observer-native','close-failures']:
 (G/(name+'.py')).write_bytes((A/'revision-07/green-repros'/(name+'.py')).read_bytes())
 run(name,[py,'-B',str(G/(name+'.py'))])
G=O/'independent7';G.mkdir()
(G/'additional.py').write_bytes((O.parent/'green-final/additional.py').read_bytes())
run('additional7',[py,'-B',str(G/'additional.py')])
for row in json.loads((A/'revision-04/commands.json').read_text())['commands']:
 if row['name'] in ['typecheck','lint','format']:run(row['name'],row['argv'],timeout=300)
run('syntax',[py,'-B','-c',f"import ast,pathlib; ps=list(pathlib.Path({str(A)!r}).glob('*.py')); [ast.parse(p.read_text(),filename=str(p)) for p in ps]; print('PASS',len(ps),'root Python AST files')"])
