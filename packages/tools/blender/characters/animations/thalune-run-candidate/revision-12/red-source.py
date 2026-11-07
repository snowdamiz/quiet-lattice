"""Repeat the five premise controls against exact retained pre-edit source bytes."""
import hashlib,json,runpy,sys,types
from pathlib import Path
sys.dont_write_bytecode=True
D=Path(__file__).resolve().parent;A=D.parent;sys.path.insert(0,str(A))
baseline=json.loads((D/'baseline.json').read_text());scratch=Path(baseline['scratch'])
for name in ['resource_admission','caller','native189']:
    original=next(r for r in baseline['source'] if Path(r['path']).name==name+'.py')
    data=(scratch/(name+'.py')).read_bytes();assert hashlib.sha256(data).hexdigest()==original['sha256']
    module=types.ModuleType(name);module.__file__=str(A/(name+'.py'));sys.modules[name]=module
    exec(compile(data,module.__file__,'exec'),module.__dict__)
sys.argv=[str(D/'rss-controls.py'),sys.argv[1]]
runpy.run_path(str(D/'rss-controls.py'),run_name='__main__')
