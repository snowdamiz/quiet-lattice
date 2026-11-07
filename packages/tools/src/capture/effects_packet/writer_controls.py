"""Real owned CPU publishers exercise every mutable writer and settled boundary; no native runtime."""
import contextlib,json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path.cwd()/'packages/tools/src/capture/effects_packet'))
import native_ports
from evidence import failure
E=Path(__file__).parent
WRITER='''import json,pathlib,shutil,sys
root=pathlib.Path(sys.argv[1]).resolve()
for line in sys.stdin:
 req=json.loads(line);src=pathlib.Path(req['source']);dst=pathlib.Path(req['destination'])
 assert src.is_relative_to(root) and dst.is_relative_to(root) and src!=root
 if req['action']=='rename':src.rename(dst)
 else:shutil.rmtree(src)
 print(json.dumps({'performed':req,'pid':__import__('os').getpid()}),flush=True)
'''

def run_case(category,action, *, settled=False, wait=False):
 root=Path(tempfile.mkdtemp(prefix=category+'-'+action+'-',dir=E))
 for n in ('tmp','scratch','out','cache'):(root/n).mkdir()
 profile=root/'tmp/playwright_chromiumdev_profile-owned';profile.mkdir()
 roots={'profile':profile,'tmp':root/'tmp','cache':root/'cache','helper':root/'scratch','profile-whole':profile}
 parent=roots[category];pending=parent/'changing-directory';pending.mkdir();(pending/'payload').write_bytes(b'x'*137)
 port=native_ports.NativePorts.__new__(native_ports.NativePorts);port.result={'raw':{}};port.tmp=root/'tmp';port.ready={'generatedCaches':[str(root/'cache')],'initialCacheBytes':137,'pilot':{'output':str(root/'out')}}
 job=SimpleNamespace(scratch=root/'scratch',out=root/'out',state={'drained': settled, 'kernel_terminal': {'live': 0 if settled else None}, 'remaining': [] if settled else None, 'exits': {}, 'errors': []});proc=subprocess.Popen([sys.executable,'-B','-c',WRITER,str(root)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 receipts=[];original_lstat,original_stat=Path.lstat,os.stat
 def trigger():
  if receipts:return
  src=profile if category=='profile-whole' else pending
  req={'source':str(src),'destination':str(src.with_name(src.name+'-published')),'action':action}
  proc.stdin.write(json.dumps(req)+'\n');proc.stdin.flush();receipts.append(json.loads(proc.stdout.readline()))
 def lstat(path,*a,**kw):
  if path==pending:trigger()
  return original_lstat(path,*a,**kw)
 def stat(path,*a,**kw):
  if str(path)=='changing-directory' and kw.get('follow_symlinks') is False:trigger()
  return original_stat(path,*a,**kw)
 error=None;outcome=None
 if wait:
  from revision_controls import extract
  import signal,time
  ns=extract('round4_job_boundary.py',['StationJob','deadline','DeadlineExpired'],{'signal':signal,'time':time,'contextmanager':contextlib.contextmanager})
  job.status=lambda:{'exits':job.state['exits']};job.members=lambda:job.state['exits'].update(capture=0);job.save=lambda:None
 try:
  with native_ports.phase(4),patch.object(Path,'lstat',lstat),patch.object(os,'stat',stat):
   try:
    if wait:outcome=ns['StationJob'].wait(job,3,observer=lambda:port.budgets(job))
    else:port.budgets(job,for_archive=settled)
   except BaseException as e:error=failure(e)
 finally:
  proc.stdin.close();proc.wait(timeout=2);stderr=proc.stderr.read();assert proc.returncode==0 and not stderr
 assert receipts
 return {'category':category,'action':action,'error':error,'outcome':outcome,'jobState':job.state,'observation':port.result['raw'],'writer':{'pid':proc.pid,'exit':proc.returncode,'receipts':receipts},'scratchRetained':str(root)}

import signal
import stat
import unittest
import live_cache
import controls
import caller
import bindings
import evidence
from contract import Refused,MIB
from boundary_controls import inert_clear


class WriterControls(unittest.TestCase):
    def setUp(self):
        global E
        self.temp=tempfile.TemporaryDirectory(prefix='effects-writer-controls-',dir='/private/tmp')
        self.root=Path(self.temp.name);E=self.root
        for n in ('tmp','scratch','out','cache'):(self.root/n).mkdir()
        self.profile=self.root/'tmp/playwright_chromiumdev_profile-owned';self.profile.mkdir()
        self.port=native_ports.NativePorts.__new__(native_ports.NativePorts)
        self.port.result={'raw':{}};self.port.tmp=self.root/'tmp'
        self.port.ready={'generatedCaches':[str(self.root/'cache')],'initialCacheBytes':0,'pilot':{'output':str(self.root/'out')}}
        self.job=SimpleNamespace(scratch=self.root/'scratch',out=self.root/'out',state={'drained':False,'kernel_terminal':{'live':None},'remaining':None})
    def tearDown(self):self.temp.cleanup()

    @contextlib.contextmanager
    def writer(self):
        program=WRITER.replace("else:shutil.rmtree(src)","elif req['action']=='grow':\n  with src.open('r+b') as f:f.truncate(req['bytes'])\n else:shutil.rmtree(src)")
        process=subprocess.Popen([sys.executable,'-B','-c',program,str(self.root)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        receipts=[]
        def command(action,source,destination=None,bytes=None):
            req={'action':action,'source':str(source),'destination':str(destination or source),'bytes':bytes}
            process.stdin.write(json.dumps(req)+'\n');process.stdin.flush();receipt=json.loads(process.stdout.readline());receipts.append(receipt);return receipt
        try:
            with native_ports.phase(5):yield command,receipts
        finally:
            process.stdin.close()
            try:process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill();process.wait(timeout=2);raise
            self.assertEqual(process.returncode,0);self.assertEqual(process.stderr.read(),'')

    def drained(self):
        self.job.state={'drained':True,'kernel_terminal':{'live':0},'remaining':[]}

    def test_real_owned_publishers_all_live_categories(self):
        for category in ('profile','tmp','helper','cache'):
            for action in ('rename','delete'):
                with self.subTest(category=category,action=action):
                    result=run_case(category,action)
                    self.assertIsNone(result['error']);self.assertEqual(result['writer']['exit'],0)
                    sample=result['observation']['lastWriterObservation'];self.assertTrue(sample['complete'])
                    self.assertFalse(sample['resourceReleaseProved'])
                    self.assertEqual(sum(sample[k] for k in ('profileBytes','privateTmpNonprofileBytes','helperBytes','cacheBytes')),137 if action=='rename' else 0)
        whole=run_case('profile-whole','delete')
        self.assertIsNone(whole['error']);self.assertTrue(whole['observation']['writerProfilesObserved'])
        self.assertEqual(whole['observation']['lastWriterObservation']['profileBytes'],0)
        self.assertFalse(whole['observation']['lastWriterObservation']['resourceReleaseProved'])

    def test_actual_helper_wait_can_finish_after_normal_profile_shutdown(self):
        result=run_case('profile-whole','delete',wait=True)
        self.assertEqual(result['outcome'],'completed')
        self.assertEqual(result['jobState']['exits'],{'capture':0})
        self.assertFalse(result['jobState']['drained'])
        self.assertEqual(result['jobState']['errors'],[])
        self.assertTrue(result['observation']['writerPublicationObservations'])

    def test_paced_profile_shutdown_completes_within_shared_window(self):
        for i in range(20):
            child=self.profile/f'group{i:02d}';child.mkdir()
            for j in range(10):(child/f'{j}.bin').write_bytes(b'x'*137)
        program="""from pathlib import Path
import shutil,sys,time
p=Path(sys.argv[1]);sys.stdin.readline();shutil.rmtree(p/'group00');print('started',flush=True)
for child in sorted(p.iterdir()):
 time.sleep(.002);shutil.rmtree(child)
p.rmdir();print('finished',flush=True)
"""
        child=subprocess.Popen([sys.executable,'-B','-c',program,str(self.profile)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        actual=os.stat;fired=[]
        def observed(path,*a,**kw):
            if str(path)=='group00' and not fired:
                fired.append(True);child.stdin.write('go\n');child.stdin.flush()
                self.assertEqual(child.stdout.readline().strip(),'started')
            return actual(path,*a,**kw)
        try:
            with native_ports.phase(3),patch.object(os,'stat',observed):self.port.budgets(self.job)
            self.assertEqual(child.stdout.readline().strip(),'finished')
        finally:
            child.stdin.close()
            try:child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill();child.wait(timeout=2);raise
        self.assertEqual(child.returncode,0);self.assertEqual(child.stderr.read(),'')
        history=self.port.result['raw']['writerPublicationObservations'];self.assertTrue(history)
        self.assertLessEqual(history[0]['metadataEvents'],live_cache.ENTRY_CAP)
        self.port.budgets(self.job)
        self.assertEqual(self.port.result['raw']['lastWriterObservation']['profileBytes'],0)
        self.assertFalse(self.port.result['raw']['lastWriterObservation']['resourceReleaseProved'])

    def test_settled_mutations_refuse_without_retry(self):
        for category in ('profile','tmp','helper','cache','profile-whole'):
            with self.subTest(category=category):
                result=run_case(category,'delete',settled=True)
                self.assertIsNotNone(result['error']);self.assertFalse(result['observation']['lastWriterObservation']['complete'])
                for sample in result['observation']['writerPublicationObservations']:
                    self.assertEqual(len(sample['attempts']),1)

    def unstable(self,command,parent):
        pending=parent/'unstable-a';pending.mkdir();(pending/'data').write_bytes(b'x')
        actual=os.stat
        def raced(path,*a,**kw):
            if str(path) in ('unstable-a','unstable-b') and kw.get('dir_fd') is not None:
                source=parent/str(path);destination=parent/('unstable-b' if str(path)=='unstable-a' else 'unstable-a')
                command('rename',source,destination)
            return actual(path,*a,**kw)
        return raced

    def test_repeated_instability_never_becomes_an_empty_sample(self):
        for parent in (self.profile,self.port.tmp,self.job.scratch,self.root/'cache'):
            with self.subTest(parent=parent),self.writer() as (command,receipts):
                raced=self.unstable(command,parent)
                with patch.object(os,'stat',raced),self.assertRaises(FileNotFoundError):self.port.budgets(self.job)
                record=self.port.result['raw']['writerPublicationObservations'][-1]
                self.assertEqual(len(receipts),live_cache.ATTEMPTS);self.assertEqual(len(record['attempts']),live_cache.ATTEMPTS)
                self.assertFalse(record['complete']);self.assertIsNone(record['bytes'])
                shutil.rmtree(parent/('unstable-b' if len(receipts)%2 else 'unstable-a'))

    def test_real_unreadability_is_not_retried(self):
        for parent in (self.profile,self.port.tmp,self.job.scratch,self.root/'cache'):
            child=parent/'unreadable';child.mkdir();child.chmod(0)
            try:
                with self.assertRaises(PermissionError):self.port.budgets(self.job)
                sample=self.port.result['raw']['writerPublicationObservations'][-1]
                self.assertEqual(len(sample['attempts']),1);self.assertFalse(sample['complete'])
            finally:child.chmod(0o700);child.rmdir()

    def test_special_metadata_is_counted_without_payload_or_link_traversal(self):
        (self.profile/'link').symlink_to('/dev/zero');os.mkfifo(self.profile/'fifo')
        with patch.object(os,'read',side_effect=AssertionError('payload read forbidden')):
            self.port.budgets(self.job)
        self.assertEqual(self.port.result['raw']['lastWriterObservation']['profileBytes'],len('/dev/zero'))
        (self.root/'cache/link').symlink_to('/dev/zero')
        with self.assertRaises(Refused):self.port.budgets(self.job)
        self.assertFalse(self.port.result['raw']['lastWriterObservation']['complete'])

    def test_live_growth_is_sampled_and_next_measurement_enforces_each_exact_cap(self):
        roots=[(self.profile,1024**3),(self.port.tmp,512*MIB),(self.job.scratch,64*MIB),(self.root/'cache',256*MIB)]
        for parent,cap in roots:
            with self.subTest(parent=parent),self.writer() as (command,_):
                p=parent/'growing';p.write_bytes(b'x');actual=os.stat;fired=[]
                def raced(path,*a,**kw):
                    value=actual(path,*a,**kw)
                    if str(path)=='growing' and not fired:
                        fired.append(True);command('grow',p,bytes=cap)
                    return value
                with patch.object(os,'stat',raced):self.port.budgets(self.job)
                self.assertTrue(fired);self.port.budgets(self.job)
                command('grow',p,bytes=cap+1)
                with self.assertRaises(Refused):self.port.budgets(self.job)
                self.assertFalse(self.port.result['raw']['lastWriterObservation']['complete']);p.unlink()

    def test_settled_growth_is_unknown_and_refuses(self):
        self.drained();p=self.profile/'growing';p.write_bytes(b'x')
        with self.writer() as (command,_):
            actual=os.stat;fired=[]
            def raced(path,*a,**kw):
                value=actual(path,*a,**kw)
                if str(path)=='growing' and not fired:fired.append(True);command('grow',p,bytes=2)
                return value
            with patch.object(os,'stat',raced),self.assertRaisesRegex(Refused,'Settled writer entry changed'):
                self.port.budgets(self.job,for_archive=True)
        sample=self.port.result['raw']['writerPublicationObservations'][-1]
        self.assertEqual(len(sample['attempts']),1);self.assertFalse(sample['complete'])

    def test_unknown_namespace_deadline_and_cohort_cannot_be_declared_released(self):
        with self.assertRaisesRegex(Refused,'positive owned-cohort drain'):
            self.port.budgets(self.job,for_archive=True)
        shutil.rmtree(self.port.tmp)
        with self.assertRaises(FileNotFoundError):self.port.budgets(self.job)
        self.assertFalse(self.port.result['raw']['lastWriterObservation']['complete'])
        self.port.tmp.mkdir();(self.port.tmp/'deadline').touch();actual=os.stat
        def alarm(path,*a,**kw):
            if str(path)=='deadline':signal.raise_signal(signal.SIGALRM)
            return actual(path,*a,**kw)
        with patch.object(os,'stat',alarm),self.assertRaises(native_ports.PhaseExpired),native_ports.phase(2):self.port.budgets(self.job)
        self.assertFalse(self.port.result['raw']['lastWriterObservation']['complete'])
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0.,0.))
        with patch.object(live_cache,'SECONDS',0),self.assertRaises(Refused):self.port.budgets(self.job)

    def test_frozen_helper_tmp_alias_and_untrusted_root_links(self):
        self.job.scratch=Path('/tmp')/self.job.scratch.relative_to('/private/tmp')
        self.port.budgets(self.job)
        probe=self.port.result['raw']['lastWriterObservation']['probes'][1]
        self.assertEqual(probe['platformAlias']['uid'],0);self.assertTrue(probe['canonicalPath'].startswith('/private/tmp/'))
        (self.root/'linked').symlink_to(self.root/'scratch',target_is_directory=True);self.job.scratch=self.root/'linked'
        with self.assertRaises(OSError):self.port.budgets(self.job)

    def test_actual_caller_preserves_profile_instability_before_cleanup_and_all_sink_errors(self):
        root=self.root/'caller';root.mkdir();fixture=controls.Fixture(root)
        original=fixture.ports
        def factory(ready,result):
            port=original(ready,result);self.port.result=result
            port.budgets=lambda job:self.port.budgets(self.job)
            def cleanup(*_):raise Refused('UNKNOWN_COHORT_RELEASE')
            port.cleanup=cleanup;return port
        def broken(*_):raise OSError(28,'SECONDARY_PUBLICATION')
        def sink(path,data):
            if Path(path).name in ('terminal.json','result.json','failed-result.json'):broken()
            evidence.Receipts.exclusive(path,data)
        try:
            with self.writer() as (command,receipts),patch.object(bindings,'ROOT',root),patch.object(os,'stat',self.unstable(command,self.profile)):
                result=caller.execute(fixture.ready_path,enabled=True,authorization=fixture.ready['pilot']['authorizationId'],verify_source=lambda _:fixture.source,ports_factory=factory,cache_guard=inert_clear,sink=evidence.Receipts(sink),stderr=broken)
            self.assertFalse(result['accepted']);self.assertFalse(result['durable']);self.assertIsNone(result['release'])
            self.assertNotIn('inspection',result);self.assertEqual(result['errors'][0]['phase'],'capture-observer')
            self.assertEqual(result['errors'][0]['type'],'FileNotFoundError');self.assertTrue(any(x['phase']=='cleanup' for x in result['errors']))
            self.assertEqual(result['errors'][-1]['phase'],'stderr-fallback-write');self.assertEqual(len(receipts),live_cache.ATTEMPTS)
            self.assertTrue(result['raw']['writerProfilesObserved']);self.assertEqual(fixture.calls.count('launch'),1)
        finally:fixture.cleanup()


if __name__=='__main__':unittest.main()
