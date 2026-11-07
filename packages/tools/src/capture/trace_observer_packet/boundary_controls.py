"""R1 F1–F4 real filesystem controls, derived from the preserved independent reproducers."""
import contextlib
import io
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
import metadata as m
import freeze as f


class Boundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t13-r1-fs-')
        self.root = Path(self.temp.name).resolve()
    def tearDown(self):
        self.temp.cleanup()
    def test_ancestor_static_race_and_destination(self):
        for kind in ('snapshot', 'file_hash', 'ledger', 'atomic'):
            for raced in (False, True):
                with self.subTest(kind=kind, raced=raced):
                    case=self.root/(kind+str(raced));ancestor=case/'ancestor';base=ancestor/'records';base.mkdir(parents=True)
                    leaf=base/'data';leaf.write_bytes(b'{}');held=case/'held';reads=[];fds=[]
                    original_open, original_read=os.open,os.read
                    def swap():
                        if not ancestor.is_symlink():ancestor.rename(held);ancestor.symlink_to(held)
                    if not raced:swap()
                    def opened(path, flags,*args,**kwargs):
                        # Raced replacement at the actual descriptor-relative leaf boundary.
                        if raced and Path(path).name in ('data','data.writing') and not flags & os.O_DIRECTORY:swap()
                        fd=original_open(path,flags,*args,**kwargs);fds.append(fd);return fd
                    def read(fd,size):
                        reads.append(size);return original_read(fd,size)
                    try:
                        with patch.object(m.os,'open',opened),patch.object(m.os,'read',read):
                            with self.assertRaises((m.Refused,OSError)):
                                if kind=='snapshot':m.snapshot(leaf, m.digest(b'{}'))
                                elif kind=='file_hash':m.file_hash(leaf,8)
                                elif kind=='ledger':m.ledger(base,cap=8)
                                else:m.atomic(leaf,b'new')
                        self.assertFalse(reads)
                        self.assertEqual((held/'records/data').read_bytes(),b'{}')
                        for fd in fds:
                            with self.assertRaises(OSError):os.fstat(fd)
                    finally:
                        if ancestor.is_symlink():ancestor.unlink();held.rename(ancestor)
    def test_ledger_charged_stamp_and_aggregate(self):
        for live in (False,True):
            case=self.root/str(live);case.mkdir()
            for name in ('a','b'):(case/name).write_bytes(b'1234')
            original=m.file_hash;reads=[];read=os.read
            def changed(path,cap,**kwargs):
                Path(path).write_bytes(b'12345678');return original(path,cap,**kwargs)
            def counted(fd,size):
                value=read(fd,size);reads.append(len(value));return value
            with patch.object(m,'file_hash',changed),patch.object(m.os,'read',counted):
                with self.assertRaises(m.Refused) as caught:m.ledger(case,count=2,cap=8,live=live)
            self.assertEqual(sum(reads),0)
            self.assertFalse(caught.exception.facts['partialLedger']['complete'])
    def test_enumeration_errors_are_incomplete_for_terminal_and_dependencies(self):
        hidden=self.root/'hidden';hidden.mkdir();(hidden/'data').write_bytes(b'x'*16);hidden.chmod(0)
        try:
            with self.assertRaises(m.Refused) as caught:m.ledger(self.root,cap=8)
            self.assertFalse(caught.exception.facts['complete'])
            self.assertIn('PermissionError',json.dumps(caught.exception.facts))
        finally:hidden.chmod(0o700)
        with self.assertRaises(m.Refused):m.ledger(self.root,cap=8)
    def test_complete_dependency_preadmission_before_hashing(self):
        for relative in f.DEPENDENCY_ROOTS:(self.root/relative).mkdir(parents=True)
        (self.root/'node_modules/a').write_bytes(b'a'*8);(self.root/'node_modules/b').write_bytes(b'b'*9)
        reads=[];original=os.read
        def counted(fd,size):
            raw=original(fd,size);reads.append(len(raw));return raw
        with patch.dict(f.LIMITS,dependencyBytes=16),patch.object(m.os,'read',counted):
            with self.assertRaises(m.Refused):f.dependency_rows(self.root)
        self.assertEqual(reads,[])
    def test_freezer_actual_growth_fifo_and_deadline(self):
        binding=json.loads((f.HERE/'local-binding.json').read_text())
        for fault in ('growth','fifo','grow-after-open'):
            with self.subTest(fault=fault):
                case=self.root/fault;source=case/'input';source.mkdir(parents=True);leaf=source/'package.json';leaf.write_bytes(b'12345678')
                destination=case/'frozen';entered=[];read_counts=[];timers=[]
                minimal={'binaries':[],'assetPath':binding['assetPath'],**{k:str(case/k) for k in ('output','fallback','consumption','grant')}}
                def git(root,*args):
                    if args==('rev-parse','HEAD'):return 'inert git port'
                    if args[0]=='status':return ''
                    if args==('ls-files','-z'):return 'package.json'
                    raise AssertionError(args)
                copy=f.copy_file;opening=os.open;reading=os.read;source_fd=[]
                def before_copy(src,dst,*args,**kwargs):
                    entered.append(True);timers.append(signal.getitimer(signal.ITIMER_REAL)[0])
                    if fault=='growth':leaf.write_bytes(b'0123456789abcdef')
                    return copy(src,dst,*args,**kwargs)
                def open_leaf(path,flags,*args,**kwargs):
                    if entered and str(path)=='package.json' and not flags & (os.O_WRONLY|os.O_DIRECTORY):
                        if fault=='fifo':leaf.rename(case/'preserved');os.mkfifo(leaf)
                        fd=opening(path,flags,*args,**kwargs);source_fd.append(fd);return fd
                    return opening(path,flags,*args,**kwargs)
                def read(fd,size):
                    if entered and fd in source_fd and fault=='grow-after-open':leaf.write_bytes(b'0123456789abcdef')
                    raw=reading(fd,size)
                    if entered:read_counts.append(len(raw))
                    return raw
                with patch.object(f,'git',git),patch.dict(f.LIMITS,sourceBytes=8),patch.object(f,'copy_file',before_copy),patch.object(m.os,'open',open_leaf),patch.object(m.os,'read',read):
                    with self.assertRaises(m.Refused):f.make_freeze(source,destination,minimal,dependencies=False)
                self.assertTrue(entered);self.assertTrue(all(value>0 for value in timers));self.assertLessEqual(sum(read_counts),8)
                target=destination/'source/package.json';self.assertLessEqual(target.stat().st_size if target.exists() else 0,8)
                self.assertFalse((destination/'readiness.json').exists())
                self.assertFalse(any(Path(minimal[key]).exists() for key in ('output','fallback','consumption','grant')))
        started=time.monotonic()
        with self.assertRaises(m.IODeadline):
            with m.io_deadline(.01):time.sleep(.1)
        self.assertLess(time.monotonic()-started,.09)
    def test_exception_raw_attributes_and_close_secondary(self):
        error=__import__('subprocess').TimeoutExpired(['inert'],1,output=b'\xff\x00',stderr=b'\xfe')
        error.future={'nested':b'unknown'}
        raw=m.failure(error)
        error.future.clear()
        self.assertEqual(m.base64.b64decode(raw['attributes']['future']['nested']['base64']),b'unknown')
        self.assertEqual(m.base64.b64decode(raw['attributes']['output']['base64']),b'\xff\x00')

if __name__=='__main__':unittest.main()
