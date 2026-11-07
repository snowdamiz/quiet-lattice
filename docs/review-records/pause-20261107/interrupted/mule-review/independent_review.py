"""Exact adopted caller + pinned bake/main with fake imports/system ports only."""
import ast
import builtins
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from adversarial_review import FakeScene, CHANNELS, PL, RootFailure, UnprintableFailure, IDENTITY, RESOURCES

HERE = Path(__file__).resolve().parent
ROOT = Path('/Users/andreyyurlov/.t3/worktrees/space/t3-348f0295')
CALLER = ROOT/'packages/tools/blender/hulls/mule-round4/export_saved.py'
RUN = CALLER.with_name('run.py')


def exact_caller(out, scene=None, admission=None):
    scene = scene or FakeScene(CHANNELS)
    # FakeScene already installs the old bounded_material. Use its saved stock
    # function so the full concrete caller owns the single installation here.
    scene.mod.bake_material = scene.mod.material_bake
    for obj in scene.objects:
        obj.data = NS(loop_triangles=[1, 2], calc_loop_triangles=lambda: None)
    scene.mod.ensure_cycles = lambda *a: None
    events = []
    def check(label):
        events.append(('admit', label))
        if admission is not None:
            raise admission
    def resources():
        events.append(('resources',))
        return dict(processes=[[10, 0, 44, 5], [11, 10, 44, 7], [12, 0, 55, 90]], disk_free=500)
    class Cache:
        def __truediv__(self, part): return self
        def read_bytes(self): return b'fake read-only cache'
    def path(value):
        return Cache() if value == '/Users/andreyyurlov/Documents/dev/space' else Path(value)
    artlib = NS(bake=scene.mod, export=NS(_write=lambda: None),
                meshopt=NS(compress=lambda: None), ktx=NS(compress=lambda: None),
                core=NS(load=lambda *a: None, run_checks=lambda *a: None))
    ports = {'sys': NS(path=[], stdout=NS(reconfigure=lambda **kw: None), exit=sys.exit),
             'os': NS(environ={'MULE_ATTEMPT': str(out)}, getpgrp=lambda: 44),
             'pathlib': NS(Path=path), 'hashlib': NS(sha256=lambda b: NS(digest=lambda: b'fake digest')),
             'artlib': artlib,
             'checkpoint': NS(check=check),
             'export_identity': NS(snapshot=lambda *a: None, compare=lambda *a: None, negative_controls=lambda: []),
             'phase_log': PL, 'run': NS(resources=resources)}
    def importing(name, globals=None, locals=None, fromlist=(), level=0):
        if name in ports: return ports[name]
        if name in ('json', 'shutil'):
            return builtins.__import__(name, globals, locals, fromlist, level)
        raise AssertionError('Unexpected import '+name)
    env = dict(__builtins__={**vars(builtins), '__import__': importing},
               __file__=str(CALLER), __name__='fake_adopted_caller')
    # Entire source, including actual import and install statements, unchanged.
    exec(compile(CALLER.read_bytes(), str(CALLER), 'exec'), env)
    return env, scene, events


def material(env, scene):
    return env['bake'].bake_material(scene.mat, scene.objects, 4096, ao=True,
                                    label='mule_damaged_Accent', occluders=[scene.occluder])


def cleanup_state(scene):
    nt = scene.mat.node_tree
    return dict(surface=nt.nodes[0].inputs['Surface'].links[0].from_socket.name,
                node_names=[n.name for n in nt.nodes],
                guard=scene.other.node_tree.nodes.active.name,
                hidden=[scene.occluder.hide_render, scene.foreign.hide_render],
                scratch=[i.name for i in scene.images if i.name == '_bake_scratch'])


@contextlib.contextmanager
def io_fault(path, kind, active, secondary=False):
    """Target only logger file descriptors; no fixture/helper writes faulted."""
    original = {n: getattr(os, n) for n in ('open', 'write', 'fsync', 'close')}
    fds = set()
    error = OSError('independent '+kind)
    cleanup = SystemExit('independent secondary close')
    def opening(p, *a, **kw):
        is_log = os.fspath(p) == str(path)
        if is_log and active() and kind == 'open': raise error
        fd = original['open'](p, *a, **kw)
        if is_log: fds.add(fd)
        return fd
    def writing(fd, data):
        if fd in fds and active():
            if kind == 'write': raise error
            if kind == 'zero': return 0
            if kind == 'partial': return original['write'](fd, data[:len(data)//2])
            if kind == 'complete-then-raise':
                original['write'](fd, data)
                raise error
        return original['write'](fd, data)
    def syncing(fd):
        if fd in fds and active() and kind == 'fsync': raise error
        return original['fsync'](fd)
    def closing(fd):
        is_log = fd in fds
        original['close'](fd)
        fds.discard(fd)
        if is_log and active():
            if secondary: raise cleanup
            if kind == 'close': raise error
    with patch.multiple(PL.os, open=opening, write=writing, fsync=syncing, close=closing):
        yield error


class Independent(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=HERE/'tmp')
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)
    def attempt(self, name='attempt'):
        out = self.out/name
        out.mkdir()
        (out/'launch-limits.json').write_text(json.dumps({'wall_seconds': 5400, 'rss_mib': 8192}))
        return out
    def test_full_concrete_caller_imports_initializes_and_preserves_stock_result(self):
        out = self.attempt()
        env, scene, events = exact_caller(out)
        baseline = FakeScene(CHANNELS)
        stock, error, _ = baseline.run(False, self.out/'stock')
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream): result = material(env, scene)
        self.assertIsNone(error)
        self.assertEqual(result, stock['result'])
        self.assertEqual(scene.events, [e for e in stock['events'] if e[0] != 'admit'])
        self.assertEqual(stream.getvalue(), stock['stdout'])
        self.assertEqual(events[0], ('admit', 'bake Mule_Accent.001'))
        self.assertEqual(len(events), 1 + len(CHANNELS))
        phases, tail = PL.load(env['phase_log'].path)
        self.assertIsNone(tail)
        self.assertEqual([p['channel'] for p in phases], CHANNELS)
        self.assertTrue(all(p['observed_outcome']=='success' and p['status']=='unfinished' and p['publication']=='unconfirmed' for p in phases))
        self.assertTrue(all(p['status']=='success' and p['publication']=='acknowledged' for p in env['phase_log'].phases()))
        self.assertEqual(phases[0]['resources'], dict(disk_free=500, group_rss_kib=12, wall_limit_s=5400, rss_limit_kib=8388608))
        self.assertIsNone(PL._FRAME.get())
    def test_concrete_admission_prevents_snapshot_and_channel(self):
        original = KeyboardInterrupt('denied')
        env, scene, events = exact_caller(self.attempt(), admission=original)
        with self.assertRaises(KeyboardInterrupt) as caught: material(env, scene)
        self.assertIs(caught.exception, original)
        self.assertEqual(events, [('admit', 'bake Mule_Accent.001')])
        self.assertEqual(scene.events, [])
        self.assertFalse(Path(env['phase_log'].path).exists())
        self.assertIsNone(PL._FRAME.get())
    def test_logger_fault_matrix_stops_actual_caller_and_restores_material_cleanup(self):
        for terminal in (False, True):
            for kind in ('open', 'write', 'zero', 'partial', 'complete-then-raise', 'fsync', 'close'):
                with self.subTest(terminal=terminal, kind=kind):
                    out = self.attempt(str(terminal)+kind)
                    env, scene, _ = exact_caller(out)
                    before = cleanup_state(scene)
                    active = lambda: not terminal or any(e[0]=='finish' for e in scene.events)
                    with io_fault(Path(env['phase_log'].path), kind, active) as original:
                        with self.assertRaises(PL.PhaseError if kind in ('partial','zero') else OSError) as caught:
                            material(env, scene)
                    if kind not in ('partial','zero'): self.assertIs(caught.exception, original)
                    self.assertEqual(cleanup_state(scene), before)
                    self.assertEqual([e[1] for e in scene.events if e[0]=='bake'], ['baseColor'] if terminal else [])
                    self.assertIsNone(PL._FRAME.get())
                    phases, tail = PL.load(env['phase_log'].path)
                    self.assertEqual(env['phase_log'].phases(), phases)
                    self.assertTrue(all(p['status']=='unfinished' and p['publication']=='unconfirmed' for p in phases))
                    if terminal:
                        self.assertEqual(len(phases), 1)
                        self.assertEqual(phases[0]['observed_outcome'], 'success' if kind in ('complete-then-raise','fsync','close') else None)
    def test_all_exception_classes_keep_identity_despite_fault_and_secondary_close(self):
        for cls in (RuntimeError, KeyboardInterrupt, SystemExit, RootFailure, UnprintableFailure):
            for at in ('op', 'finish'):
                for kind in ('write', 'fsync'):
                    with self.subTest(cls=cls.__name__, at=at, kind=kind):
                        out = self.attempt(cls.__name__+at+kind)
                        original = cls('primary')
                        scene = FakeScene(CHANNELS, original, at)
                        env, scene, _ = exact_caller(out, scene)
                        before = cleanup_state(scene)
                        active = lambda: any(e[0]=='bake' and e[1]=='roughness' for e in scene.events)
                        with io_fault(Path(env['phase_log'].path), kind, active, secondary=True):
                            with self.assertRaises(cls) as caught: material(env, scene)
                        self.assertIs(caught.exception, original)
                        self.assertEqual(cleanup_state(scene), before)
                        self.assertEqual([e[1] for e in scene.events if e[0]=='bake'], ['baseColor','roughness'])
                        phases = env['phase_log'].phases()
                        self.assertEqual(phases[0]['status'], 'success')
                        self.assertEqual(phases[1]['status'], 'unfinished')
                        self.assertEqual(phases[1]['observed_outcome'], None if kind=='write' or cls is UnprintableFailure else 'interrupt' if cls in (SystemExit,KeyboardInterrupt) else 'error')
                        self.assertIsNone(PL._FRAME.get())
    def test_stale_existing_records_and_other_instances_never_gain_new_acknowledgement(self):
        path = self.out/'phases'
        old = PL.PhaseLog(path)
        old.invoke(IDENTITY, RESOURCES, lambda: 'old result')
        old.start(dict(IDENTITY, channel='roughness'), RESOURCES)
        new = PL.PhaseLog(path)
        self.assertTrue(all(p['publication']=='unconfirmed' for p in new.phases()))
        new.invoke(dict(IDENTITY, material='Fresh', channel='normal'), RESOURCES, lambda:'new result')
        current = new.phases()
        self.assertEqual([p['publication'] for p in current], ['unconfirmed','unconfirmed','acknowledged'])
        self.assertEqual([p['observed_outcome'] for p in current], ['success', None, 'success'])
        self.assertEqual([p['publication'] for p in old.phases()], ['acknowledged','unconfirmed','unconfirmed'])
        self.assertTrue(all(p['publication']=='unconfirmed' for p in PL.load(path)[0]))
    def test_reader_process_restart_cannot_recover_acknowledgements(self):
        path = self.out/'phases'
        writer = PL.PhaseLog(path)
        writer.invoke(IDENTITY, RESOURCES, lambda:None)
        script = "import sys,json;sys.path.insert(0,sys.argv[1]);from phase_log import PhaseLog;print(json.dumps(PhaseLog(sys.argv[2]).phases()))"
        child = subprocess.run([sys.executable, '-B', '-c', script, str(Path(PL.__file__).parent), str(path)], capture_output=True, text=True, timeout=5)
        self.assertEqual(child.returncode, 0, child.stderr)
        phase = json.loads(child.stdout)[0]
        self.assertEqual((phase['status'], phase['publication'], phase['observed_outcome']), ('unfinished','unconfirmed','success'))
    def test_partial_tail_followed_by_new_writer_fails_closed(self):
        path = self.out/'phases'
        log = PL.PhaseLog(path)
        log.start(IDENTITY, RESOURCES)
        with path.open('ab') as f: f.write(b'{"event":"succ')
        fresh = PL.PhaseLog(path)
        fresh.invoke(dict(IDENTITY, channel='normal'), RESOURCES, lambda:None)
        with self.assertRaises(PL.PhaseError): fresh.phases()
        with self.assertRaises(PL.PhaseError): PL.load(path)
    def test_exact_prelaunch_limits_ready_and_old_pid_receipt_compatible(self):
        out = self.out/'attempt'; out.mkdir()
        env, _, _ = exact_caller(out)
        observed=[]
        def popen(*args, **kw):
            self.assertFalse((out/'started.json').exists())
            observed.append(env['resource_snapshot']())
            return NS(pid=71, poll=lambda:0)
        tree = ast.parse(RUN.read_bytes())
        block = next(n for n in ast.walk(tree) if isinstance(n,ast.With) and ast.unparse(n.items[0].context_expr)=="(out / 'output.log').open('x')")
        receipt = dict(status='STARTING', limits=dict(wall_seconds=321, rss_mib=123, scratch_mib=4096, evidence_mib=512, images=48))
        scope = dict(out=out, subprocess=NS(Popen=popen, STDOUT=-2), command=['fake'], ROOT=ROOT, env={}, receipt=receipt, json=json)
        exec(compile(ast.Module(body=[block], type_ignores=[]), str(RUN), 'exec'), scope)
        self.assertEqual(observed[0]['wall_limit_s'],321)
        self.assertEqual(observed[0]['rss_limit_kib'],123*1024)
        self.assertEqual(json.loads((out/'launch-limits.json').read_text()), receipt['limits'])
        started=json.loads((out/'started.json').read_text())
        self.assertEqual((started['status'], started['pid'], started['pgid']), ('RUNNING',71,71))
    def test_missing_syntactically_bad_or_absent_limit_fields_prevent_actual_channel(self):
        for name,payload in [('missing',None),('json','{'),('empty','{}'),('array','[]'),('no_rss','{"wall_seconds":5400}')]:
            with self.subTest(name=name):
                out=self.out/name;out.mkdir()
                if payload is not None: (out/'launch-limits.json').write_text(payload)
                env,scene,_=exact_caller(out); before=cleanup_state(scene)
                with self.assertRaises((FileNotFoundError, ValueError, KeyError, TypeError)):
                    material(env,scene)
                self.assertEqual(cleanup_state(scene),before)
                self.assertFalse(any(e[0]=='bake' for e in scene.events))
                self.assertFalse(Path(env['phase_log'].path).exists())
    def test_entrypoint_actual_main_rejects_logging_failure_after_channel_return(self):
        for kind in ('open','write','partial','fsync','close'):
            with self.subTest(kind=kind):
                out=self.attempt(kind);env,scene,_=exact_caller(out)
                sources=out/'sources';(sources/'hulls').mkdir(parents=True)
                (sources/'hulls/mule.blend').write_text('fake discovery only')
                args=NS(src_root=str(sources), only='mule', out_dir=str(out/'result'), compress=None)
                rules={'families':{'hulls':{}},'output':'{family}/{stem}.glb'}
                dropped=[]
                main_env=dict(Path=Path,parse=lambda argv:args,R=NS(load=lambda:rules,rel=str),
                              ktx=NS(settings=lambda *a:{}),meshopt=NS(settings=lambda *a:{}),
                              export_one=lambda *a:material(env,scene),_drop_stale=dropped.append,
                              traceback=NS(print_exc=lambda:None))
                export_path=ROOT/'packages/tools/blender/artlib/export.py'
                main=next(n for n in ast.parse(export_path.read_bytes()).body if isinstance(n,ast.FunctionDef) and n.name=='main')
                exec(compile(ast.Module(body=[main],type_ignores=[]),str(export_path),'exec'),main_env)
                env['export'].main=main_env['main'];env['__name__']='__main__'
                entry=ast.parse(CALLER.read_bytes()).body[-1]
                active=lambda:any(e[0]=='finish' for e in scene.events)
                with io_fault(Path(env['phase_log'].path),kind,active), contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaises(SystemExit) as caught:
                        exec(compile(ast.Module(body=[entry],type_ignores=[]),str(CALLER),'exec'),env)
                self.assertEqual(caught.exception.code,1)
                self.assertEqual(dropped,[out/'result/hulls/mule.glb'])
                self.assertEqual([e[1] for e in scene.events if e[0]=='bake'],['baseColor'])
                self.assertEqual(env['phase_log'].phases()[0]['status'],'unfinished')
    def test_sigkill_in_concrete_adopted_caller_names_only_missing_roughness_terminal(self):
        out=self.attempt()
        script="""import os,signal,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from independent_review import exact_caller,material
env,scene,_=exact_caller(Path(sys.argv[2]))
original=scene.bpy.ops.object.bake
def kill(**kw):
    if scene.mat.node_tree.nodes.active.image.name.endswith('_roughness'):
        os.kill(os.getpid(),signal.SIGKILL)
    return original(**kw)
scene.bpy.ops.object.bake=kill
material(env,scene)
"""
        child=subprocess.run([sys.executable,'-B','-c',script,str(HERE),str(out)],capture_output=True,text=True,timeout=5)
        self.assertEqual(child.returncode,-signal.SIGKILL,child.stderr)
        phases,tail=PL.load(out/'bake-phases.jsonl')
        self.assertIsNone(tail)
        self.assertEqual([(p['channel'],p['observed_outcome']) for p in phases],[('baseColor','success'),('roughness',None)])
        self.assertEqual([(p['material'],p['variant'],p['channel']) for p in phases if p['observed_outcome'] is None],[('Mule_Accent.001','mule_damaged','roughness')])
        self.assertTrue(all(p['status']=='unfinished' and p['publication']=='unconfirmed' for p in phases))


if __name__=='__main__': unittest.main(verbosity=2)
