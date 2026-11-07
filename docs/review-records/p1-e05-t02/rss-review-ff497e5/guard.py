import sys,os,json,runpy,traceback,time,contextlib
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
label,target,*args=sys.argv[1:]; target=Path(target).resolve()
ready=json.loads(Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/packages/tools/blender/characters/animations/thalune-run-candidate/readiness.json').read_text())
os.environ['PATH']=ready['pathEnvironment'];os.environ['PYTHONDONTWRITEBYTECODE']='1'
allowed_python=[sys.executable,'-B','-c','import sys;print("ready",flush=True);sys.stdin.buffer.read(1)']
events=[]
def within(p):
 if isinstance(p,int):return True
 return Path(os.fsdecode(p)).resolve().is_relative_to(ROOT)
def audit(event,a):
 if event=='open':
  path,mode,flags=a
  if flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND):
   assert within(path),'outside write refused: '+str(path)
 elif event in ('os.remove','os.rmdir','os.mkdir','os.chmod','os.chown','os.truncate','os.utime'):
  assert within(a[0]),'outside mutation refused: '+str(a)
 elif event in ('os.rename','os.link','os.symlink'):
  assert within(a[0]) and within(a[1]),'outside rename/link refused'
 elif event=='subprocess.Popen':
  exe,argv,wd,env=a; events.append({'event':event,'argv':argv})
  assert argv==allowed_python or (argv[0]=='/bin/ps' and argv[1]=='-p') or (argv[0].endswith('/git') and ('rev-parse' in argv or 'show' in argv or 'status' in argv or 'branch' in argv)), 'launch refused: '+str(argv)
 elif event in ('os.system','os.posix_spawn','os.fork','socket.connect','socket.bind'):
  raise AssertionError('forbidden event '+event)
sys.addaudithook(audit)
start=time.monotonic();code=0
record=dict(argv=[sys.executable,'-B',str(Path(__file__).resolve()),label,str(target),*args],cwd=os.getcwd(),pathEnvironment=os.environ['PATH'])
with (ROOT/(label+'.stdout')).open('x') as out,(ROOT/(label+'.stderr')).open('x') as err:
 with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
  sys.argv=[str(target),*args]
  try:runpy.run_path(str(target),run_name='__main__')
  except SystemExit as e:code=e.code if isinstance(e.code,int) else int(e.code is not None)
  except BaseException:traceback.print_exc();code=1
record.update(exitCode=code,seconds=time.monotonic()-start,subprocessEvents=events)
with (ROOT/(label+'.command.json')).open('x') as f:json.dump(record,f,indent=2)
size=sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())
print(json.dumps(dict(label=label,exitCode=code,seconds=record['seconds'],subprocessCount=len(events),reviewBytes=size)))
assert size<=256*1024**2,'Review exceeds fixture bound'
raise SystemExit(code)

