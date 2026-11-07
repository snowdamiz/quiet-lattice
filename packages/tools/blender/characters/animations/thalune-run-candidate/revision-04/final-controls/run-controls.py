import os,sys,pathlib,json,shutil,subprocess,time,hashlib
O=pathlib.Path(__file__).parent;R=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';S=O/'snapshot/packages/tools/blender/characters/animations/thalune-run-candidate';S.mkdir(parents=True)
for p in A.iterdir():
 if p.is_file():shutil.copy2(p,S/p.name)
shutil.copytree(A/'retained-station',S/'retained-station');(S/'revision-03').mkdir()
shutil.copy2(A/'revision-03/publication-controls.mjs',S/'revision-03/publication-controls.mjs')
ready=json.loads((A/'readiness.json').read_text());py=ready['rgbPrimary']['python'];node=ready['node'];rows=[]
T=O/'tmp';T.mkdir();env={**os.environ,'TMPDIR':str(T),'PYTHONDONTWRITEBYTECODE':'1','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2'}
source_rows=[dict(path=str(p.relative_to(S)),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in S.rglob('*') if p.is_file()];(O/'scratch-source-identities.json').write_text(json.dumps(source_rows,indent=2)+'\n')
def run(name,argv,code=0,needle=None):
 start=time.monotonic();p=subprocess.run(argv,cwd=R,env=env,capture_output=True,text=True,timeout=150)
 (O/(name+'.stdout')).write_text(p.stdout);(O/(name+'.stderr')).write_text(p.stderr)
 rows.append(dict(name=name,argv=argv,cwd=str(R),exitCode=p.returncode,wallSeconds=time.monotonic()-start));(O/'control-commands.json').write_text(json.dumps(rows,indent=2)+'\n')
 print(name,p.returncode,p.stdout[-350:],flush=True);assert p.returncode==code and (needle is None or needle in p.stderr),p.stderr[-3000:]
run('node18',[node,str(S/'controls.mjs')]);fixture=json.loads((S/'pure-node-controls.json').read_text())['fixtureRoot']
run('python108',[py,'-B',str(S/'controls.py')])
run('evidence20',[py,'-B',str(S/'evidence-controls.py'),'--report',str(O/'evidence20.json')])
run('terminal30',[py,'-B',str(S/'terminal-controls.py'),'--report',str(O/'terminal30.json')])
run('publication3',[node,str(S/'revision-03/publication-controls.mjs'),fixture,str(S/'revision-03/publication-controls.json')])
run('timed12',[py,'-B',str(S/'timed-controls.py'),'--report',str(O/'timed12.json')])
for name,argv,msg in [('caller-disabled',[py,'-B',str(A/'caller.py'),'--execute'],'SOURCE_ONLY_RUNTIME_DISABLED'),('optimized-disabled',[py,'-B','-O',str(A/'caller.py'),'--execute'],'T02_ASSERTIONS_REQUIRED'),('entry-disabled',[node,str(A/'entry.mjs'),str(A/'readiness.json'),'motion-thalune-run-lod0',str(A/'future-attempt/packet/captures/motion-thalune-run-lod0')],'runtime disabled'),('worker-disabled',[py,'-B',str(A/'rgb-primary.py'),'validate-primary',str(O/'does-not-exist.json')],'SOURCE_ONLY_RUNTIME_DISABLED')]:run(name,argv,1,msg)
run('preflight',[py,'-B',str(A/'caller.py'),'--preflight'])
# Replay the previously independent R3 matrix against byte-identical current source.
prior=pathlib.Path('/tmp/thalune-review3-c8f2103-yz2rzslm/independent-boundary.py').read_text();adapted=prior.replace("ROOT/'isolated/green/candidate'",repr(str(S)))
assert adapted!=prior
(O/'prior29.py').write_text(adapted);run('prior29',[py,'-B',str(O/'prior29.py')])
for name in ['pure-node-controls.json','pure-python-controls.json']:shutil.copy2(S/name,O/name)
shutil.copy2(S/'revision-03/publication-controls.json',O/'publication3.json')
assert not (A/'future-attempt').exists() and not (A/'consumed-attempt.json').exists()
print('PASS 180 supplied + 15 cross-lane + 29 prior-independent',flush=True)
