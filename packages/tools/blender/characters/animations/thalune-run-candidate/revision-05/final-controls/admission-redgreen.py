import hashlib,importlib.util,json,os,subprocess,sys,tempfile,types
from pathlib import Path
from unittest.mock import patch
A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A));sys.dont_write_bytecode=True
import caller,admission_json
root=Path(tempfile.mkdtemp(prefix='t02-admission-race-',dir='/tmp')).resolve();rows=[]
old_source=subprocess.check_output(['git','show','c61699dcde61ff9dee699be7e0b7d42ae06ff326:'+str((A/'caller.py').relative_to(A.parents[5]))],text=True)
old=types.ModuleType('old_caller');exec(compile(old_source,'c61699d-caller.py','exec'),old.__dict__)
for label,module in [('RED c61699d',old),('GREEN current',caller)]:
    here=root/label.replace(' ','-');here.mkdir();(here/'readiness.json').write_text('{}');(here/'candidate-index.json').write_text('{}')
    ready=dict(purpose='CPU-INERT',attemptId='CPU-INERT',jobs=[{'id':'inert'}],packetRoot=str(here/'future-attempt/packet'),proofRoot=str(here/'future-attempt/proof'))
    digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
    grant=dict(parentGpuGo=True,authorizationId='CPU-INERT',purpose=ready['purpose'],attemptId=ready['attemptId'],readinessSha256=digest(here/'readiness.json'),combinedCandidateSha256=digest(here/'candidate-index.json'),jobIds=['inert'],motionFrames=378,stills=8)
    good=(json.dumps(grant)+'\n').encode();bad=(json.dumps({**grant,'parentGpuGo':False})+'\n').encode();(here/'grant.json').write_bytes(good)
    events=[]
    def change():
        p=here/'replacement';p.write_bytes(bad);p.replace(here/'grant.json');events.append('actual grant replacement')
    def sha(p):
        answer=digest(p)
        if Path(p)==here/'readiness.json' and not events:change()
        return answer
    original=admission_json.os.fdopen
    class Stream:
        def __init__(self,s):self.s=s
        def __enter__(self):return self
        def __exit__(self,*args):return self.s.__exit__(*args)
        def fileno(self):return self.s.fileno()
        def read(self,n):
            data=self.s.read(n)
            if data==good and not events:change()
            return data
    with patch.object(module,'HERE',here),patch.object(module,'READY',here/'readiness.json'),patch.object(module,'sha',sha),patch.object(module,'verify_runtime',lambda _:dict(ready=admission_json.snapshot(here/'readiness.json'),index=admission_json.snapshot(here/'candidate-index.json'))):
        if module is caller:
            with patch.object(admission_json.os,'fdopen',lambda *a,**k:Stream(original(*a,**k))):result=module.consume(ready,here/'grant.json')
        else:result=module.consume(ready,here/'grant.json')
    expected=hashlib.sha256(bad if module is old else good).hexdigest()
    assert result['grantSha256']==expected and events
    rows.append(dict(case=label,recordedSha256=result['grantSha256'],recordBindsFailedGrant=module is old,grantedSemanticParentGpuGo=True,events=events,root=str(here),nativeJobs=0))
with Path('/tmp/t02-r5-correction-vaiwi043/final-controls/admission-redgreen.json').open('x') as f:json.dump(dict(status='PASS_RED_REPRODUCED_GREEN_BOUND_TO_PARSED_BYTES',controls=rows),f,indent=2)
print(json.dumps(dict(status='PASS',controls=2,nativeJobs=0)))
