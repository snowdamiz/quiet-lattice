"""Focused CPU controls. No StationJob.start, launchctl, browser, or native capture runs."""
import copy
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
from metadata import Evidence, Refused, atomic, digest, encode, snapshot, ledger
import metadata
import freeze
import launch


class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t13-cpu-')
        self.root = Path(self.temp.name).resolve()
    def tearDown(self):
        self.temp.cleanup()  # Only this test's inert fixture, never review screenshots.
    def metadata(self, name='grant.json', value=None):
        path = self.root / name
        raw = encode(value if value is not None else {'ok': True, 'unknown': {'nested': [None, 1]}})
        path.write_bytes(raw)
        return path, raw
    def test_real_fifo_replacement_for_all_three_metadata_roles(self):
        for role in ('grant', 'result', 'consumption'):
            path, raw = self.metadata(role + '.json')
            opened = []
            real_open = os.open
            def tracked(*args, **kwargs):
                fd = real_open(*args, **kwargs); opened.append(fd); return fd
            def replace():
                path.rename(path.with_suffix('.saved')); os.mkfifo(path)
            with patch.object(metadata.os, 'open', tracked):
                begin = time.monotonic()
                with self.assertRaisesRegex(Refused, 'descriptor'):
                    snapshot(path, digest(raw), before_open=replace)
                self.assertLess(time.monotonic()-begin, .5)
            self.assertGreater(len(opened), 1)
            for descriptor in opened:
                with self.assertRaises(OSError) as raised: os.fstat(descriptor)
                self.assertEqual(raised.exception.errno, errno.EBADF)
    def test_same_snapshot_authentication_growth_symlink_and_caps(self):
        path, raw = self.metadata()
        value = snapshot(path, digest(raw), cap=len(raw))
        path.write_bytes(b'{"changed":true}')
        self.assertEqual(value['raw'], raw)
        self.assertEqual(value['value']['unknown']['nested'], [None, 1])
        for action in ('wrong-hash','oversize','replace','symlink','grow-descriptor'):
            path.unlink();path.write_bytes(raw)
            def before():
                if action == 'replace': path.rename(self.root/'old');path.write_bytes(raw)
                if action == 'symlink': path.rename(self.root/'link-target');path.symlink_to(self.root/'link-target')
                if action == 'grow-descriptor': path.write_bytes(raw+b' ')
            with self.assertRaises(Refused): snapshot(path, '0'*64 if action=='wrong-hash' else digest(raw), cap=1 if action=='oversize' else len(raw), before_open=before)
    def test_write_close_publish_and_all_sink_failures_keep_raw_unknown(self):
        for fault in ('write','close','publish','all'):
            calls=[]
            def writer(path, raw):
                calls.append(str(path))
                if fault=='all' or str(path).endswith('primary/raw.json'): raise OSError(fault)
                atomic(path, raw)
            for name in ('primary','fallback'): (self.root/name).mkdir(exist_ok=True)
            evidence=Evidence([self.root/'primary',self.root/'fallback'],writer=writer)
            value={'original':{'unknown':[None,{'future':True}]},'secondary':fault}
            if fault=='all':
                with self.assertRaises(Refused): evidence.put('raw.json',value)
                self.assertIn('raw.json',evidence.receipt()['undurable'])
            else:
                evidence.put('raw.json',value)
                self.assertEqual(snapshot(self.root/'fallback/raw.json')['value'],value)
                (self.root/'fallback/raw.json').unlink()
            self.assertEqual(json.loads(evidence.raw['raw.json']),value)
            self.assertEqual(len(calls),2)
    def test_evidence_caps_are_not_quotas(self):
        evidence=Evidence([],cap=10,count=1)
        with self.assertRaises(Refused): evidence.put('one',b'123')
        with self.assertRaises(Refused): evidence.put('two',b'123')
        (self.root/'large').write_bytes(b'x'*11)
        with self.assertRaises(Refused): ledger(self.root,cap=10)
        with self.assertRaises(Refused): ledger(self.root,count=0)
    def test_disabled_refuses_before_grant_read_verify_or_native_import(self):
        ready,raw=self.metadata('ready.json',{'runtimeAuthorized':False})
        with self.assertRaisesRegex(Refused,'disabled'):
            launch.admit(ready,digest(raw),self.root/'missing-grant','0'*64,verify=lambda _:self.fail('verification before disabled gate'))
        with patch.object(launch,'native_helpers',side_effect=AssertionError('native import')):
            with self.assertRaisesRegex(Refused,'disabled'):
                launch.main(['--readiness',str(ready),'--readiness-sha256',digest(raw),'--grant','/missing','--grant-sha256','0'*64])
    def test_consumption_authenticates_original_snapshot_and_is_one_use(self):
        path,raw=self.metadata(value={'expiresAtEpochSeconds':time.time()+60,'unknown':{'future':True}})
        grant=snapshot(path,digest(raw))
        path.write_text('{}')
        ready={'binding':{'consumption':str(self.root/'spent')}}
        got=launch.consume(ready,grant)
        self.assertEqual(got['raw'],raw)
        with self.assertRaises(FileExistsError):launch.consume(ready,grant)
    def test_real_git_clean_head_and_external_outputs(self):
        repo=self.root/'repo';repo.mkdir()
        for argv in (['init','-q'],['config','user.email','fixture@example.invalid'],['config','user.name','fixture']):
            subprocess.run(['/opt/homebrew/bin/git','-C',str(repo),*argv],check=True,capture_output=True)
        file=repo/'file';file.write_text('original')
        subprocess.run(['/opt/homebrew/bin/git','-C',str(repo),'add','file'],check=True)
        subprocess.run(['/opt/homebrew/bin/git','-C',str(repo),'commit','-qm','fixture'],check=True)
        head=freeze.git(repo,'rev-parse','HEAD');freeze.clean(repo,head)
        (self.root/'external-result').write_text('inert');freeze.clean(repo,head)
        (repo/'unrelated').write_text('dirty')
        with self.assertRaises(Refused):freeze.clean(repo,head)
        (repo/'unrelated').unlink();file.write_text('staged')
        subprocess.run(['/opt/homebrew/bin/git','-C',str(repo),'add','file'],check=True)
        with self.assertRaises(Refused):freeze.clean(repo,head)
        subprocess.run(['/opt/homebrew/bin/git','-C',str(repo),'reset','--hard','-q',head],check=True)
        file.unlink();file.symlink_to(self.root/'external-result')
        with self.assertRaises(Refused):freeze.clean(repo,head)
    def test_deadline_and_owned_cpu_child_reap(self):
        boundary,proof,stages=launch.native_helpers(freeze.ROOT)
        with self.assertRaises(boundary.DeadlineExpired):
            with boundary.deadline(.02): time.sleep(.1)
        child=subprocess.Popen([sys.executable,'-c','import sys;sys.stdin.buffer.read(1)'],stdin=subprocess.PIPE)
        try:
            before=boundary.identity(child.pid)
            self.assertEqual(before['uid'],os.getuid())
            child.stdin.write(b'x');child.stdin.close()
            self.assertEqual(child.wait(timeout=3),0)
            self.assertIsNone(boundary.identity(child.pid))
        finally:
            if child.poll() is None:child.kill();child.wait(timeout=3)
    def test_archive_real_copy_ledger_rejects_corruption_before_removal(self):
        source=self.root/'source';source.mkdir();(source/'unknown').write_bytes(b'raw facts')
        with launch.bounded_copies():shutil_copy=launch.shutil.copytree;shutil_copy(source,self.root/'good')
        self.assertEqual((self.root/'good/unknown').read_bytes(),b'raw facts')
        original=metadata.copy_file
        def corrupt(src,dst,*args,**kwargs):
            result=original(src,dst,*args,**kwargs);Path(dst).write_text('bad');return result
        with patch.object(metadata,'copy_file',corrupt):
            with launch.bounded_copies():
                with self.assertRaisesRegex(Refused,'differs'):launch.shutil.copytree(source,self.root/'bad')
        self.assertTrue((source/'unknown').exists())
    def test_real_stage_receipts_unknown_binary_and_raw_failure_survive(self):
        boundary,proof,stages=launch.native_helpers(freeze.ROOT)
        out=self.root/'owned_job';out.mkdir();capture=self.root/'capture';capture.mkdir();scratch=self.root/'scratch';scratch.mkdir()
        profile=self.root/'playwright_chromiumdev_profile-fixture';profile.mkdir()
        binary=self.root/'inert-executable';binary.write_text('CPU fixture, never executed')
        row={'pid':424242,'uid':os.getuid(),'birth':[1,2],'status':2,'pgid':424242}
        class Job:
            def members(self):return [row]
            def save(self):pass
        job=Job();job.out=out;job.scratch=scratch;job.coalition_id=123;job.state={}
        prefix='bwt-'+'1'*32
        atomic(capture/'browser-launch.json',encode({'kind':'T13_BROWSER_LAUNCH_CHILD_PROCESS_V1','provenance':'BrowserServer.process() ChildProcess',
            'prefix':prefix,'pid':424242,'spawnfile':str(binary),'spawnargs':[str(binary),'--use-angle=metal','--user-data-dir='+str(profile)],
            'at':'2026-11-07T00:00:00Z','monotonicNs':'1'}))
        ready={'prefix':prefix,'resolver':{'selectedExecutable':{'path':str(binary)}},'process_binary_sha256':{str(binary):digest(binary.read_bytes())}}
        observer=stages.StageReceipts(job,ready,self.root,structured_launch_receipt=capture/'browser-launch.json')
        with patch.object(stages,'identity',return_value=row),patch.object(stages,'coalition',return_value=[123,0]),patch.object(stages,'executable_path',return_value=str(binary)),patch.object(stages,'current_commands',return_value={424242:'fixture'}):
            observer.observe()
            self.assertTrue(observer.structured_data['admitted_ever'])
            observer.next_observation=0
            with patch.object(stages,'executable_path',return_value='/unknown/binary'):
                with self.assertRaises(AssertionError):observer.observe()
            self.assertEqual(observer.structured_data['state'],'rejected')
            self.assertIsNotNone(observer.structured_data['raw'])
            self.assertIsNotNone(observer.structured_data['failure'])


    def test_actual_controller_and_retained_drain_archive_bodies_with_inert_launch(self):
        from types import SimpleNamespace
        boundary,proof,stages=launch.native_helpers(freeze.ROOT)
        for fault in ('none','timeout','kernel-count','partial-constructor','fifo-result'):
            case=self.root/fault;case.mkdir()
            frozen=case/'frozen';frozen.mkdir();(frozen/'inert.ts').write_text('inert CPU fixture')
            ready={'frozenRoot':str(frozen),'root':str(freeze.ROOT),
                'binding':{'output':str(case/'attempt'),'fallback':str(case/'fallback'),'prefix':'bwt-'+'1'*32,
                           'node':freeze.NODE,'tsx':str(freeze.ROOT/'node_modules/inert-loader'),'launchPath':'/usr/bin:/bin','browser':'/inert','binaries':[]}}
            created=[]
            class Job(boundary.StationJob):
                def __init__(self,*args,**kwargs):
                    super().__init__(*args,**kwargs)
                    self.released=False;created.append(self)
                    if fault=='partial-constructor':raise OSError('partial constructor')
                def start(self):
                    self.root={'pid':624242,'birth':[1,2],'uid':os.getuid(),'pgid':624242,'status':2}
                    self.coalition_id=123;self.known={str(self.root['pid']):self.root}
                    self.state['exits']={'capture':0,'caffeinate':0}
                    atomic(self.scratch/'worker.json',encode({'launch_complete':True,'exits':self.state['exits']}))
                    return self
                def members(self):
                    if (self.scratch/'release').exists():self.released=True
                    return [] if self.released else [self.root]
                def wait(self,seconds,observer=lambda:None):
                    observer()
                    packet={'kind':'T13_TRACE_OBSERVER_V1','status':'observed','failure':None,'cleanupErrors':[],
                        'portSettlement':{'kind':'ports-settled'},'summary':{'budgetQualified':False},'steps':[{}]*12,
                        'applicability':{'missingControls':0},'totals':{**{k:freeze.BOUNDS[k] for k in ('preparations','frames','dependentPasses','preflightFences','controlFences','png','queries','segments')},
                            'warmUpFrames':1080,'bytes':100,'events':24,'reads':6}}
                    atomic(self.out.parent/'capture/packet.json',encode(packet))
                    return 'timed_out' if fault=='timeout' else 'completed'
            class Observer:
                def __init__(self,*args,**kwargs):pass
                def observe(self):pass
                def require_browser(self):pass
                def receipt(self):return {'fixture':'inert launch; physical methods remain the retained bodies'}
            def tasks(_):
                job=created[-1]
                if (job.scratch/'release').exists():job.released=True
                return {'live':0 if job.released else 2 if fault=='kernel-count' else 1}
            def ident(_):
                job=created[-1]
                return None if job.released else job.root
            def command(argv,**kwargs):
                if argv[:2]==['/bin/launchctl','print']:return subprocess.CompletedProcess(argv,1,'','')
                if argv[:2]==['/bin/launchctl','bootout']:return subprocess.CompletedProcess(argv,0,'','')
                raise AssertionError('Unexpected native command: '+str(argv))
            real_open=metadata.os.open
            def fifo_open(path, flags, *args, **kwargs):
                target=Path(path)
                if fault=='fifo-result' and target.name=='packet.json' and not flags & os.O_WRONLY:
                    target=Path(created[-1].out.parent/'capture/packet.json')
                    target.rename(target.with_suffix('.saved'));os.mkfifo(target)
                return real_open(path,flags,*args,**kwargs)
            deadline_bounds={**freeze.BOUNDS,'drainMs':50 if fault=='kernel-count' else 2000}
            with patch.object(metadata.os,'open',fifo_open),patch.object(launch,'BOUNDS',deadline_bounds),patch.object(boundary,'identity',ident),patch.object(boundary,'kernel_tasks',tasks),patch.object(proof,'kernel_tasks',tasks),patch.object(stages,'identity',ident),patch.object(stages,'kernel_tasks',tasks),patch.object(boundary.subprocess,'run',command),patch.object(stages.subprocess,'check_output',return_value=''),patch.object(stages,'StageReceipts',Observer):
                result=launch.run_owned(ready,{'value':{},'sha256':'a'*64},{'readiness':{'sha256':'b'*64}},(boundary,proof,stages),job_factory=Job)
            self.assertFalse(result['accepted'])
            self.assertEqual(result['candidate'],fault=='none', json.dumps({k:result.get(k) for k in ['failure','secondary','physicalSettlement','lifecycle']}))
            if fault in ('none','timeout','fifo-result'):
                self.assertEqual(result['physicalSettlement'],'DRAINED_ARCHIVED_AUDITED')
                self.assertTrue(result['lifecycle']['drained'])
                self.assertEqual(result['terminalAudit']['kernel_terminal']['live'],0)
            else:
                self.assertEqual(result['physicalSettlement'],'UNPROVED')
                self.assertTrue(result['secondary'])
                self.assertFalse((created[-1].scratch/'release').exists())
                # Exact inert fixture allocations only; no native job was started.
                if created[-1].scratch.exists():
                    launch.shutil.copytree(created[-1].scratch,case/'retained-scratch')
                    launch.shutil.rmtree(created[-1].scratch)
                private=Path(result['beforeDrain']['privateTmp'])
                if private.exists():
                    launch.shutil.copytree(private,case/'retained-private-tmp')
                    launch.shutil.rmtree(private)
    def test_enabled_admission_expiry_missing_grant_and_unknown_snapshot(self):
        binding={'output':str(self.root/'out'),'fallback':str(self.root/'fallback'),'consumption':str(self.root/'spent'),
                 'grant':str(self.root/'grant.json'),'controlledLoad':{'maxLoad':[1,1,1]}}
        ready={'runtimeAuthorized':True,'kind':'T13_OBSERVER_LOCAL_BINDING_V1','purpose':freeze.PURPOSE,'head':'a'*40,'tree':'b'*40,
               'planSha256':digest(encode(freeze.BOUNDS)),'root':str(self.root/'repo'),'binding':binding}
        path,raw=self.metadata('ready.json',ready)
        with self.assertRaises(Refused):launch.admit(path,digest(raw),binding['grant'],'0'*64,verify=lambda _:None)
        grant={'purpose':freeze.PURPOSE,'head':ready['head'],'tree':ready['tree'],'readinessSha256':digest(raw),
               'planSha256':ready['planSha256'],'output':binding['output'],'consumption':binding['consumption'],
               'expiresAtEpochSeconds':time.time()+60,'controlledLoad':{'ourHeavyCpuJobsQuiesced':True,'gpuReservation':'CPU fixture only','externalContenders':'unknown-not-excluded','maxLoad':[1,1,1]},
               'unknown':{'nested':[None,False]}}
        gpath,graw=self.metadata('grant.json',grant)
        admitted,gs,facts=launch.admit(path,digest(raw),gpath,digest(graw),verify=lambda _:None)
        self.assertEqual(gs['value']['unknown'],grant['unknown'])
        with self.assertRaisesRegex(Refused,'expired'):launch.admit(path,digest(raw),gpath,digest(graw),verify=lambda _:None,now=lambda:time.time()+100)
        real_open=metadata.os.open;fds=[]
        def fifo(path, flags, *args, **kwargs):
            if Path(path).name==gpath.name and not flags & (os.O_WRONLY | os.O_DIRECTORY):
                gpath.rename(gpath.with_suffix('.saved'));os.mkfifo(gpath)
            fd=real_open(path, flags, *args, **kwargs)
            if Path(path).name==gpath.name:fds.append(fd)
            return fd
        with patch.object(metadata.os,'open',fifo):
            with self.assertRaisesRegex(Refused,'descriptor'):
                launch.admit(path,digest(raw),gpath,digest(graw),verify=lambda _:None)
        with self.assertRaises(OSError):os.fstat(fds[0])
        gpath.unlink();gpath.write_bytes(graw)
        grant['head']='c'*40;gpath.write_bytes(encode(grant))
        with self.assertRaisesRegex(Refused,'scope'):launch.admit(path,digest(raw),gpath,digest(encode(grant)),verify=lambda _:None)


    def test_actual_source_freeze_same_clean_head_and_verified_external_artifacts(self):
        repo=self.root/'repo';repo.mkdir()
        for argv in (['init','-q'],['config','user.email','fixture@example.invalid'],['config','user.name','fixture']):
            subprocess.run(['/opt/homebrew/bin/git','-C',str(repo),*argv],check=True,capture_output=True)
        (repo/'package.json').write_text('{"type":"module"}')
        source=repo/'packages/tools/src/unit.ts';source.parent.mkdir(parents=True);source.write_text('export const inert = true;')
        for relative in ['node_modules','packages/tools/node_modules','packages/client/node_modules','packages/shared/node_modules']:(repo/relative).mkdir(parents=True,exist_ok=True)
        boot=['ship','flora','creatures','structures','multitool']
        resources=['packages/client/public/models/'+name+'.glb' for name in boot]+['packages/client/public/audio/manifest.json','packages/client/public/audio/sfx/inert.ogg']
        for relative in resources:
            asset=repo/relative;asset.parent.mkdir(parents=True,exist_ok=True);asset.write_bytes(b'inert fixture bytes, never decoded')
        server=repo/'packages/server';server.mkdir();(server/'package.json').write_text('{"name":"@astra/server"}')
        links=repo/'packages/tools/node_modules/@astra';links.mkdir();(links/'server').symlink_to('../../../server')
        subprocess.run(['/opt/homebrew/bin/git','-C',str(repo),'add','.'],check=True)
        subprocess.run(['/opt/homebrew/bin/git','-C',str(repo),'commit','-qm','fixture'],check=True)
        binding={'binaries':[freeze.bind_file(freeze.GIT)],'assetPath':str(freeze.ROOT/'packages/client/public/models/characters/thalune.glb'),
                 **{k:str(self.root/k) for k in ('output','fallback','consumption','grant')}}
        ready=freeze.make_freeze(repo,self.root/'frozen',binding)
        self.assertFalse(ready['runtimeAuthorized']);freeze.verify_freeze(ready)
        for relative in resources:self.assertEqual((Path(ready['frozenRoot'])/relative).read_bytes(),(repo/relative).read_bytes())
        self.assertEqual(freeze.git(repo,'status','--porcelain'), '')
        copied=Path(ready['frozenRoot'])/'packages/tools/src/unit.ts';copied.write_text('tampered')
        with self.assertRaisesRegex(Refused,'Source changed'):freeze.verify_freeze(ready)
        copied.write_bytes(source.read_bytes());freeze.verify_freeze(ready)
        (Path(ready['frozenRoot'])/'unrelated').write_text('extra')
        with self.assertRaisesRegex(Refused,'ledger'):freeze.verify_freeze(ready)
    def test_real_writer_sync_close_and_publication_errors_preserve_original_bytes(self):
        primary=self.root/'primary';fallback=self.root/'fallback';primary.mkdir();fallback.mkdir()
        for fault in ('sync','close','publish'):
            raw=b'{"future":{"unknown":[null,42]}}'
            real_fdopen=metadata.os.fdopen;real_link=metadata.os.link;real_fsync=metadata.os.fsync
            active={'primary':False}
            def writer(path,data):
                active['primary']=path.parent==primary
                return atomic(path,data)
            def sync(fd):
                if active['primary'] and fault=='sync':raise OSError('original sync failure')
                return real_fsync(fd)
            def link(a,b,**kwargs):
                if active['primary'] and fault=='publish':raise OSError('original publication failure')
                return real_link(a,b,**kwargs)
            def opened(*args,**kwargs):
                stream=real_fdopen(*args,**kwargs)
                class Stream:
                    def __enter__(self):return stream
                    def __exit__(self,*error):
                        stream.close()
                        if active['primary'] and fault=='close':raise OSError('original close failure')
                return Stream()
            evidence=Evidence([primary,fallback],writer=writer)
            with patch.object(metadata.os,'fdopen',opened),patch.object(metadata.os,'fsync',sync),patch.object(metadata.os,'link',link):
                evidence.put(fault+'.json',raw)
            self.assertEqual(snapshot(fallback/(fault+'.json'))['raw'],raw)
            self.assertEqual((primary/(fault+'.json.writing')).read_bytes(),raw)
            self.assertIn('original',evidence.errors[0]['message'])


    def test_actual_consumption_fifo_boundary_and_live_namespace_inventory(self):
        path,raw=self.metadata(value={'expiresAtEpochSeconds':time.time()+60,'unknown':{'future':True}})
        admitted=snapshot(path,digest(raw));spent=self.root/'spent'
        real_open=metadata.os.open;fds=[]
        def replace(path,flags,*args,**kwargs):
            target=Path(path)
            if target.name=='grant.json' and not flags & (os.O_WRONLY | os.O_DIRECTORY):
                target=spent/'grant.json'
                target.rename(target.with_suffix('.saved'));os.mkfifo(target)
            fd=real_open(path,flags,*args,**kwargs)
            if target.name=='grant.json':fds.append(fd)
            return fd
        with patch.object(metadata.os,'open',replace):
            with self.assertRaisesRegex(Refused,'descriptor'):launch.consume({'binding':{'consumption':str(spent)}},admitted)
        with self.assertRaises(OSError):os.fstat(fds[0])
        self.assertTrue((spent/'grant.saved').exists())
        live=self.root/'live';live.mkdir();(live/'SingletonLock').symlink_to('/unobserved/external')
        observation=ledger(live,hash_files=False,live=True)
        self.assertTrue(observation['liveObservationOnly']);self.assertFalse(observation['quotaGuaranteed'])
        self.assertEqual(observation['files'][0]['kind'],'symlink-not-followed')
        with self.assertRaises(Refused):ledger(live)

    def test_interrupted_metadata_preserves_partial_raw_and_original_deadline(self):
        boundary,_,_=launch.native_helpers(freeze.ROOT)
        path,raw=self.metadata()
        original_read,original_close,original_open=os.read,os.close,os.open
        opened=[];reads=[]
        def tracked(*args,**kwargs):
            fd=original_open(*args,**kwargs);opened.append(fd);return fd
        def read(fd,count):
            if reads:raise boundary.DeadlineExpired('original deadline')
            chunk=original_read(fd,3);reads.append(chunk);return chunk
        def close(fd):
            original_close(fd);raise OSError('secondary close failure')
        with patch.object(metadata.os,'open',tracked),patch.object(metadata.os,'read',read),patch.object(metadata.os,'close',close):
            with self.assertRaises(boundary.DeadlineExpired) as caught:snapshot(path,digest(raw))
        self.assertEqual(caught.exception.facts['bytes_read'],3)
        self.assertEqual(caught.exception.facts['raw_base64'],metadata.base64.b64encode(raw[:3]).decode())
        self.assertIn('secondary close',caught.exception.facts['closeFailure']['message'])
        with self.assertRaises(OSError):os.fstat(opened[0])

if __name__ == '__main__':unittest.main()
