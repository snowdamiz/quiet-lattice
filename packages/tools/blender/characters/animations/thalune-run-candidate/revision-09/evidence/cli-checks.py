from pathlib import Path
import json,os,subprocess,time
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';O=Path(__file__).parent;ready=json.loads((A/'readiness.json').read_text());plan=json.loads((A/'native189-plan.json').read_text());rows=[];paths=json.loads((A/'revision-04/current-resources.json').read_text())['prospective'];py=ready['rgbPrimary']['python'];env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'}
work=[('native-absent-grant',[py,'-B',str(A/'native189.py'),'--execute','--grant',plan['grantPath']],'FileNotFoundError'),('capture-disabled',[py,'-B',str(A/'caller.py'),'--execute','--grant',str(A/'grant.json')],'SOURCE_ONLY_RUNTIME_DISABLED'),('optimized-refused',[py,'-O',str(A/'native189.py'),'--execute','--grant',plan['grantPath']],'T02_ASSERTIONS_REQUIRED'),('legacy-native-source-preflight',[py,'-B',str(A/'native189.py')],'AssertionError'),('legacy-capture-source-preflight',[py,'-B',str(A/'caller.py'),'--preflight'],'AssertionError')]
for name,argv,needle in work:
 assert all(not os.path.lexists(r['path']) for r in paths);start=time.monotonic();r=subprocess.run(argv,cwd=R,env=env,capture_output=True,text=True,timeout=30)
 (O/(name+'.stdout')).write_text(r.stdout);(O/(name+'.stderr')).write_text(r.stderr)
 rows.append(dict(name=name,argv=argv,cwd=str(R),exitCode=r.returncode,expectedExit=1,requiredDiagnostic=needle,seconds=time.monotonic()-start,operationalPathsRemainAbsent=all(not os.path.lexists(x['path']) for x in paths)))
 (O/'cli-commands.json').write_text(json.dumps(rows,indent=2)+'\n');assert r.returncode==1 and needle in r.stdout+r.stderr and rows[-1]['operationalPathsRemainAbsent'];print(name,r.returncode)
assert plan['grantPath'] in (O/'native-absent-grant.stderr').read_text()
