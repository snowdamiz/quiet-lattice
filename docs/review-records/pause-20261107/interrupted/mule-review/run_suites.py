import json, os, subprocess, sys, time
from pathlib import Path
out=Path(__file__).resolve().parent
src=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-348f0295/packages/tools/blender/hulls/mule-phase-instrumentation')
suites=[('supplied-17',src/'test_phase_log.py'),('corrections-15',src/'test_corrections.py'),('legacy-13-expected-red',out/'adversarial_review.py'),('author-behavior-3',out/'candidate_behavior.py')]
results=[]
for name,path in suites:
    start=time.monotonic()
    p=subprocess.run([sys.executable,'-B',str(out/'bounded_suite.py'),str(path),'-v'],capture_output=True,text=True,timeout=30,env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',TMPDIR=str(out/'tmp')))
    (out/(name+'.txt')).write_text(p.stdout+p.stderr)
    results.append(dict(name=name,returncode=p.returncode,seconds=time.monotonic()-start,log=name+'.txt'))
    print(name,p.returncode,p.stderr.splitlines()[-1] if p.stderr else '',flush=True)
(out/'suite-results.json').write_text(json.dumps(results,indent=2)+'\n')
