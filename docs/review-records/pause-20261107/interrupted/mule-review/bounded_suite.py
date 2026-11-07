import os, runpy, subprocess, sys, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent
os.environ['TMPDIR']=str(root/'tmp')
os.environ['PYTHONDONTWRITEBYTECODE']='1'
tempfile.tempdir=str(root/'tmp')
sys.dont_write_bytecode=True
class RejectNative:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in ('bpy','numpy','mathutils'):
            raise RuntimeError('Forbidden native import: '+fullname)
sys.meta_path.insert(0, RejectNative())
real_run=subprocess.run
def bounded_run(*a, **kw):
    kw['timeout']=min(kw.get('timeout',5),5)
    return real_run(*a,**kw)
subprocess.run=bounded_run
script=Path(sys.argv[1]); sys.argv=[str(script),*sys.argv[2:]]
sys.path.insert(0,str(script.parent))
runpy.run_path(str(script),run_name='__main__')
