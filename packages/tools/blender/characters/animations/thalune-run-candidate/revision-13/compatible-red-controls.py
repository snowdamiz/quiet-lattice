"""Assert old behavior milestones; an arbitrary exception never counts as RED."""
import ast,hashlib,json,subprocess,sys,types
from pathlib import Path
sys.dont_write_bytecode=True
D=Path(__file__).resolve().parent;A=D.parent;root=Path(sys.argv[1]);root.mkdir(exist_ok=False)
sys.path.insert(0,str(A))
base='ddce6731b1fd465a1160d2f1e49813ff6f8c626c'
ready=json.loads((A/'readiness.json').read_text());repo=Path(ready['root']);pins=[]
for name in ['release_accounting','resource_admission','caller','native189']:
    p=D/'reviewed-release-accounting.py.txt' if name=='release_accounting' else A/'revision-12/evidence'/(name+'.py.base.txt')
    data=p.read_bytes();relative=str((A/(name+'.py')).relative_to(repo))
    git=subprocess.check_output(['/opt/homebrew/Cellar/git/2.56.0/bin/git','-C',str(repo),'show',base+':'+relative],timeout=5)
    assert data==git,(name,'Old source differs from Git')
    pins.append(dict(path=relative,sha256=hashlib.sha256(data).hexdigest()))
    module=types.ModuleType(name);module.__file__=str(A/(name+'.py'));sys.modules[name]=module
    exec(compile(data,module.__file__,'exec'),module.__dict__)
source=(A/'revision-12/rss-controls.py').read_text();tree=ast.parse(source);changes=[]
for node in tree.body:
    if isinstance(node,ast.FunctionDef) and node.name=='real_membership':
        for call in ast.walk(node):
            if isinstance(call,ast.Call) and isinstance(call.func,ast.Attribute) and call.func.attr=='CohortRSS':
                assert [k.arg for k in call.keywords]==['read','admit']
                call.keywords=[k for k in call.keywords if k.arg!='admit'];changes.append(call.lineno)
assert changes==[60]
values=dict(__name__='compatible_old_controls',__file__=str(A/'revision-12/rss-controls.py'))
exec(compile(tree,values['__file__'],'exec'),values)
cases=[('real-birth',lambda:values['real_membership']('birth'),'RSS cohort birth/departure/duplicate during sample'),('real-departure',lambda:values['real_membership']('departure'),'RSS reuse/departure'),('retained-replay',values['replay'],'RSS cohort birth/departure/duplicate during sample'),('cleanup-primary',lambda:values['cleanup']('old-observer-error',root/'cleanup'),'Owned drain did not prove clean release'),('cleanup-new-error',lambda:values['cleanup']('new-drain-error',root/'new-error'),'Owned drain did not prove clean release')]
rows=[]
for name,fn,expected in cases:
    value=fn();error=value.get('error') or value.get('receipt',{}).get('cleanupFailure')
    assert value['accepted'] is False and error['type']=='AssertionError' and error['message']==expected,(name,error)
    if name.startswith('real-'):
        obs=value['observations'];children=value['children'];assert len(obs)==len(children)==1
        sample=obs[0];child=children[0];pid=child['pid'];assert child['exit']==0 and child['identity'] is None and child['stderr']==''
        assert sample['rss']['bytesByPid'] and sample['rss']['stdout'] and sample['before']
        before=[r['pid'] for r in sample['members']];after=[r['pid'] for r in sample['membersAfter']]
        if name=='real-birth':assert pid not in before and pid in after and pid not in sample['rss']['bytesByPid']
        else:assert pid in before and pid not in after and pid in sample['rss']['bytesByPid'] and sample['after'][before.index(pid)] is None
    elif name=='retained-replay':
        assert value['observations'][0]['rss']['syntheticNewMemberRss'] is True
        assert value['historicalExecutable51704']=='UNOBSERVED_NOT_RETROACTIVELY_ADMITTED'
    else:
        assert value['events']==['start','drain'] and value['result']['status']=='HOLD' and value['result']['nativeJobs']==1
        assert value['receipt']['primaryFailure']['type']=='TimeoutExpired' and value['receipt']['primaryFailure']['details']['unknown']=={'retained':17}
    rows.append(dict(name=name,status='EXPECTED_REFUSAL' if name=='cleanup-new-error' else 'OLD_BEHAVIOR_REPRODUCED',details=value))
with (root/'results.json').open('x') as f:json.dump(dict(status='PASS_EXPECTED_OLD_FAILURES',base=base,productSource=pins,testOnlyChange='Omit optional admit keyword at test line60; no old product edit',fourIntendedFailures=4,negativeControls=1,rows=rows),f,indent=2)
print(json.dumps(dict(status='PASS_EXPECTED_OLD_FAILURES',fourIntendedFailures=4,negativeControls=1)))
