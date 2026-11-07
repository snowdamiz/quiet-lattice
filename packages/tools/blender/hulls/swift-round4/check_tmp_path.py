"""Reproduce the actual tsx CLI IPC failure at the long path and prove the short alias fixes it."""
import json,os,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[5];job=Path(os.environ['SWIFT_JOB']);command=['node',str(root/'node_modules/tsx/dist/cli.mjs'),'-e','console.log("SWIFT_TSX_READY")']
old=os.environ.copy();old['TMPDIR']=str(job/'scratch')
red=subprocess.run(command,env=old,capture_output=True,text=True,timeout=20)
green=subprocess.run(command,env=os.environ.copy(),capture_output=True,text=True,timeout=20)
assert red.returncode!=0 and 'listen' in red.stderr,red.stderr
assert green.returncode==0 and 'SWIFT_TSX_READY' in green.stdout,(green.returncode,green.stderr)
assert Path(os.environ['TMPDIR']).resolve()==(job/'scratch').resolve()
out={'status':'PASS','command':command,'longPath':str(job/'scratch'),'shortAlias':os.environ['TMPDIR'],'redExit':red.returncode,'redTail':red.stderr.splitlines()[-20:],'greenExit':green.returncode,'greenStdout':green.stdout,'aliasResolvesToOwnedScratch':True}
(job/'tmp-path-proof.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
