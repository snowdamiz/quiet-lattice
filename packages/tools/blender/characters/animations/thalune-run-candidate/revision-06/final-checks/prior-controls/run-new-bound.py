import pathlib,json,os,subprocess,time
O=pathlib.Path(__file__).parent;R=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';ready=json.loads((A/'readiness.json').read_text());rows=[]
env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'}
def run(name,argv):
 t=time.monotonic();p=subprocess.run(argv,cwd=R,env=env,capture_output=True,text=True,timeout=180)
 (O/(name+'.stdout')).write_text(p.stdout);(O/(name+'.stderr')).write_text(p.stderr);rows.append(dict(name=name,argv=argv,exitCode=p.returncode,seconds=time.monotonic()-t));(O/'new-bound-commands.json').write_text(json.dumps(rows,indent=2));print(name,p.returncode,p.stdout[-300:],flush=True);assert p.returncode==0,p.stderr
for name,file in [('native69-bound','native189-controls.py'),('metadata7','metadata-controls.py')]:run(name,[ready['rgbPrimary']['python'],'-B',str(A/file),'--report',str(O/(name+'.json'))])
src=(A/'revision-04/admission-redgreen.py').read_text();src=src.replace("with (A/'revision-04/admission-redgreen.json').open('x')",f"with Path({str(O/'admission-redgreen.json')!r}).open('x')")
(O/'admission-redgreen.py').write_text(src);run('admission2',[ready['rgbPrimary']['python'],'-B',str(O/'admission-redgreen.py')])
