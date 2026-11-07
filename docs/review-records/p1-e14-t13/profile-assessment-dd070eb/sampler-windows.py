from pathlib import Path
import sys,json,threading,os,shutil,errno
from unittest.mock import patch
sys.path.insert(0,str(Path.cwd()/'packages/tools/src/capture/trace_observer_packet'));import metadata as m
out=Path(__file__).parent/'sampler-windows';out.mkdir();results=[]
modes=['before-stat','after-stat','after-open','before-scandir','during-scandir','after-scandir','before-final-fstat','rename-held','delete-profile-held','delete-private-root','unknown-eio']
for mode in modes:
 case=out/mode;case.mkdir();root=case/'private-tmp';target=root/'playwright_chromiumdev_profile-fixture/Default/Shared Dictionary';target.mkdir(parents=True);(target/'entry').write_bytes(b'bounded CPU cache');(target/'second').write_bytes(b'payload')
 go,done=threading.Event(),threading.Event();errors=[];triggered=[];main=threading.current_thread();fds=set();stat,opening,fstat,scandir=os.stat,os.open,os.fstat,os.scandir;fstat_calls={};observations=[]
 def writer():
  try:
   assert go.wait(5)
   if mode=='rename-held':target.rename(target.with_name('Renamed Dictionary'))
   else:shutil.rmtree(root if mode=='delete-private-root' else target.parents[1] if mode=='delete-profile-held' else target)
  except BaseException as e:errors.append(m.failure(e))
  finally:done.set()
 worker=threading.Thread(target=writer);worker.start()
 def trigger():
  if not triggered:triggered.append(True);go.set();assert done.wait(5)
 def observed_stat(path,*a,**kw):
  relevant=threading.current_thread() is main and str(path)=='Shared Dictionary' and kw.get('dir_fd') is not None
  if relevant and mode=='before-stat':trigger()
  info=stat(path,*a,**kw)
  if relevant and mode=='after-stat':trigger()
  return info
 def opened(path,*a,**kw):
  fd=opening(path,*a,**kw)
  if threading.current_thread() is main and str(path)=='Shared Dictionary':
   fds.add(fd);observations.append({'opened':m.stamp(fstat(fd))})
   if mode=='after-open':trigger()
  return fd
 def observed_fstat(fd):
  if threading.current_thread() is main and fd in fds:
   fstat_calls[fd]=fstat_calls.get(fd,0)+1
   if mode=='before-final-fstat' and fstat_calls[fd]==3:trigger()
   info=fstat(fd);observations.append({'fstat':m.stamp(info),'nlink':info.st_nlink});return info
  return fstat(fd)
 class Scan:
  def __init__(self,iterator):self.iterator=iterator
  def __enter__(self):self.iterator.__enter__();return self
  def __exit__(self,*args):
   value=self.iterator.__exit__(*args)
   if mode=='after-scandir':trigger()
   return value
  def __iter__(self):return self
  def __next__(self):
   entry=next(self.iterator)
   if mode=='during-scandir':trigger()
   return entry
 def scanning(fd):
  if threading.current_thread() is main and fd in fds:
   if mode in ('before-scandir','rename-held','delete-profile-held','delete-private-root','unknown-eio'):trigger()
   if mode=='unknown-eio':
    error=OSError(errno.EIO,'CONTROL_UNKNOWN_ENUMERATION');error.unknown=b'raw\xff';raise error
   return Scan(scandir(fd))
  return scandir(fd)
 try:
  with m.io_deadline(8),patch.object(os,'stat',observed_stat),patch.object(os,'open',opened),patch.object(os,'fstat',observed_fstat),patch.object(os,'scandir',scanning):
   sample=m.ledger(root,count=64,cap=4096,hash_files=False,live=True)
  results.append({'mode':mode,'sample':sample,'descriptorObservations':observations})
 except BaseException as error:results.append({'mode':mode,'failure':m.failure(error),'descriptorObservations':observations})
 finally:go.set();worker.join(3);assert not worker.is_alive() and not errors
 assert triggered
(out/'results.json').write_text(json.dumps(results,indent=2))
print(json.dumps([{'mode':r['mode'],'failure':r.get('failure',{}).get('message'),'sampleComplete':r.get('sample',{}).get('sampleComplete')} for r in results],indent=2))
expected_refusal={'delete-private-root','unknown-eio'}
assert all(('failure' in r)==(r['mode'] in expected_refusal) for r in results)
assert all(r['sample']['complete'] is False for r in results if 'sample' in r)
