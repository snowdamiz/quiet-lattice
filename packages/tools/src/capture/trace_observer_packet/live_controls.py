"""CPU-only controls for live sampling versus strict settled ledgers; no native ports."""
import errno
import json
import os
from pathlib import Path
import signal
import tempfile
import threading
import unittest
from unittest.mock import patch
import metadata as m


class LiveSamples(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t13-live-control-', dir='/private/tmp')
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def sample(self, path=None, **kwargs):
        return m.ledger(path or self.root, count=30, cap=1024, hash_files=False, live=True, **kwargs)
    def test_ordinary_concurrent_writer_and_strict_settled_contrast(self):
        for live in (False, True):
            for mode in ('append', 'create', 'rename-stat', 'rename-open', 'replace-directory'):
                with self.subTest(live=live, mode=mode):
                    root=self.root/(str(live)+mode);root.mkdir()
                    leaf=root/'writing';leaf.write_bytes(b'')
                    directory=root/'deps_temp';directory.mkdir();(directory/'entry').write_bytes(b'cache')
                    go,done=threading.Event(),threading.Event();errors=[];triggered=[]
                    def writer():
                        try:
                            if not go.wait(3):raise RuntimeError('writer barrier not reached')
                            if mode=='append':leaf.write_bytes(b'ordinary tsx payload')
                            elif mode=='create':(directory/'new').write_bytes(b'new')
                            else:
                                directory.rename(root/'deps')
                                if mode=='replace-directory':directory.mkdir();(directory/'replacement').write_bytes(b'new')
                        except BaseException as error:errors.append(error)
                        finally:done.set()
                    worker=threading.Thread(target=writer);worker.start();stat,opening=os.stat,os.open
                    def trigger():
                        if not triggered:
                            triggered.append(True);go.set()
                            if not done.wait(3):raise RuntimeError('writer did not finish')
                    def observed(path,*a,**kw):
                        if str(path)=='deps_temp' and kw.get('dir_fd') is not None and mode=='rename-stat':trigger()
                        info=stat(path,*a,**kw)
                        if kw.get('dir_fd') is not None and ((str(path)=='writing' and mode=='append') or (str(path)=='deps_temp' and mode=='create')):trigger()
                        return info
                    def opened(path,*a,**kw):
                        if str(path)=='deps_temp' and kw.get('dir_fd') is not None and mode in ('rename-open','replace-directory'):trigger()
                        return opening(path,*a,**kw)
                    try:
                        with m.io_deadline(5),patch.object(os,'stat',observed),patch.object(os,'open',opened):
                            if live:
                                result=m.ledger(root,count=30,cap=1024,hash_files=False,live=True)
                                self.assertTrue(result['sampleComplete']);self.assertFalse(result['complete'])
                                self.assertEqual(result['contentBytesRead'],0);self.assertFalse(result['quotaGuaranteed'])
                                if mode.startswith('rename'):self.assertTrue(any(r['observation']=='vanished' for r in result['files']))
                                if mode=='replace-directory':self.assertTrue(any(r['observation']=='replaced-before-open-not-traversed' for r in result['files']))
                            else:
                                with self.assertRaises(m.Refused):m.ledger(root,count=30,cap=1024,hash_files=False)
                    finally:go.set();worker.join(3)
                    self.assertFalse(worker.is_alive());self.assertFalse(errors);self.assertTrue(triggered)
    def test_hashing_and_copy_still_require_admitted_content(self):
        for operation in ('hash-live', 'copy'):
            root=self.root/operation;root.mkdir();leaf=root/'file';leaf.write_bytes(b'1234')
            read=m.read_content
            def changing(path,*a,**kw):
                if Path(path)==leaf:leaf.write_bytes(b'12345678')
                return read(path,*a,**kw)
            with patch.object(m,'read_content',changing):
                with self.assertRaises(m.Refused):
                    if operation=='copy':m.copy_tree(root,self.root/'archive',count=10,cap=16)
                    else:m.ledger(root,count=10,cap=16,live=True)
            self.assertEqual(leaf.read_bytes(),b'12345678')
    def test_size_is_sampled_not_a_quota_and_next_sample_refuses_observed_growth(self):
        leaf=self.root/'writing';leaf.write_bytes(b'');stat=os.stat;triggered=[]
        def observed(path,*a,**kw):
            info=stat(path,*a,**kw)
            if str(path)=='writing' and kw.get('dir_fd') is not None and not triggered:
                triggered.append(True);leaf.write_bytes(b'123456789')
            return info
        with patch.object(os,'stat',observed):
            result=m.ledger(self.root,count=10,cap=8,hash_files=False,live=True)
        self.assertEqual(result['bytes'],0);self.assertFalse(result['complete']);self.assertFalse(result['quotaGuaranteed'])
        for hash_files in (False,True):
            with self.assertRaises(m.Refused):m.ledger(self.root,count=10,cap=8,hash_files=hash_files,live=True)
    def test_symlink_fifo_are_metadata_only_and_settled_copy_refuses(self):
        outside=self.root/'outside';outside.mkdir();(outside/'secret').write_bytes(b'no payload reads')
        tree=self.root/'tree';tree.mkdir();(tree/'link').symlink_to(outside);os.mkfifo(tree/'fifo')
        with patch.object(os,'read',side_effect=AssertionError('payload read')):
            result=self.sample(tree)
        self.assertEqual({r['kind'] for r in result['files']},{'symlink-not-followed','fifo'})
        self.assertFalse(result['complete'])
        with self.assertRaises(m.Refused):m.copy_tree(tree,self.root/'archive')
    def test_count_bytes_and_observed_link_growth_are_bounded(self):
        for case in ('count','bytes','link-growth'):
            tree=self.root/case;tree.mkdir()
            if case=='count':(tree/'one').write_bytes(b'');(tree/'two').write_bytes(b'')
            elif case=='bytes':(tree/'one').write_bytes(b'123456789')
            else:(tree/'link').symlink_to('x')
            readlink=os.readlink
            def changed(path,*a,**kw):
                if str(path)=='link':return 'long observed target'
                return readlink(path,*a,**kw)
            with patch.object(os,'read',side_effect=AssertionError('payload read')),patch.object(os,'readlink',changed):
                with self.assertRaises(m.Refused) as caught:m.ledger(tree,count=1,cap=8,hash_files=False,live=True)
            self.assertFalse(caught.exception.facts['sampleComplete'])
    def test_unknown_lookup_and_enumeration_errors_are_fatal_with_raw_facts(self):
        (self.root/'entry').write_bytes(b'')
        for operation in ('stat','scandir'):
            real=getattr(os,operation)
            def failed(*a,**kw):
                if operation=='scandir' or (str(a[0])=='entry' and kw.get('dir_fd') is not None):
                    error=OSError(errno.EIO,'UNKNOWN_IO');error.unknown=b'producer\xff';raise error
                return real(*a,**kw)
            with patch.object(os,operation,failed):
                with self.assertRaises(m.Refused) as caught:self.sample()
            facts=caught.exception.facts
            self.assertFalse(facts['sampleComplete']);self.assertIn('UNKNOWN_IO',json.dumps(facts))
            self.assertEqual(m.base64.b64decode(facts['original']['attributes']['unknown']['base64']),b'producer\xff')
    def test_root_and_ancestor_replacement_are_not_live_child_disappearance(self):
        ancestor=self.root/'ancestor';tree=ancestor/'tree';tree.mkdir(parents=True);(tree/'entry').write_bytes(b'')
        held=self.root/'held';opening=os.open;triggered=[]
        def opened(path,*a,**kw):
            fd=opening(path,*a,**kw)
            if str(path)=='tree' and not triggered:
                triggered.append(True);ancestor.rename(held);ancestor.symlink_to(held)
            return fd
        with patch.object(os,'open',opened):
            with self.assertRaises(m.Refused):self.sample(tree)
        ancestor.unlink();held.rename(ancestor)
        with self.assertRaises(m.Refused):self.sample(self.root/'absent')
    def test_directory_to_symlink_race_is_refused_without_following(self):
        tree=self.root/'tree';tree.mkdir();child=tree/'child';child.mkdir();outside=self.root/'outside';outside.mkdir()
        opening=os.open;triggered=[]
        def opened(path,flags,*a,**kw):
            if str(path)=='child' and not triggered:
                triggered.append(True);child.rename(self.root/'held');child.symlink_to(outside)
            return opening(path,flags,*a,**kw)
        with patch.object(os,'open',opened):
            with self.assertRaises(m.Refused):self.sample(tree)
        self.assertEqual(list(outside.iterdir()),[])
    def test_opened_directory_renamed_during_enumeration_uses_held_descriptor(self):
        child=self.root/'deps_temp';child.mkdir();(child/'entry').write_bytes(b'cache')
        opening,scanning=os.open,os.scandir;target=[];renamed=[]
        def opened(path,*a,**kw):
            fd=opening(path,*a,**kw)
            if str(path)=='deps_temp':target.append(fd)
            return fd
        def enumerate_fd(fd):
            if target and fd==target[0] and not renamed:
                child.rename(self.root/'deps');renamed.append(True)
            return scanning(fd)
        with patch.object(os,'open',opened),patch.object(os,'scandir',enumerate_fd):result=self.sample()
        self.assertTrue(renamed);self.assertTrue(result['sampleComplete']);self.assertFalse(result['complete'])
        self.assertTrue(any(r['path']=='deps_temp/entry' for r in result['files']))
    def test_actual_deadline_and_descriptor_closure(self):
        opening,closing=os.open,os.close;owned=set();closed=[]
        def opened(*a,**kw):
            fd=opening(*a,**kw);owned.add(fd);return fd
        def close(fd):
            closing(fd);owned.discard(fd);closed.append(fd)
        def blocked(_fd):
            while True:signal.pause()
        with patch.object(os,'open',opened),patch.object(os,'close',close):
            with self.assertRaises(m.IODeadline) as caught:
                with m.io_deadline(.025),patch.object(os,'scandir',blocked):self.sample()
        self.assertFalse(owned);self.assertTrue(closed);self.assertFalse(caught.exception.facts['sampleComplete'])
    def test_close_failure_survives_primary_and_does_not_leak(self):
        child=self.root/'child';child.mkdir();opening,closing=os.open,os.close;target=[];owned=set()
        def opened(path,*a,**kw):
            fd=opening(path,*a,**kw);owned.add(fd)
            if str(path)=='child':target.append(fd)
            return fd
        def close(fd):
            closing(fd);owned.discard(fd)
            if target and fd==target[0]:raise OSError('SECONDARY_CLOSE')
        scanning=os.scandir
        def failed(fd):
            if target and fd==target[0]:raise OSError('PRIMARY_ENUMERATION')
            return scanning(fd)
        with patch.object(os,'open',opened),patch.object(os,'close',close),patch.object(os,'scandir',failed):
            with self.assertRaises(m.Refused) as caught:self.sample()
        self.assertFalse(owned);facts=json.dumps(caught.exception.facts)
        self.assertIn('PRIMARY_ENUMERATION',facts);self.assertIn('SECONDARY_CLOSE',facts)


if __name__=='__main__':unittest.main()
