import sys,json,importlib.util,contextlib
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');sys.path.insert(0,str(A))
spec=importlib.util.spec_from_file_location('controls',A/'revision-12/rss-controls.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
root=Path(__file__).resolve().parent
mode=sys.argv[1]
def failure(*a,**kw):raise OSError('INDEPENDENT_TERMINAL_SINK_FAILURE')
with contextlib.ExitStack() as stack:
 if mode in ['both','proof']:stack.enter_context(patch.object(m.accounting,'save',failure))
 if mode in ['both','packet']:stack.enter_context(patch.object(m.accounting.budget,'write_json',failure))
 value=m.cleanup('old-observer-error',root/('sink-'+mode))
result=value['result']
(root/('sink-'+mode+'.json')).write_text(json.dumps(value,indent=2)+'\n')
print(json.dumps(dict(mode=mode,status=result['status'],primary=result['primaryFailure'],nativeJobs=result['nativeJobs'],terminalReleaseProved=result['terminalReleaseProved'],terminalDelivery=result['terminalDelivery'],events=value['events'])))
if mode=='both':
 assert result['terminalDelivery']['completeObservationsPersisted'] is False
 assert not result['terminalReleaseProved'],'Unpersisted terminal proof is incorrectly ReleaseProved'

