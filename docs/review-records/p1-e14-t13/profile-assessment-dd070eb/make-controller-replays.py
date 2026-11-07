from pathlib import Path
out=Path(__file__).parent;root=Path.cwd();s=(root/'packages/tools/src/capture/trace_observer_packet/controller_controls.py').read_text()
s=s.replace("ROOT=pathlib.Path(__file__).resolve().parents[5]",'ROOT=pathlib.Path('+repr(str(root))+')\nMODE=os.environ["T13_DELETE_WINDOW"]')
s=s.replace('selected=sys.argv[2:] or cases',"selected=['positive']")
s=s.replace('live_writes=[]','live_writes=[];private_samples=[];deletions=[];scan_fds=set();fstat_counts={}')
s=s.replace("self.status_calls=0","self.status_calls=0;self.browser_closed=False")
s=s.replace("private=pathlib.Path(self.env['TMPDIR']);profile=private/'playwright_chromiumdev_profile-fixture';profile.mkdir()", "private=pathlib.Path(self.env['TMPDIR']);profile=private/'playwright_chromiumdev_profile-fixture';profile.mkdir()\n   shared=profile/'Default/Shared Dictionary';shared.mkdir(parents=True);(shared/'entry').write_bytes(b'CPU cache');(shared/'second').write_bytes(b'payload')")
s=s.replace('if self.status_calls>=2:',"if self.status_calls>=(3 if MODE=='close-profile' else 2):")
s=s.replace("return [] if self.released else [rows[0]] if self.ended else rows", "return [] if self.released else [rows[0]] if self.ended or self.browser_closed else rows")
s=s.replace('(not j.ended or r is rows[0])','(not (j.ended or j.browser_closed) or r is rows[0])')
insertion='''
  if created and pathlib.Path(path)==pathlib.Path(created[-1].env['TMPDIR']) and k.get('hash_files') is False:
   private_samples.append(True)
   if len(private_samples)==(2 if MODE=='close-profile' else 1):
    import shutil
    target=pathlib.Path(path)/'playwright_chromiumdev_profile-fixture/Default/Shared Dictionary'
    go,done=threading.Event(),threading.Event();errors=[];main=threading.current_thread();stat,opening,fstat,scanning=os.stat,os.open,os.fstat,os.scandir
    def writer():
     try:
      assert go.wait(4)
      if MODE=='rename-held':target.rename(target.with_name('Renamed Dictionary'))
      else:shutil.rmtree(target.parents[1] if MODE=='close-profile' else target)
      if MODE=='close-profile':created[-1].browser_closed=True
     except BaseException as error:errors.append(metadata.failure(error))
     finally:done.set()
    def trigger():
     if not deletions:deletions.append({'mode':MODE,'target':str(target)});go.set();assert done.wait(4)
    def observed_stat(name,*args,**kwargs):
     active=threading.current_thread() is main and str(name)=='Shared Dictionary' and kwargs.get('dir_fd') is not None
     if active and MODE=='before-stat':trigger()
     info=stat(name,*args,**kwargs)
     if active and MODE=='after-stat':trigger()
     return info
    def opened(name,*args,**kwargs):
     fd=opening(name,*args,**kwargs)
     if threading.current_thread() is main and str(name)=='Shared Dictionary':
      scan_fds.add(fd)
      if MODE=='after-open':trigger()
     return fd
    def observed_fstat(fd):
     if threading.current_thread() is main and fd in scan_fds:
      fstat_counts[fd]=fstat_counts.get(fd,0)+1
      if MODE=='before-final-fstat' and fstat_counts[fd]==3:trigger()
     return fstat(fd)
    class Scan:
     def __init__(self,iterator):self.iterator=iterator
     def __enter__(self):self.iterator.__enter__();return self
     def __exit__(self,*args):
      value=self.iterator.__exit__(*args)
      if MODE=='after-scandir':trigger()
      return value
     def __iter__(self):return self
     def __next__(self):
      entry=next(self.iterator)
      if MODE=='during-scandir':trigger()
      return entry
    def enumerate_fd(fd):
     if threading.current_thread() is main and fd in scan_fds:
      if MODE in ('before-scandir','rename-held','close-profile'):trigger()
      return Scan(scanning(fd))
     return scanning(fd)
    worker=threading.Thread(target=writer);worker.start()
    try:
     with patch.object(os,'stat',observed_stat),patch.object(os,'open',opened),patch.object(os,'fstat',observed_fstat),patch.object(os,'scandir',enumerate_fd):return realledger(path,*a,**k)
    finally:go.set();worker.join(3);assert not worker.is_alive() and not errors
'''
s=s.replace(' def ledger(path,*a,**k):',' def ledger(path,*a,**k):'+insertion)
s=s.replace("with patch.object(metadata.os,'fchmod',chmod),", "with patch.object(boundary.os,'kill',side_effect=AssertionError('Actual signals forbidden')),patch.object(boundary.subprocess,'Popen',side_effect=AssertionError('Actual child launch forbidden')),patch.object(metadata.os,'fchmod',chmod),")
s=s.replace("assert result['candidate'] is True,result\n", "assert result['candidate'] is True,result['failure']\n  assert deletions\n  assert result['frozenTerminalLedger']['complete'] and result['outputLedger']['complete']\n  assert all(s['complete'] is False and s['sampleComplete'] is True for s in result['latestLiveResourceSamples'].values())\n  (case/'delete-observations.json').write_text(json.dumps({'windows':deletions,'privateSamples':len(private_samples),'samples':result['latestLiveResourceSamples'],'browserClosedInPort':created[-1].browser_closed},indent=2))\n")
(out/'controller-replay.py').write_text(s)
