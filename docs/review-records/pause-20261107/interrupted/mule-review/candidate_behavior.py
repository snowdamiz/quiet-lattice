"""Additional contract-aware checks. The sealed path-only harness is untouched."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

from adversarial_review import FakeScene, CHANNELS, RootFailure, UnprintableFailure, PL, HERE


class CandidateBehavior(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=HERE)
        self.addCleanup(self.temp.cleanup)
        self.tmp = Path(self.temp.name)

    def test_eight_success_scenarios_preserve_all_observable_state_and_todo(self):
        count = 0
        for linked_ao in (False, True):
            for todo in (CHANNELS, CHANNELS[:-1], ['normal'], ['occlusion']):
                with self.subTest(linked_ao=linked_ao, todo=todo):
                    count += 1
                    a, b = FakeScene(todo, linked_ao=linked_ao), FakeScene(todo, linked_ao=linked_ao)
                    stock, ex, _ = a.run(False, self.tmp/str(count)/'stock')
                    wrapped, ey, phases = b.run(True, self.tmp/str(count)/'wrapped')
                    self.assertIsNone(ex); self.assertIsNone(ey)
                    self.assertEqual(stock, wrapped)
                    self.assertEqual(wrapped['result'], todo if 'occlusion' in todo else [*todo,'occlusion'])
                    self.assertEqual([p['observed_outcome'] for p in phases], ['success']*len(wrapped['result']))
                    self.assertTrue(all(p['status']=='unfinished' and p['publication']=='unconfirmed' for p in phases))
                    self.assertEqual(b.resource_calls, len(wrapped['result']))
                    self.assertIsNone(PL._FRAME.get())
        self.assertEqual(count, 8)
        print('PASS eight success scenarios (16 stock/wrapped executions)')

    def test_forty_exception_executions_preserve_identity_cleanup_and_stop_order(self):
        count = 0
        for failure_type in (RuntimeError, KeyboardInterrupt, SystemExit, RootFailure, UnprintableFailure):
            for at in ('op', 'finish'):
                for secondary in (False, True):
                    with self.subTest(failure=failure_type.__name__, at=at, secondary=secondary):
                        count += 1
                        original = failure_type('original-object')
                        a, b = FakeScene(CHANNELS, original, at), FakeScene(CHANNELS, original, at)
                        stock, ex, _ = a.run(False, self.tmp/str(count)/'stock')
                        wrapped, ey, phases = b.run(True, self.tmp/str(count)/'wrapped', secondary)
                        self.assertIs(ex, original); self.assertIs(ey, original)
                        self.assertEqual(stock, wrapped)
                        expected = None if secondary or failure_type is UnprintableFailure else 'interrupt' if failure_type in (KeyboardInterrupt,SystemExit) else 'error'
                        self.assertEqual([p['channel'] for p in phases], ['baseColor','roughness'])
                        self.assertEqual([p['observed_outcome'] for p in phases], ['success',expected])
                        self.assertTrue(all(p['status']=='unfinished' and p['publication']=='unconfirmed' for p in phases))
                        self.assertEqual(b.resource_calls, 2)
                        self.assertIsNone(PL._FRAME.get())
        self.assertEqual(count*2, 40)
        print('PASS 20 paired exception scenarios = 40 stock/wrapped executions')

    def test_sigkill_leaves_only_roughness_without_an_observed_terminal(self):
        script = '''import os,signal,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from adversarial_review import FakeScene, CHANNELS
scene=FakeScene(CHANNELS)
original=scene.bpy.ops.object.bake
def channel(**kwargs):
    if scene.mat.node_tree.nodes.active.image.name.endswith('_roughness'):
        os.kill(os.getpid(),signal.SIGKILL)
    return original(**kwargs)
scene.bpy.ops.object.bake=channel
scene.run(True,Path(sys.argv[2]))
'''
        child = subprocess.run([sys.executable,'-B','-c',script,str(HERE),str(self.tmp)],
                               capture_output=True,text=True,timeout=5,
                               env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1'))
        self.assertEqual(child.returncode, -signal.SIGKILL, child.stderr)
        phases, tail = PL.load(self.tmp/'phases.jsonl')
        self.assertIsNone(tail)
        self.assertEqual([(p['channel'],p['observed_outcome']) for p in phases], [('baseColor','success'),('roughness',None)])
        missing = [p for p in phases if p['observed_outcome'] is None]
        self.assertEqual(len(missing), 1)
        self.assertEqual((missing[0]['material'],missing[0]['variant'],missing[0]['channel']), ('Mule_Accent.001','mule_damaged','roughness'))
        print('PASS SIGKILL: baseColor observed return, roughness uniquely lacks terminal; publication unconfirmed')


if __name__ == '__main__':
    unittest.main(verbosity=2)
