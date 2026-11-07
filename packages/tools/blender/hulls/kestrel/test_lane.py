"""Exercise the real lane CLI's process-group, lock, signal, deadline and cleanup boundaries."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE=Path(__file__).resolve().parent


class LaneBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='kestrel-lane-test-');self.root=Path(self.tmp.name)
        self.script=self.root/'packages/tools/blender/hulls/kestrel/lane.py';self.script.parent.mkdir(parents=True)
        self.script.write_bytes((HERE/'lane.py').read_bytes())
        self.assertEqual(hashlib.sha256(self.script.read_bytes()).digest(),hashlib.sha256((HERE/'lane.py').read_bytes()).digest())
        self.source=self.root/'assets/blend/hulls/kestrel.blend';self.source.parent.mkdir(parents=True);self.source.write_bytes(b'fixture-source')
        self.export=self.root/'packages/client/public/models/hulls/kestrel.glb';self.export.parent.mkdir(parents=True);self.export.write_bytes(b'known-stale-own-output')
        self.foreign=self.export.with_name('foreign.glb');self.foreign.write_bytes(b'untouched')
        self.evidence=self.root/'assets/renders/hulls/kestrel-round3-current';self.evidence.mkdir(parents=True);(self.evidence/'qualification.json').write_text('{"status":"stale"}')

    def tearDown(self):self.tmp.cleanup()

    def cmd(self,label,timeout,code):
        return [sys.executable,str(self.script),'--label',label,'--timeout',str(timeout),'--export','--',sys.executable,'-c',code]

    def check_cleanup(self,label):
        r=json.loads((self.evidence/(label+'.run.json')).read_text())
        self.assertTrue(r['ownedGroupReapedBeforeUnlock'])
        self.assertFalse(self.export.exists());self.assertFalse((self.evidence/'qualification.json').exists())
        self.assertEqual(self.foreign.read_bytes(),b'untouched');self.assertEqual(self.source.read_bytes(),b'fixture-source')
        with self.assertRaises(ProcessLookupError):os.killpg(r['pgid'],0)
        return r

    def test_nonzero_removes_only_known_stale_export_and_receipt(self):
        p=subprocess.run(self.cmd('failure',10,'raise SystemExit(42)'),capture_output=True,text=True,timeout=20)
        self.assertEqual(p.returncode,42);self.check_cleanup('failure')

    def test_deadline_reaps_term_ignoring_descendants(self):
        ready=self.root/'descendant-ignores-term'
        child=f"import signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path({str(ready)!r}).write_text('ready');time.sleep(60)"
        code=f"import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',{child!r}]);time.sleep(60)"
        p=subprocess.run(self.cmd('deadline',.5,code),capture_output=True,text=True,timeout=20)
        self.assertEqual(p.returncode,124,p.stdout+p.stderr);self.assertTrue(ready.exists(),'descendant never installed its TERM handler')
        receipt=self.check_cleanup('deadline');self.assertTrue(receipt['timedOut']);self.assertLess(ready.stat().st_mtime,receipt['startedUnix']+.5,'TERM handler was not ready before the deadline')

    def test_export_source_mutation_invalidates_output(self):
        code=f"from pathlib import Path;Path({str(self.source)!r}).write_bytes(b'changed-source')"
        p=subprocess.run(self.cmd('mutated-source',10,code),capture_output=True,text=True,timeout=20)
        self.assertEqual(p.returncode,1,p.stdout+p.stderr)
        receipt=json.loads((self.evidence/'mutated-source.run.json').read_text())
        self.assertIn('saved source changed',receipt['error']);self.assertTrue(receipt['ownedGroupReapedBeforeUnlock'])
        self.assertFalse(self.export.exists());self.assertFalse((self.evidence/'qualification.json').exists());self.assertEqual(self.foreign.read_bytes(),b'untouched')

    def test_spawn_failure_removes_stale_own_output(self):
        command=self.cmd('missing-executable',10,'pass');command[-3:]=[str(self.root/'missing-executable')]
        p=subprocess.run(command,capture_output=True,text=True,timeout=20)
        self.assertEqual(p.returncode,1,p.stdout+p.stderr)
        receipt=json.loads((self.evidence/'missing-executable.run.json').read_text())
        self.assertIn('FileNotFoundError',receipt['error']);self.assertTrue(receipt['ownedGroupReapedBeforeUnlock'])
        self.assertFalse(self.export.exists());self.assertFalse((self.evidence/'qualification.json').exists());self.assertEqual(self.foreign.read_bytes(),b'untouched')

    def test_unreaped_group_keeps_lane_closed(self):
        child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True)
        try:
            with Path('/tmp/astra-kestrel-round3-cpu.lock').open('r+') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);lock.seek(0);lock.truncate();json.dump({'pgid':child.pid,'root':str(self.root),'reason':'test-owned live group'},lock);lock.flush()
            p=subprocess.run(self.cmd('quarantined',2,'pass'),capture_output=True,text=True,timeout=5)
            self.assertEqual(p.returncode,75);self.assertIn('unreaped prior owned group',p.stderr)
            child.terminate();child.wait(timeout=5)
            p=subprocess.run(self.cmd('quarantine-cleared',2,'pass'),capture_output=True,text=True,timeout=5)
            self.assertEqual(p.returncode,0,p.stderr)
        finally:
            if child.poll() is None:child.kill();child.wait(timeout=5)

    def test_signal_and_contended_lock(self):
        ready=self.root/'ready'
        code=f"from pathlib import Path;import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path({str(ready)!r}).write_text('ready');time.sleep(60)"
        p=subprocess.Popen(self.cmd('signal',30,code),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            deadline=time.monotonic()+10
            while not ready.exists() and time.monotonic()<deadline:time.sleep(.02)
            self.assertTrue(ready.exists())
            blocked=subprocess.run(self.cmd('contended',1,'pass'),capture_output=True,text=True,timeout=5)
            self.assertEqual(blocked.returncode,75)
            p.send_signal(signal.SIGTERM);out,err=p.communicate(timeout=20)
            self.assertEqual(p.returncode,143,out+err);self.assertEqual(self.check_cleanup('signal')['signal'],signal.SIGTERM)
            next_run=subprocess.run(self.cmd('after',2,'pass'),capture_output=True,text=True,timeout=5)
            self.assertEqual(next_run.returncode,0,next_run.stderr)
        finally:
            if p.poll() is None:p.send_signal(signal.SIGTERM);p.communicate(timeout=20)


if __name__=='__main__':unittest.main(verbosity=2)
