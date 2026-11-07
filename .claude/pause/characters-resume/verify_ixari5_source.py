from pathlib import Path
import hashlib,json,os,subprocess
root=Path.cwd();stage=root/'.claude/pause/characters-resume/ixari5';source=stage/'ixari_final.blend'
geometry=json.loads((stage/'ixari.geometry.json').read_text());materials=json.loads((stage/'ixari_final.materials.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert materials['source_sha256']==geometry['output_sha256'] and sha(source)==materials['output_sha256']
env={**os.environ,'OPENBLAS_NUM_THREADS':'2','OMP_NUM_THREADS':'2'}
def run(script,args,input=None):
 cmd=['/Applications/Blender.app/Contents/MacOS/Blender','-b']+([str(input)] if input else ['--factory-startup'])+['-t','2','--python-exit-code','1','-P',str(script),'--',*map(str,args)]
 print('RUN',cmd,flush=True);subprocess.run(cmd,cwd=root,env=env,check=True)
run(root/'packages/tools/blender/characters/revision_invariants.py',[root/'assets/blend/characters/ixari.blend',source,stage/'revision-invariants.json'])
run(root/'packages/tools/blender/validate.py',['--family','characters','--report',stage/'source-validation.json',source])
run(root/'.claude/pause/characters-resume/probe_ixari5_final.py',[],source)
print('IXARI_FIFTH_SOURCE_VERIFIED',sha(source),flush=True)
