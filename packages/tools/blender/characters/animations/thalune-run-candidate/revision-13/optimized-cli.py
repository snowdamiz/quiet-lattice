"""Preserve real SystemExit diagnostics while instrumenting the optimized CLI."""
import json,os,runpy,sys
from pathlib import Path
sys.dont_write_bytecode=True
A=Path(__file__).resolve().parent.parent;proof=Path(sys.argv[1]);events=[]
ready=json.loads((A/'readiness.json').read_text());plan=json.loads((A/'native189-plan.json').read_text())
os.environ['PATH']=ready['pathEnvironment'];sys.path.insert(0,str(A))
def audit(event,args):
    if event in ['subprocess.Popen','os.system','os.posix_spawn','os.fork','socket.connect','socket.bind']:
        events.append(dict(event=event,args=str(args)));raise RuntimeError('Launch forbidden in optimized CLI fixture')
sys.addaudithook(audit)
sys.argv=[str(A/'native189.py'),'--execute','--grant',plan['grantPath']]
try:runpy.run_path(str(A/'native189.py'),run_name='__main__')
finally:
    with proof.open('x') as f:json.dump(dict(optimize=sys.flags.optimize,launchEvents=events,argv=sys.argv),f,indent=2)
