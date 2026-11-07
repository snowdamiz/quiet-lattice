import pathlib,json,subprocess,sys,tempfile,shutil,hashlib,datetime
root=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=root/'packages/tools/blender/characters/animations/thalune-run-candidate';out=A/'revision-03';snapshot=pathlib.Path(tempfile.mkdtemp(prefix='thalune-combined-controls-',dir='/tmp'))/'isolated/source/candidate';snapshot.mkdir(parents=True)
files=[p for p in A.iterdir() if p.is_file()];hashes=[]
for p in files:shutil.copyfile(p,snapshot/p.name);hashes.append(dict(path=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
shutil.copytree(A/'retained-station',snapshot/'retained-station')
(out/'candidate-source-copy-final.json').write_text(json.dumps(dict(path=str(snapshot),files=hashes),indent=2)+'\n')
ready=json.loads((A/'readiness.json').read_text());node=ready['node'];python=ready['rgbPrimary']['python'];rows=[]
def run(name,argv,expect=0,needle=None):
 p=subprocess.run(argv,cwd=root,capture_output=True,text=True,timeout=120);row=dict(name=name,argv=argv,exitCode=p.returncode,stdout=p.stdout,stderr=p.stderr);rows.append(row);(out/'candidate-commands-final.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(dict(name=name,exit=p.returncode,stdout=p.stdout[:350])),flush=True);assert p.returncode==expect and (needle is None or needle in p.stderr),row
run('node-18',[node,str(snapshot/'controls.mjs')]);shutil.copyfile(snapshot/'pure-node-controls.json',out/'pure-node-controls-final.json')
run('python-108',[python,'-B',str(snapshot/'controls.py')]);shutil.copyfile(snapshot/'pure-python-controls.json',out/'pure-python-controls-final.json')
run('evidence-20',[python,'-B',str(snapshot/'evidence-controls.py'),'--report',str(out/'evidence-controls-final.json')])
run('terminal-30',[python,'-B',str(snapshot/'terminal-controls.py'),'--report',str(out/'terminal-controls-final.json')])
for label,argv,needle in [('caller-disabled',[python,'-B',str(A/'caller.py'),'--execute'],'SOURCE_ONLY_RUNTIME_DISABLED'),('optimized-disabled',[python,'-B','-O',str(A/'caller.py'),'--execute'],'T02_ASSERTIONS_REQUIRED'),('node-disabled',[node,str(A/'entry.mjs'),str(A/'readiness.json'),'motion-thalune-run-lod0',str(A/'future-attempt/packet/captures/motion-thalune-run-lod0')],'runtime disabled'),('worker-disabled',[python,'-B',str(A/'rgb-primary.py'),'validate-primary',str(A/'no-config.json')],'SOURCE_ONLY_RUNTIME_DISABLED')]:run(label,argv,1,needle)
assert not (A/'future-attempt').exists() and not (A/'consumed-attempt.json').exists() and not (A/'grant.json').exists()
run('preflight',[python,'-B',str(A/'caller.py'),'--preflight'])
run('timed-12',[python,'-B',str(A/'timed-controls.py'),'--report',str(out/'timed-controls-final.json')])
print(json.dumps(dict(status='PASS',existingControls=180,additionalTimedControls=12,sourceSnapshot=str(snapshot),nativeJobs=0)),flush=True)
