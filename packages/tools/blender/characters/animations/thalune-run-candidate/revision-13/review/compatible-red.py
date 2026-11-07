import ast,hashlib,json,sys,types
from pathlib import Path
sys.dont_write_bytecode=True
A=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate');D=A/'revision-12';S=Path(__file__).resolve().parent
sys.path.insert(0,str(A))
baseline=json.loads((D/'baseline.json').read_text())
for name in ['resource_admission','caller','native189']:
 data=(D/'evidence'/(name+'.py.base.txt')).read_bytes()
 expected=next(r['sha256'] for r in baseline['source'] if Path(r['path']).name==name+'.py')
 assert hashlib.sha256(data).hexdigest()==expected
 module=types.ModuleType(name);module.__file__=str(A/(name+'.py'));sys.modules[name]=module
 exec(compile(data,module.__file__,'exec'),module.__dict__)
source=(D/'rss-controls.py').read_text();tree=ast.parse(source)
changes=[]
for node in tree.body:
 if isinstance(node,ast.FunctionDef) and node.name=='real_membership':
  for call in ast.walk(node):
   if isinstance(call,ast.Call) and isinstance(call.func,ast.Attribute) and call.func.attr=='CohortRSS':
    assert any(k.arg=='admit' for k in call.keywords)
    call.keywords=[k for k in call.keywords if k.arg!='admit'];changes.append(call.lineno)
assert changes==[60]
values=dict(__name__='review_controls',__file__=str(D/'rss-controls.py'))
exec(compile(tree,str(D/'rss-controls.py'),'exec'),values)
cases=[
 ('real-birth',lambda:values['real_membership']('birth'),'RSS cohort birth/departure/duplicate during sample'),
 ('real-departure',lambda:values['real_membership']('departure'),'RSS reuse/departure'),
 ('retained-replay',values['replay'],'RSS cohort birth/departure/duplicate during sample'),
 ('cleanup-primary',lambda:values['cleanup']('old-observer-error',S/'compatible-red-cleanup'),'Owned drain did not prove clean release'),
 ('cleanup-new-error',lambda:values['cleanup']('new-drain-error',S/'compatible-red-new'),'Owned drain did not prove clean release')]
rows=[]
for name,fn,expected in cases:
 value=fn();error=value.get('error') or value.get('receipt',{}).get('cleanupFailure')
 assert not value['accepted'] and error['message']==expected,(name,error)
 rows.append(dict(name=name,classification='EXPECTED_NEGATIVE' if name=='cleanup-new-error' else 'BASE_BEHAVIOR_REPRODUCED',details=value))
(S/'compatible-red.json').write_text(json.dumps(dict(base=baseline['base'],sourceSha256=hashlib.sha256(source.encode()).hexdigest(),testOnlyASTChange='Omit new optional admit keyword only at real_membership constructor line60; three old product modules executed byte-identically',changes=changes,rows=rows),indent=2)+'\n')
print(json.dumps(dict(reproduced=4,negative=1,errors=[r['details'].get('error') or r['details'].get('receipt',{}).get('cleanupFailure') for r in rows])))
raise SystemExit(1)

