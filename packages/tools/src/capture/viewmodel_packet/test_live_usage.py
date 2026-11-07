"""Live browser-tree races through the real VM observer; native ports inert."""
import errno
import os
from pathlib import Path
import shutil
import signal
import socket
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import native
import boundary
import test_revision
from test_revision import scratch


class LiveUsageTests(unittest.TestCase):
    def adapter_race(self, where='profile', action='delete'):
        directory = []; triggered = []; errors = []
        start = threading.Event(); finished = threading.Event()
        original_mkdir, original_stat, original_scandir = Path.mkdir, os.stat, os.scandir
        original_sample, original_open, original_close = native.sample_usage, os.open, os.close
        opened_fds = []; closed_fds = []
        def sample(*args):
            def opened(*a, **kw):
                fd = original_open(*a, **kw); opened_fds.append(fd); return fd
            def close(fd):
                closed_fds.append(fd); return original_close(fd)
            with patch.object(os, 'open', opened), patch.object(os, 'close', close):
                return original_sample(*args)
        def mkdir(path, *args, **kwargs):
            result = original_mkdir(path, *args, **kwargs)
            if path.name == 'playwright_chromiumdev_profile-inert':
                target = path if where == 'profile' else path.parent
                target = target / 'Default' / 'Shared Dictionary'
                original_mkdir(target, parents=True)
                (target/'live-entry.bin').write_bytes(b'cpu-live-payload')
                directory.append(target)
            return result
        def writer():
            try:
                if not start.wait(5): return
                leaf = directory[0]/'live-entry.bin'
                if action == 'delete': leaf.unlink()
                elif action == 'rename': leaf.rename(directory[0]/'renamed.bin')
                elif action == 'subtree': directory[0].rename(directory[0].with_name('Renamed Dictionary'))
                elif action == 'silent-subtree': shutil.rmtree(directory[0])
                elif action in ('denied', 'io', 'deadline'): pass
                else: raise AssertionError(action)
            except BaseException as error: errors.append(error)
            finally: finished.set()
        def stat(path, *args, **kwargs):
            if action != 'silent-subtree' and str(path).endswith('live-entry.bin') and directory and not triggered:
                triggered.append(str(path)); start.set()
                if not finished.wait(2): raise AssertionError('Owned writer did not finish')
                if action in ('denied', 'io'):
                    error = OSError(errno.EACCES if action == 'denied' else errno.EIO, 'CPU injected IO failure', str(path))
                    error.future = b'\x00\xff'
                    raise error
                if action == 'deadline':
                    with boundary.deadline(.01): time.sleep(.1)
            return original_stat(path, *args, **kwargs)
        def scandir(path):
            if action == 'silent-subtree' and directory and not triggered:
                target = original_stat(directory[0])
                current = os.fstat(path) if isinstance(path, int) else original_stat(path)
                if (current.st_dev, current.st_ino) == (target.st_dev, target.st_ino):
                    triggered.append(str(path)); start.set()
                    if not finished.wait(2): raise AssertionError('Owned subtree writer did not finish')
            return original_scandir(path)
        worker = threading.Thread(target=writer); worker.start()
        try:
            with patch.object(Path, 'mkdir', mkdir), patch.object(os, 'stat', stat), patch.object(os, 'scandir', scandir), patch.object(native, 'sample_usage', sample):
                evidence, trace, error, _ = test_revision.RevisionControls().adapter()
        finally:
            start.set(); worker.join(2)
        self.assertFalse(worker.is_alive()); self.assertEqual(errors, []); self.assertTrue(triggered)
        self.assertTrue(opened_fds); self.assertEqual(sorted(opened_fds), sorted(closed_fds))
        for fd in set(opened_fds):
            with self.assertRaises(OSError): os.fstat(fd)
        return evidence, trace, error

    def test_actual_callback_delete_and_rename_are_incomplete_not_work_failures(self):
        for where in ('profile', 'private'):
            for action in ('delete', 'rename', 'subtree'):
                with self.subTest(where=where, action=action):
                    evidence, trace, error = self.adapter_race(where, action)
                    self.assertEqual(evidence['wait'], 'completed')
                    self.assertIn('actual-require-browser-pass', trace)
                    self.assertIn('release unproved', str(error)) # Deliberately refused inert drain.
                    self.assertNotIn('callbackFailure', evidence)
                    self.assertTrue(evidence['usageSampling']['incomplete'])
                    self.assertEqual(trace[-1], 'mandatory-inert-drain')

    def test_actual_callback_records_subtree_that_old_walk_silently_skips(self):
        for where in ('profile', 'private'):
            evidence, trace, error = self.adapter_race(where, 'silent-subtree')
            self.assertEqual(evidence['wait'], 'completed')
            self.assertTrue(evidence.get('usageSampling', {}).get('incomplete'))
            self.assertIn('actual-require-browser-pass', trace)

    def test_actual_callback_io_and_deadline_still_fail_and_drain(self):
        for action in ('denied', 'io', 'deadline'):
            evidence, trace, error = self.adapter_race('profile', action)
            self.assertIn('callbackFailure', evidence)
            self.assertEqual(trace[-1], 'mandatory-inert-drain')
            self.assertNotIn('actual-require-browser-pass', trace)
            self.assertEqual(evidence['usageSampling']['last']['coverage'], 'interrupted')
            if action == 'deadline': self.assertIsInstance(error, boundary.DeadlineExpired)
            else: self.assertEqual(error.future, b'\x00\xff')
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)

    def roots(self):
        root = scratch()
        out = root/'job'; out.mkdir()
        work = root/'scratch'; work.mkdir()
        private = root/'private'; private.mkdir()
        info = private.stat()
        return root, native.live_roots(SimpleNamespace(out=out, scratch=work), private,
                                      {'stamp':[info.st_dev, info.st_ino]})

    def test_byte_budgets_special_metadata_growth_and_fd_closure(self):
        root, roots = self.roots(); profile=root/'private/playwright_chromiumdev_profile-inert';profile.mkdir()
        leaf=profile/'leaf';leaf.write_bytes(b'abc')
        (root/'private/tmp-file').write_bytes(b'12');os.mkfifo(root/'private/pipe')
        sock=socket.socket(socket.AF_UNIX)
        # macOS limits Unix socket paths; use this root's short basename outside
        # the profile only if it fits. Socket metadata does not open/read content.
        sockpath=root/'private/s'
        original_stat, original_open, original_close=os.stat,os.open,os.close;fds=[];closed=[];grown=[]
        def growth(path,*args,**kwargs):
            if str(path)=='leaf' and not grown:
                grown.append(True);leaf.write_bytes(b'abcd')
            return original_stat(path,*args,**kwargs)
        def opened(*args,**kwargs):
            fd=original_open(*args,**kwargs);fds.append(fd);return fd
        def close(fd):closed.append(fd);return original_close(fd)
        try:
            if len(os.fsencode(sockpath))<100:sock.bind(str(sockpath))
            with patch.object(os,'stat',growth),patch.object(os,'open',opened),patch.object(os,'close',close):
                e={};value=native.sample_usage(roots,e)
            self.assertEqual(value['profiles'],4);self.assertEqual(value['privateNonprofile'],2)
            self.assertFalse(e['usageSampling']['last']['atomic']);self.assertFalse(e['usageSampling']['last']['settled'])
            self.assertEqual(e['usageSampling']['last']['specialEntries']['fifo'],1)
            self.assertEqual(e['usageSampling']['last']['specialEntries']['socket'],int(len(os.fsencode(sockpath))<100))
            self.assertEqual(sorted(fds),sorted(closed))
            for fd in set(fds):
                with self.assertRaises(OSError):os.fstat(fd)
            with patch.dict(native.LIVE_CAPS,profiles=3),self.assertRaisesRegex(ValueError,'working ceiling'):
                native.sample_usage(roots,{})
        finally:sock.close()

    def test_unknown_io_owner_symlink_and_root_replacement_are_not_losses(self):
        for action in ('io','denied','owner','symlink','replace-root'):
            with self.subTest(action=action):
                root,roots=self.roots();leaf=root/'private/leaf';leaf.write_bytes(b'a');original=os.stat
                def stat(path,*args,**kwargs):
                    value=original(path,*args,**kwargs)
                    if str(path)=='leaf':
                        if action in ('io','denied'):raise OSError(errno.EIO if action=='io' else errno.EACCES,'injected',str(path))
                        if action=='owner':return SimpleNamespace(st_uid=os.getuid()+1,st_mode=value.st_mode)
                    return value
                if action=='symlink':leaf.unlink();leaf.symlink_to(root/'scratch')
                if action=='replace-root':(root/'private').rename(root/'old-private');(root/'private').mkdir()
                e={}
                with patch.object(os,'stat',stat),self.assertRaises((OSError,ValueError)):
                    native.sample_usage(roots,e)
                self.assertEqual(e['usageSampling']['last']['coverage'],'interrupted')
                self.assertEqual(e['usageSampling']['last']['losses'],[])

    def test_partial_bounds_recovery_and_evidence_preservation(self):
        root,roots=self.roots();leaf=root/'private/leaf';leaf.write_bytes(b'a');original=os.stat
        def missing(path,*args,**kwargs):
            if str(path)=='leaf':raise FileNotFoundError(errno.ENOENT,'controlled disappearance',str(path))
            return original(path,*args,**kwargs)
        e={}
        with patch.object(os,'stat',missing):native.sample_usage(roots,e)
        first=e['usageSampling']['incomplete'][0]
        self.assertEqual(first['coverage'],'partial');self.assertEqual(first['losses'][0]['errno'],errno.ENOENT)
        native.sample_usage(roots,e)
        self.assertEqual(e['usageSampling']['last']['coverage'],'enumerated')
        self.assertIsNone(e['usageSampling']['unknownSince']);self.assertIs(e['usageSampling']['incomplete'][0],first)
        e['usageSampling']['unknownSince']=time.monotonic()-3
        with patch.object(os,'stat',missing),self.assertRaisesRegex(ValueError,'instability deadline'):
            native.sample_usage(roots,e)
        for name,value,message in [('LIVE_PARTIALS',0,'partial evidence'),('LIVE_FACT_BYTES',1,'partial evidence'),('LIVE_LOSSES',0,'loss ceiling'),('LIVE_ENTRIES',0,'entry ceiling')]:
            with patch.object(native,name,value),patch.object(os,'stat',missing),self.assertRaisesRegex(ValueError,message):
                native.sample_usage(roots,{})

    def test_final_size_and_actual_private_archive_stay_strict(self):
        root=scratch();private=root/'private';private.mkdir(mode=0o700);leaf=private/'leaf';leaf.write_bytes(b'original')
        original=os.stat
        removed=[]
        def gone(path,*args,**kwargs):
            if str(path)==str(leaf) and not removed:removed.append(True);leaf.unlink()
            return original(path,*args,**kwargs)
        with patch.object(os,'stat',gone),self.assertRaises(FileNotFoundError):native.size(private)
        leaf.write_bytes(b'original');proof=__import__('run_round4_browser_proof');admission=proof.tmp_admission(private)
        copytree=shutil.copytree
        def mutate(source,destination,*args,**kwargs):
            result=copytree(source,destination,*args,**kwargs);leaf.write_bytes(b'changed');return result
        with patch.object(proof.shutil,'copytree',mutate),self.assertRaisesRegex(AssertionError,'copy differs'):
            proof.preserve_private_tmp(private,admission,root/'archive',no_process_launched=True)
        self.assertTrue(private.exists());self.assertEqual((root/'archive/leaf').read_bytes(),b'original')


if __name__ == '__main__': unittest.main()
