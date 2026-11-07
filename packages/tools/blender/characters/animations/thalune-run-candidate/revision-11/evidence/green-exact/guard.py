from common import *
import sys,runpy,tempfile
target=Path(sys.argv[1]);sys.argv=sys.argv[1:]
scratch=O/('scratch-'+target.stem+('-base' if '--base' in sys.argv else ''));scratch.mkdir()
original_mkdtemp=tempfile.mkdtemp
def mkdtemp(suffix=None,prefix=None,dir=None):return original_mkdtemp(suffix=suffix,prefix=prefix,dir=scratch)
tempfile.mkdtemp=mkdtemp
events=[]
def audit(event,args):
    if event=='subprocess.Popen':
        executable,argv,*_=args
        assert Path(executable).name=='git' and any(x in argv for x in ['show','rev-parse']),str(args)
        events.append(dict(event=event,argv=argv))
    if event in ['os.system','os.posix_spawn','os.fork','socket.connect']:raise AssertionError('Forbidden runtime port '+event)
    if event=='open':
        p,mode,flags=args
        if isinstance(p,(str,bytes,os.PathLike)) and (flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND)):
            assert Path(os.fsdecode(p)).resolve().is_relative_to(O),'Write outside review '+str(p)
    if event in ['os.mkdir','os.remove','os.rmdir','os.rename','os.chmod','os.symlink','os.link']:
        ps=args[:2] if event in ['os.rename','os.link'] else args[:1]
        assert all(Path(os.fsdecode(p)).resolve().is_relative_to(O) for p in ps),'Mutation outside review '+str(args)
sys.addaudithook(audit)
sys.path.insert(0,str(A))
try:runpy.run_path(str(target),run_name='__main__')
finally:save('guard-'+scratch.name+'.json',dict(target=str(target),allowedProcesses=events,nativeProcesses=0,writeScope=str(O)))
