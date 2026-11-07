"""Lossless snapshot transport and actual helper callback publication controls."""
import errno
import hashlib
import json
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch
import zlib

import boundary
import observations as o
import native
from test_r2 import graph_decode


def scratch():
    return Path(tempfile.mkdtemp(prefix='vmo-', dir=os.environ.get('VM_REVISION_TMP','/private/tmp'))).resolve()


def new():
    root=scratch(); evidence={}; journal=o.Journal(root/'snapshots',evidence)
    return root,evidence,journal


class ObservationTests(unittest.TestCase):
    def test_first_helper_and_encoding_errors_retain_original_before_normalization(self):
        from types import SimpleNamespace
        for mode in ('body','arguments','result'):
            original=ValueError('ORIGINAL_'+mode);original.unknown=b'\x00\xff'
            def call(*_):
                if mode=='body':raise original
                return {'returned':True}
            modules=[SimpleNamespace(write=lambda *_:None,coalition=call) for _ in range(3)]
            modules[0]._archive_profile_paths=lambda *_:None
            e={'helperCalls':[]};raw=native.raw
            def encode(value):
                if (mode=='arguments' and type(value) is tuple) or (mode=='result' and value=={'returned':True}):raise original
                return raw(value)
            with patch.object(native,'raw',encode),native.observed_helpers(modules,e):
                with self.assertRaises(ValueError) as caught:modules[0].coalition(7)
            self.assertIs(caught.exception,original);self.assertIs(e['collectionFailure'],original)

    def test_actual_helper_overwrites_count_all_traffic_but_reserve_both_files(self):
        from types import SimpleNamespace
        import test_native
        root,e,j=new();e['helperCalls']=[]
        write=test_native.job_module.write
        modules=[SimpleNamespace(write=write) for _ in range(3)]
        modules[0]._archive_profile_paths=lambda *_:None
        value={'observation':'x'*131072};body=(json.dumps(value,indent=2)+'\n').encode()
        with native.observed_helpers(modules,e,journal=j):
            for _ in range(150):modules[0].write(root/'receipt.json',value)
            e['phase']='cleanup'
        self.assertEqual(e['helperMetadataAttemptedBytes'],150*len(body))
        self.assertGreater(e['helperMetadataAttemptedBytes'],16*boundary.MIB)
        self.assertEqual(e['helperMetadataReservedBytes'],2*len(body))
        self.assertEqual((root/'receipt.json').read_bytes(),body)
        self.assertEqual(o.validate(j.directory,j.manifest)['events'],150)
        root,e,j=new();e['helperCalls']=[]
        with native.observed_helpers(modules,e,journal=j):
            with self.assertRaisesRegex(ValueError,'Helper metadata ceiling'):
                for i in range(70):modules[0].write(root/f'{i}.json',value)
            e['phase']='cleanup'
        self.assertGreater(e['helperMetadataReservedBytes'],16*boundary.MIB)
        self.assertLess(sum(p.stat().st_size for p in root.glob('*.json')),16*boundary.MIB)

    def test_actual_process_receipt_then_successor_rejects_missing_or_tampered_evidence(self):
        from test_protocol import repository,process
        from test_boundary import digest
        for mode in ('part','index','missing-contract'):
            root,repo=repository();spec,paths,_=repo.grant(0)
            child=process(repo,0);self.assertEqual(child.returncode,0,child.stdout+child.stderr)
            receipt=Path(paths['evidence'])/'result.json';result,_=boundary.json_snapshot(receipt,14*boundary.MIB)
            self.assertTrue(result['checksPassed']);self.assertTrue(result['helperEvidence']['complete'])
            if mode=='part':
                p=Path(paths['evidence'])/'helper-observations/0000.zlib';p.write_bytes(p.read_bytes()+b'changed')
            elif mode=='index':(Path(paths['evidence'])/'helper-observations/index.json').write_text('{}')
            else:
                del result['helperEvidence'];receipt.write_text(json.dumps(result))
            repo.previous=[{'unit':spec['id'],'callerExit':child.returncode,'resultSha256':digest(receipt),'consumptionSha256':digest(paths['consumption'])}]
            next_grant=repo.grant(1)
            with self.assertRaises(ValueError):repo.admit(1,next_grant)
            refused=process(repo,1);self.assertEqual(refused.returncode,1)
            self.assertEqual(json.loads(refused.stdout)['trace'],[])
            self.assertFalse(Path(next_grant[1]['consumption']).exists())

    def test_actual_stdlib_nested_call_order_survives_completion_order(self):
        import subprocess
        from types import SimpleNamespace
        root,e,j=new();e['helperCalls']=[];mods=[SimpleNamespace(write=lambda *_:None) for _ in range(3)];mods[0]._archive_profile_paths=lambda *_:None
        with patch.object(subprocess,'run',lambda *a,**kw:subprocess.CompletedProcess(a[0],0,stdout=b'cpu',stderr=b'')),patch.object(subprocess,'Popen',side_effect=AssertionError('NO_PROCESS')),native.observed_helpers(mods,e,journal=j):
            self.assertEqual(subprocess.check_output(['/inert']),b'cpu')
        received=[];o.validate(j.directory,j.manifest,consume=received.append)
        self.assertEqual([v['operation'] for v in received],['run','check_output'])
        self.assertEqual([v['operation'] for v in sorted(received,key=lambda v:v['callSequence'])],['check_output','run'])

    def test_repeats_bytes_cycles_unknown_facts_are_lossless_with_stable_snapshot_graphs(self):
        root,e,j=new(); shared={'raw':b'\x00\xff'};shared['cycle']=shared
        error=ValueError('original');error.unknown={'a':shared,'b':shared}
        event={'operation':'unknown-future','error':boundary.raw(error),'future':{'field':[1,None,False]}}
        for _ in range(12000):j.append(event)
        e['phase']='cleanup';j.finish();received=[]
        result=o.validate(j.directory,j.manifest,consume=received.append)
        self.assertEqual(received,[event]*12000)
        self.assertEqual(result['events'],12000)
        self.assertLess(result['storedBytes'],result['logicalBytes']//50)
        value=graph_decode(received[-1]['error']);a=value['attributes']['unknown']['a']
        self.assertIs(a,value['attributes']['unknown']['b']);self.assertIs(a['cycle'],a);self.assertEqual(a['raw'],b'\x00\xff')

    def test_dictionary_resets_and_segment_boundaries_keep_exact_order(self):
        with patch.object(o,'BLOCK',128),patch.object(o,'DICTIONARY_ENTRIES',3),patch.object(o,'DICTIONARY_BYTES',512):
            root,e,j=new(); events=[{'i':i%7,'raw':{'base64':'AP8=','bytes':2}} for i in range(100)]
            for event in events:j.append(event)
            e['phase']='cleanup';j.finish();received=[];o.validate(j.directory,j.manifest,consume=received.append)
            self.assertEqual(events,received);self.assertGreater(len(j.manifest['parts']),1)

    def test_mutation_missing_extra_and_fifo_never_admit_as_complete(self):
        for action in ('changed','missing','extra','fifo','index'):
            with self.subTest(action=action):
                root,e,j=new();j.append({'x':1});e['phase']='cleanup';j.finish();p=j.directory/'0000.zlib'
                if action=='changed':p.write_bytes(p.read_bytes()+b'x')
                elif action=='missing':p.rename(root/'original')
                elif action=='extra':(j.directory/'extra').write_bytes(b'x')
                elif action=='fifo':p.rename(root/'original');os.mkfifo(p)
                else:(j.directory/'index.json').write_bytes(b'{}')
                with boundary.deadline(.5),self.assertRaises((ValueError,OSError)):o.validate(j.directory,j.manifest)

    def test_same_snapshot_fifo_replacement_closes_descriptor(self):
        root,e,j=new();j.append({'x':1});e['phase']='cleanup';j.finish();p=j.directory/'0000.zlib';opened=[];original=os.open
        def replace(path,flags,*a,**kw):
            if Path(path)==p and not opened:
                p.rename(root/'original');os.mkfifo(p);fd=original(path,flags,*a,**kw);opened.append(fd);return fd
            return original(path,flags,*a,**kw)
        with patch.object(os,'open',replace),boundary.deadline(.5),self.assertRaises(ValueError):o.validate(j.directory,j.manifest)
        self.assertEqual(len(opened),1)
        with self.assertRaises(OSError):os.fstat(opened[0])
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0],0)

    def test_reauthenticated_invalid_compression_reference_and_counter_refuse(self):
        for action in ('truncated','trailing','reference','duplicate','counter'):
            root,e,j=new();j.append({'x':1});e['phase']='cleanup';j.finish();p=j.directory/'0000.zlib';row=j.manifest['parts'][0];plain=zlib.decompress(p.read_bytes())
            if action=='truncated':data=p.read_bytes()[:-1]
            elif action=='trailing':data=p.read_bytes()+zlib.compress(b'unknown')
            elif action=='reference':plain=b'{"use":9}\n';data=zlib.compress(plain)
            elif action=='duplicate':plain=b'{"use":0,"use":0}\n';data=zlib.compress(plain)
            else:data=p.read_bytes();j.manifest['events']+=1
            p.write_bytes(data);row.update(bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),expandedBytes=len(plain),expandedSha256=hashlib.sha256(plain).hexdigest())
            j.manifest['attemptedBytes']=len(data);j.manifest['expandedBytes']=len(plain)
            (j.directory/'index.json').write_text(json.dumps(j.manifest,separators=(',',':'))+'\n')
            with self.subTest(action=action),self.assertRaises(ValueError):o.validate(j.directory,j.manifest)

    def test_limits_keep_pending_facts_and_mark_incomplete(self):
        for mode in ('disk','io','event','expanded'):
            root,e,j=new();event={'original':boundary.raw(b'RAW\xff'),'unknown':list(range(10))}
            def failed(*_):raise OSError(errno.ENOSPC,'injected storage full')
            limit=patch.object(o,'CAPTURE_DISK_CAP',0) if mode=='disk' else patch.object(o,'exclusive_bytes',failed) if mode=='io' else patch.object(o,'EVENT_CAP',1) if mode=='event' else patch.object(o,'EXPANDED_CAP',1)
            with limit,patch.object(o,'BLOCK',8):
                try:j.append(event)
                except (ValueError,OSError) as error:j.fail(event,error)
                else:self.fail('Limit did not refuse')
            e['phase']='cleanup';j.finish()
            self.assertFalse(j.manifest['complete']);self.assertIs(e['unwrittenHelperEvents'][-1],event)
            with self.assertRaises(ValueError):o.validate(j.directory,j.manifest)

    def test_index_failure_never_claims_complete_or_masks_original(self):
        root,e,j=new();j.append({'value':b'bytes already encoded'.hex()});e['phase']='cleanup'
        write=o.exclusive_bytes
        def failed(path,*a):
            if Path(path).name=='index.json':raise OSError('INDEX_FAILURE')
            return write(path,*a)
        with patch.object(o,'exclusive_bytes',failed),self.assertRaisesRegex(OSError,'INDEX_FAILURE'):j.finish()
        self.assertFalse(j.manifest['complete']);self.assertTrue((j.directory/'0000.zlib').is_file())


if __name__=='__main__':unittest.main()
