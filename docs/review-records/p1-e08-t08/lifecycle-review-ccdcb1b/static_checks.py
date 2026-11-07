from pathlib import Path
import ast,hashlib,json,subprocess
S=Path(__file__).resolve().parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13');T=R/'packages/tools/blender/e08t08'
files=['stage.py','stage_processes.py','stage_ownership.py','finalize.py','stage_lifecycle_test.py','lifecycle_driver.py','lifecycle_worker.py']
for name in files:ast.parse((T/name).read_text(),filename=str(T/name))
checks=[]
for command in [['git','diff','--check','f9294a466d6223f695f102dc1a13ed526f155e67','HEAD'],['/bin/sh','-n',str(T/'bin/blender')]]:
 p=subprocess.run(command,cwd=R,capture_output=True,text=True,timeout=10);checks.append(dict(command=command,exit=p.returncode,output=p.stdout+p.stderr));assert p.returncode==0
result=dict(parsed=files,checks=checks,sourceSHA256={n:hashlib.sha256((T/n).read_bytes()).hexdigest() for n in files},diffSHA256=hashlib.sha256((S/'diff.txt').read_bytes()).hexdigest(),scopeSHA256=hashlib.sha256((S/'scope.txt').read_bytes()).hexdigest())
(S/'static-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
