"""Publication faults and exact adopted source with fake ports; no Blender launch."""
import ast
from contextlib import contextmanager, redirect_stdout
import errno
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as NS
import types
import unittest
from unittest.mock import patch

import phase_log as PL
from test_phase_log import IDENTITY, RESOURCES

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
CALLER = HERE.parent / 'mule-round4'


@contextmanager
def fault(kind, active, *, second_close=False):
    original = {name: getattr(os, name) for name in ('open', 'write', 'fsync', 'close')}
    primary = OSError(errno.EIO, kind)
    secondary = SystemExit('second close failure')

    def opening(*args, **kwargs):
        if active() and kind == 'open':
            raise primary
        return original['open'](*args, **kwargs)

    def writing(fd, data):
        if active():
            if kind == 'write':
                raise primary
            if kind == 'partial':
                return original['write'](fd, data[:len(data)//2])
        return original['write'](fd, data)

    def syncing(fd):
        if active() and kind == 'fsync':
            raise primary
        return original['fsync'](fd)

    def closing(fd):
        original['close'](fd)
        if active():
            if second_close:
                raise secondary
            if kind == 'close':
                raise primary

    with patch.multiple(PL.os, open=opening, write=writing, fsync=syncing, close=closing):
        yield primary


def caller_env(out, *, main=None, admission=None):
    """Execute the whole caller AST, replacing only import ports, never statements."""
    events = []
    bake = types.ModuleType('fake_bake')
    bake.ensure_cycles = lambda *a: None
    bake._bake_channels = lambda info, nt, output, surface, todo, res, label: (
        events.append(('channels', todo)) or {ch: 'image' for ch in todo})

    def material(mat, objects, res, **kwargs):
        todo = ['baseColor', 'roughness']
        bake._bake_channels(NS(mat=mat), None, None, None, todo, res, kwargs['label'])
        return todo

    bake.bake_material = material

    class FakeCache:
        def __truediv__(self, other): return self
        def read_bytes(self): return b'fake tool'

    def path(value):
        return FakeCache() if value == '/Users/andreyyurlov/Documents/dev/space' else Path(value)

    def check(label):
        events.append(('admit', label))
        if admission is not None:
            raise admission

    env = dict(__file__=str(CALLER/'export_saved.py'), __name__='fake_caller', Path=path,
               sys=NS(path=[], stdout=NS(reconfigure=lambda **kw: None), exit=sys.exit),
               os=NS(environ={'MULE_ATTEMPT':str(out)}, getpgrp=lambda:44), json=json,
               hashlib=NS(sha256=lambda data:NS(digest=lambda:b'fake hash')), bake=bake,
               export=NS(_write=lambda:None, main=main),
               ktx=NS(compress=lambda:None), meshopt=NS(compress=lambda:None),
               core=NS(load=lambda:None, run_checks=lambda:None),
               snapshot=lambda:None, compare=lambda:None, negative_controls=lambda:[],
               check=check, PhaseLog=PL.PhaseLog, install=PL.install)
    tree = ast.parse((CALLER/'export_saved.py').read_text())
    tree.body = [n for n in tree.body if not isinstance(n, (ast.Import, ast.ImportFrom))]
    exec(compile(tree, str(CALLER/'export_saved.py'), 'exec'), env)
    return env, events


def launch_block():
    tree = ast.parse((CALLER/'run.py').read_text())
    return next(n for n in ast.walk(tree) if isinstance(n, ast.With)
                and ast.unparse(n.items[0].context_expr) == "(out / 'output.log').open('x')")


class Corrections(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)

    def test_disk_observation_is_distinct_from_live_publication_acknowledgement(self):
        log = PL.PhaseLog(self.out/'phases')
        self.assertEqual(log.invoke(IDENTITY, RESOURCES, lambda:'image'), 'image')
        self.assertEqual(log.phases()[0]['status'], 'success')
        self.assertEqual(log.phases()[0]['publication'], 'acknowledged')
        for phase in (PL.load(log.path)[0][0], PL.PhaseLog(log.path).phases()[0]):
            self.assertEqual(phase['observed_outcome'], 'success')
            self.assertEqual(phase['status'], 'unfinished')
            self.assertEqual(phase['publication'], 'unconfirmed')

    def test_each_start_publication_fault_prevents_channel_execution(self):
        for kind in ('open', 'write', 'partial', 'fsync', 'close'):
            with self.subTest(kind=kind):
                log = PL.PhaseLog(self.out/kind)
                called = []
                with fault(kind, lambda:True) as primary:
                    with self.assertRaises(PL.PhaseError if kind == 'partial' else OSError) as caught:
                        log.invoke(IDENTITY, RESOURCES, lambda:called.append(1))
                if kind != 'partial': self.assertIs(caught.exception, primary)
                self.assertEqual(called, [])
                self.assertTrue(all(p['status'] == 'unfinished' for p in log.phases()))

    def test_each_terminal_fault_leaves_publication_unconfirmed(self):
        for kind in ('open', 'write', 'partial', 'fsync', 'close'):
            with self.subTest(kind=kind):
                log = PL.PhaseLog(self.out/kind)
                called = []
                def channel():
                    called.append(1)
                    return 'image'
                with fault(kind, lambda:bool(called)) as primary:
                    with self.assertRaises(PL.PhaseError if kind == 'partial' else OSError) as caught:
                        log.invoke(IDENTITY, RESOURCES, channel)
                if kind != 'partial': self.assertIs(caught.exception, primary)
                self.assertEqual(called, [1])
                disk, tail = PL.load(log.path)
                self.assertEqual(disk, log.phases())
                self.assertEqual(disk[0]['status'], 'unfinished')
                self.assertEqual(disk[0]['publication'], 'unconfirmed')
                self.assertEqual(disk[0]['observed_outcome'], 'success' if kind in ('fsync','close') else None)
                self.assertEqual(tail is not None, kind == 'partial')

    def test_channel_exception_identity_survives_all_terminal_faults(self):
        for kind in ('open', 'write', 'partial', 'fsync', 'close'):
            with self.subTest(kind=kind):
                log = PL.PhaseLog(self.out/kind)
                original = RuntimeError('original channel failure')
                called = []
                def channel():
                    called.append(1)
                    raise original
                with fault(kind, lambda:bool(called)):
                    with self.assertRaises(RuntimeError) as caught:
                        log.invoke(IDENTITY, RESOURCES, channel)
                self.assertIs(caught.exception, original)
                phase = log.phases()[0]
                self.assertEqual(phase['status'], 'unfinished')
                self.assertEqual(phase['observed_outcome'], 'error' if kind in ('fsync','close') else None)

    def test_secondary_close_failure_preserves_first_io_exception_at_start_and_terminal(self):
        for kind in ('write', 'partial', 'fsync'):
            for terminal in (False, True):
                with self.subTest(kind=kind, terminal=terminal):
                    log = PL.PhaseLog(self.out/(kind+str(terminal)))
                    called = []
                    with fault(kind, lambda:not terminal or bool(called), second_close=True) as primary:
                        with self.assertRaises(PL.PhaseError if kind == 'partial' else OSError) as caught:
                            log.invoke(IDENTITY, RESOURCES, lambda:called.append(1))
                    if kind != 'partial': self.assertIs(caught.exception, primary)
                    self.assertTrue(all(p['status'] == 'unfinished' for p in log.phases()))

    def test_directory_sync_failure_prevents_channel_and_preserves_original_exception(self):
        log = PL.PhaseLog(self.out/'phases')
        original, cleanup = OSError('directory fsync'), SystemExit('directory close')
        fsync, close = os.fsync, os.close
        calls = []
        def syncing(fd):
            calls.append(fd)
            if len(calls) == 2: raise original
            fsync(fd)
        def closing(fd):
            close(fd)
            if len(calls) == 2: raise cleanup
        called = []
        with patch.object(PL.os, 'fsync', syncing), patch.object(PL.os, 'close', closing):
            with self.assertRaises(OSError) as caught:
                log.invoke(IDENTITY, RESOURCES, lambda:called.append(1))
        self.assertIs(caught.exception, original)
        self.assertEqual(called, [])
        self.assertEqual(log.phases()[0]['status'], 'unfinished')

    def test_exact_adopted_caller_initializes_then_preserves_admission_and_channel_order(self):
        env, events = caller_env(self.out)
        self.assertEqual(Path(env['phase_log'].path), self.out/'bake-phases.jsonl')
        (self.out/'launch-limits.json').write_text(json.dumps({'wall_seconds':321,'rss_mib':123}))
        fake_run = types.ModuleType('run')
        fake_run.resources = lambda:dict(processes=[[1,0,44,10],[2,1,44,20],[3,1,99,90]], disk_free=123)
        mesh = NS(loop_triangles=[1,2], calc_loop_triangles=lambda:None)
        with patch.dict(sys.modules, {'run':fake_run}):
            result = env['bake'].bake_material(NS(name='Mule_Accent.001'), [NS(data=mesh)], 4096, label='mule_damaged_Accent')
        self.assertEqual(result, ['baseColor','roughness'])
        self.assertEqual(events, [('admit','bake Mule_Accent.001'),('channels',['baseColor']),('channels',['roughness'])])
        phases = env['phase_log'].phases()
        self.assertEqual([p['status'] for p in phases], ['success','success'])
        self.assertEqual(phases[0]['resources'], dict(disk_free=123, group_rss_kib=30, wall_limit_s=321, rss_limit_kib=125952))
        self.assertEqual(phases[0]['variant'], 'mule_damaged')
        self.assertIsNone(PL._FRAME.get())

    def test_exact_adopted_caller_denied_admission_never_samples_or_bakes(self):
        original = RuntimeError('denied')
        env, events = caller_env(self.out, admission=original)
        mesh = NS(loop_triangles=[], calc_loop_triangles=lambda:None)
        with self.assertRaises(RuntimeError) as caught:
            env['bake'].bake_material(NS(name='Mule_Accent.001'), [NS(data=mesh)], 4096, label='mule_Accent')
        self.assertIs(caught.exception, original)
        self.assertEqual(events, [('admit','bake Mule_Accent.001')])
        self.assertFalse((self.out/'bake-phases.jsonl').exists())
        self.assertIsNone(PL._FRAME.get())

    def test_exact_adopted_caller_stops_later_channels_after_publication_failure(self):
        env, events = caller_env(self.out)
        (self.out/'launch-limits.json').write_text(json.dumps({'wall_seconds':5400,'rss_mib':8192}))
        fake_run = types.ModuleType('run')
        fake_run.resources = lambda:dict(processes=[])
        mesh = NS(loop_triangles=[], calc_loop_triangles=lambda:None)
        with patch.dict(sys.modules, {'run':fake_run}):
            with fault('fsync', lambda:any(e[0]=='channels' for e in events)) as original:
                with self.assertRaises(OSError) as caught:
                    env['bake'].bake_material(NS(name='Mule_Accent.001'), [NS(data=mesh)], 4096, label='mule_Accent')
        self.assertIs(caught.exception, original)
        self.assertEqual(events, [('admit','bake Mule_Accent.001'),('channels',['baseColor'])])
        phase = env['phase_log'].phases()[0]
        self.assertEqual(phase['observed_outcome'], 'success')
        self.assertEqual(phase['status'], 'unfinished')
        self.assertIsNone(PL._FRAME.get())

    def test_documented_install_is_exact_adopted_code_after_out_binding(self):
        source = (CALLER/'export_saved.py').read_text()
        snippet = (HERE/'INTEGRATION.md').read_text().split('```python\n')[1].split('```')[0]
        self.assertIn(snippet, source)
        self.assertLess(source.index("out=Path(os.environ['MULE_ATTEMPT'])"), source.index(snippet))
        self.assertLess(source.index('bake.bake_material=bounded_material'), source.index(snippet))
        self.assertLess(source.index(snippet), source.index("(out/'identity-controls.json')"))

    def test_exact_launch_block_makes_limits_available_before_popen_returns(self):
        env, _ = caller_env(self.out)
        snapshots = []
        fake_run = types.ModuleType('run')
        fake_run.resources = lambda:dict(processes=[[1,0,44,10]])
        def popen(*args, **kwargs):
            snapshots.append(env['resource_snapshot']())
            return NS(pid=44, poll=lambda:0)
        receipt = {'status':'STARTING', 'limits':{'wall_seconds':321,'rss_mib':123}}
        scope = dict(out=self.out, subprocess=NS(Popen=popen, STDOUT=-2), command=['fake'],
                     ROOT=ROOT, env={}, receipt=receipt, json=json)
        with patch.dict(sys.modules, {'run':fake_run}):
            exec(compile(ast.Module(body=[launch_block()], type_ignores=[]), str(CALLER/'run.py'), 'exec'), scope)
        self.assertEqual(snapshots, [dict(group_rss_kib=10, wall_limit_s=321, rss_limit_kib=125952)])
        started = json.loads((self.out/'started.json').read_text())
        self.assertEqual(started, {'status':'RUNNING', 'pid':44, 'pgid':44, 'limits':{'wall_seconds':321,'rss_mib':123}})
        self.assertEqual(json.loads((self.out/'launch-limits.json').read_text()), {'wall_seconds':321,'rss_mib':123})
        self.assertEqual(receipt['status'], 'RUNNING')
        self.assertEqual(receipt['pid'], 44)

    def test_exact_launch_block_receipt_failure_prevents_popen(self):
        called = []
        scope = dict(out=self.out, subprocess=NS(Popen=lambda *a,**k:called.append(1), STDOUT=-2),
                     command=['fake'], ROOT=ROOT, env={}, receipt={'limits':{}}, json=json)
        original = OSError('startup receipt failed')
        with patch.object(Path, 'write_text', side_effect=original):
            with self.assertRaises(OSError) as caught:
                exec(compile(ast.Module(body=[launch_block()], type_ignores=[]), str(CALLER/'run.py'), 'exec'), scope)
        self.assertIs(caught.exception, original)
        self.assertEqual(called, [])

    def test_missing_or_invalid_startup_receipt_fails_without_waiting_or_defaults(self):
        env, _ = caller_env(self.out)
        fake_run = types.ModuleType('run')
        fake_run.resources = lambda:dict(processes=[])
        with patch.dict(sys.modules, {'run':fake_run}):
            with self.assertRaises(FileNotFoundError): env['resource_snapshot']()
            (self.out/'launch-limits.json').write_text('{}')
            with self.assertRaises(KeyError): env['resource_snapshot']()
            (self.out/'launch-limits.json').write_text('{')
            with self.assertRaises(json.JSONDecodeError): env['resource_snapshot']()

    def test_exact_caller_entrypoint_propagates_export_failure_despite_acknowledged_channel(self):
        env, _ = caller_env(self.out, main=lambda *a:1)
        env['phase_log'].invoke(IDENTITY, RESOURCES, lambda:None)
        self.assertEqual(env['phase_log'].phases()[0]['status'], 'success')
        env['__name__'] = '__main__'
        tree = ast.parse((CALLER/'export_saved.py').read_text())
        main = tree.body[-1]
        with self.assertRaises(SystemExit) as caught:
            exec(compile(ast.Module(body=[main], type_ignores=[]), str(CALLER/'export_saved.py'), 'exec'), env)
        self.assertEqual(caught.exception.code, 1)
        original = KeyboardInterrupt('export interrupted')
        def fail(*a): raise original
        env['export'].main = fail
        with self.assertRaises(KeyboardInterrupt) as caught:
            exec(compile(ast.Module(body=[main], type_ignores=[]), str(CALLER/'export_saved.py'), 'exec'), env)
        self.assertIs(caught.exception, original)

    def test_actual_export_main_rejects_channel_logging_failure(self):
        source = ROOT/'packages/tools/blender/artlib/export.py'
        tree = ast.parse(source.read_text())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        (self.out/'hulls').mkdir()
        (self.out/'hulls/mule.blend').write_text('fake source discovery only')
        args = NS(src_root=str(self.out), only='mule', out_dir=str(self.out/'output'), compress=None)
        rules = {'families':{'hulls':{}}, 'output':'{family}/{stem}.glb'}
        for kind in ('open', 'write', 'partial', 'fsync', 'close'):
            with self.subTest(kind=kind):
                log = PL.PhaseLog(self.out/kind)
                called, dropped = [], []
                def export_one(*args):
                    return log.invoke(IDENTITY, RESOURCES, lambda:called.append(1))
                env = dict(Path=Path, parse=lambda argv:args,
                           R=NS(load=lambda:rules, rel=str),
                           ktx=NS(settings=lambda *a:{}), meshopt=NS(settings=lambda *a:{}),
                           export_one=export_one, _drop_stale=dropped.append,
                           traceback=NS(print_exc=lambda:None))
                exec(compile(ast.Module(body=[main], type_ignores=[]), str(source), 'exec'), env)
                with fault(kind, lambda:bool(called)), redirect_stdout(io.StringIO()):
                    self.assertEqual(env['main']('hulls', []), 1)
                self.assertEqual(called, [1])
                self.assertEqual(dropped, [self.out/'output/hulls/mule.glb'])
                self.assertEqual(log.phases()[0]['status'], 'unfinished')


if __name__ == '__main__':
    unittest.main(verbosity=2)
