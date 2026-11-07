"""Exact retained VM member through the actual adapter/helper; no native process ports."""
import ast,copy,json,os,re,sys,time
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path.cwd()/'packages/tools/src/capture/effects_packet'))
import native_ports
from contract import ROOT,sha,snapshot
from evidence import failure
E=Path(__file__).parent
SOURCE=ROOT/'assets/blend/stations/_authoring/run_round4_remaining8.py'
MTL='/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/MTLCompilerService.xpc/Contents/MacOS/MTLCompilerService'
OBSERVED='/private/tmp/p1-e05-t03-viewmodel-packet-r5-rdtnxbus/review-thalune/job/observed_execution.json'
OBSERVED_SHA='b6b4c0a4f1df8fd470de49f8c3effcfdfe0ef6e5240979563fdc5a9696d7f802'

def replay(ready,case='exact'):
 observed=snapshot(OBSERVED);assert observed['sha256']==OBSERVED_SHA
 member=next(x for x in observed['value']['processes'] if x['binary']==MTL)
 assert sha(SOURCE)=='4cc69399da225c755833ab8c35972e2a1845eec45198cad29488994ff870c5d8'
 node=next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n,ast.ClassDef) and n.name=='StageReceipts')
 calls=[];writes=[];count=[0]
 def ident(pid):
  count[0]+=1;v=copy.deepcopy(member['kernel'])
  if case=='wrong-uid':v['uid']+=1
  if case=='wrong-birth' or (case=='pid-reuse-after-executable' and count[0]>1):v['birth'][1]+=1
  if case=='unknown-identity':v=None
  calls.append({'port':'identity','pid':pid,'value':v});return v
 def coalition(pid):
  v=member['coalition'].copy()
  if case=='wrong-coalition':v[0]+=1
  calls.append({'port':'coalition','pid':pid,'value':v});return v
 def executable(pid):
  v=MTL if case not in ('unknown-binary','substituted') else (None if case=='unknown-binary' else MTL+'-not-bound')
  calls.append({'port':'executable','pid':pid,'value':v});return v
 ns={'Path':Path,'time':time,'os':os,'re':re,'failure':failure,'write':lambda path,value:writes.append({'path':str(path),'value':copy.deepcopy(value)}),
     'identity':ident,'coalition':coalition,'executable_path':executable,'current_commands':lambda rows:{member['kernel']['pid']:'retained VM CPU fixture only'},
     'parse_launch':lambda *a:None,'VTENCODER':ready['appleEncoder']['executable']['path'],'utc':lambda:'CPU_REPLAY_NO_CURRENT_OWNERSHIP'}
 exec(compile(ast.Module(body=[node],type_ignores=[]),str(SOURCE),'exec'),ns)
 job=SimpleNamespace(out=E/'never-created-observer-out',scratch=E/'never-created-observer-scratch',state={},members=lambda:[member['kernel']],coalition_id=member['coalition'][0])
 port=native_ports.NativePorts.__new__(native_ports.NativePorts);port.ready=ready;port.result={'raw':{}};port.tmp=E/'never-created-observer-tmp';port.stages=SimpleNamespace(StageReceipts=ns['StageReceipts'])
 observer=port.observer(job);error=None
 try:observer.observe()
 except AssertionError as e:error=failure(e)
 receipt=observer.receipt();admitted=any(x['binary']==MTL and x['admitted'] for x in receipt['processes'])
 return {'case':case,'admitted':admitted,'error':error,'calls':calls,'writes':writes,'receipt':receipt,'raw':port.result['raw'],'observedSnapshotSha256':observed['sha256'],'historicalPidQueriedOrSignalled':False}

import signal
import stat
import subprocess
import unittest
from unittest.mock import patch
import apple_mtl
from contract import Refused


class MtlControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bound = apple_mtl.binding()  # Only the two exact codesign verification commands.
        cls.ready = snapshot(ROOT / 'packages/tools/src/capture/effects_packet/readiness.json')['value']

    def inert_verifier(self, argv, **kw):
        self.assertEqual(kw, {'capture_output': True, 'text': True, 'timeout': 5})
        row = next(r for r in self.bound['observations'] if r['argv'] == argv)
        return subprocess.CompletedProcess(argv, row['exit'], row['stdout'], row['stderr'])

    def test_exact_signature_and_protected_routes(self):
        self.assertEqual(self.bound['executable']['sha256'], apple_mtl.SHA256)
        self.assertEqual(self.bound['codesign']['sha256'], apple_mtl.CODESIGN_SHA256)
        for row in self.bound['route'] + self.bound['codesignRoute']:
            self.assertEqual(row['st_uid'], 0)
            self.assertFalse(row['st_mode'] & 0o022)
            self.assertFalse(stat.S_ISLNK(row['st_mode']))
        self.assertEqual([r['exit'] for r in self.bound['observations']], [0, 0])

    def test_actual_adapter_and_helper_ownership_boundaries(self):
        for case in ('unbound', 'exact', 'wrong-uid', 'wrong-birth', 'wrong-coalition',
                     'pid-reuse-after-executable', 'unknown-binary', 'substituted', 'unknown-identity'):
            with self.subTest(case=case):
                ready = copy.deepcopy(self.ready)
                ready['process_binary_sha256'].pop(MTL, None)
                if case != 'unbound':
                    ready['process_binary_sha256'][MTL] = self.bound['executable']['sha256']
                result = replay(ready, case)
                self.assertEqual(result['admitted'], case == 'exact')
                if case == 'unbound':
                    self.assertEqual(result['error']['message'], 'Unbound owned executable: ' + MTL)
                    self.assertIn('captureObservationFailures', result['raw'])
                elif case == 'exact':
                    self.assertIsNone(result['error'])
                    self.assertEqual(result['receipt']['processes'][0]['prelaunch_sha256'], apple_mtl.SHA256)
                elif case == 'unknown-identity':
                    # Existing helper treats a vanished/unknown member as unadmitted, never owned evidence.
                    self.assertEqual(result['receipt']['processes'], [])
                else:
                    self.assertIsNotNone(result['error'])
                self.assertFalse(result['receipt']['all_ever_lived_processes_observed'])
                self.assertEqual(result['receipt']['external_native_XPC_ownership'], 'UNQUALIFIED')

    def test_every_route_component_refuses_owner_writeability_and_link_substitution(self):
        original = Path.lstat
        for route in (self.bound['route'], self.bound['codesignRoute']):
            for row in route:
                for kind in ('uid', 'writable', 'symlink'):
                    with self.subTest(path=row['path'], kind=kind):
                        def altered(path, *args, **kw):
                            value = original(path, *args, **kw)
                            if str(path) != row['path']:
                                return value
                            values = {k: getattr(value, k) for k in ('st_dev','st_ino','st_uid','st_gid','st_mode')}
                            if kind == 'uid': values['st_uid'] = os.getuid()
                            if kind == 'writable': values['st_mode'] |= 0o020
                            if kind == 'symlink': values['st_mode'] = stat.S_IFLNK | 0o777
                            return SimpleNamespace(**values)
                        with patch.object(Path, 'lstat', altered), patch.object(apple_mtl, 'file_binding', side_effect=AssertionError('hash forbidden')), self.assertRaises(Refused):
                            apple_mtl.binding()

    def test_leaf_must_be_executable_regular_file_before_hash(self):
        original = Path.lstat
        for mode in (stat.S_IFIFO | 0o555, stat.S_IFREG | 0o444):
            def altered(path, *a, **kw):
                info = original(path, *a, **kw)
                if str(path) != MTL: return info
                return SimpleNamespace(st_mode=mode, st_uid=0)
            with patch.object(Path, 'lstat', altered), patch.object(apple_mtl, 'file_binding', side_effect=AssertionError('hash forbidden')), self.assertRaises(Refused):
                apple_mtl.binding()

    def test_executable_and_verifier_substitution_refuse_before_codesign(self):
        original = apple_mtl.file_binding
        for path in (MTL, apple_mtl.CODESIGN):
            for key in ('sha256', 'bytes'):
                with self.subTest(path=path, key=key):
                    def changed(p):
                        row = original(p)
                        if str(p) == path: row[key] = '0' * 64 if key == 'sha256' else row[key] + 1
                        return row
                    with patch.object(apple_mtl, 'file_binding', changed), patch.object(apple_mtl.subprocess, 'run', side_effect=AssertionError('verifier forbidden')), self.assertRaises(Refused):
                        apple_mtl.binding()

    def test_signature_exit_identifier_platform_requirement_and_cdhash(self):
        for case in ('exit', 'identifier', 'platform', 'requirement', 'cdhash'):
            with self.subTest(case=case):
                def changed(argv, **kw):
                    result = self.inert_verifier(argv, **kw)
                    if case == 'exit': result.returncode = 1
                    if '-d' in argv:
                        pairs = {'identifier': ('Identifier=com.apple.MTLCompilerService', 'Identifier=impostor'),
                                 'platform': ('Platform identifier=26', 'Platform identifier=0'),
                                 'requirement': ('designated => ' + apple_mtl.REQUIREMENT, 'designated => anchor apple'),
                                 'cdhash': (apple_mtl.CDHASH, '0' * 40)}
                        if case in pairs:
                            a, b = pairs[case]
                            result.stdout = result.stdout.replace(a, b); result.stderr = result.stderr.replace(a, b)
                    return result
                with patch.object(apple_mtl.subprocess, 'run', changed), self.assertRaises(Refused):
                    apple_mtl.binding()

    def test_exact_signature_output_cap(self):
        for count in (64 * 1024, 64 * 1024 + 1):
            def response(argv, **kw):
                result = self.inert_verifier(argv, **kw)
                if '--verify' in argv: result.stdout, result.stderr = 'x' * count, ''
                return result
            with patch.object(apple_mtl.subprocess, 'run', response):
                if count == 64 * 1024:
                    self.assertEqual(apple_mtl.binding()['executable'], self.bound['executable'])
                else:
                    with self.assertRaises(Refused): apple_mtl.binding()

    def test_post_signature_route_and_byte_changes_refuse(self):
        for path in (MTL, apple_mtl.CODESIGN):
            for kind in ('route', 'bytes'):
                with self.subTest(path=path, kind=kind):
                    count = [0]
                    original = apple_mtl.protected_route if kind == 'route' else apple_mtl.file_binding
                    def changed(p):
                        value = original(p)
                        if str(p) == path:
                            count[0] += 1
                            if count[0] > 1:
                                if kind == 'route': value[-1]['st_ino'] += 1
                                else: value['sha256'] = '0' * 64
                        return value
                    with patch.object(apple_mtl, 'protected_route' if kind == 'route' else 'file_binding', changed), patch.object(apple_mtl.subprocess, 'run', self.inert_verifier), self.assertRaises(Refused):
                        apple_mtl.binding()

    def test_verifier_exception_and_real_sigalrm_propagate(self):
        primary = OSError(5, 'unknown codesign failure');primary.unknown = {'partial': b'raw\xff'}
        with patch.object(apple_mtl.subprocess, 'run', side_effect=primary):
            with self.assertRaises(OSError) as caught: apple_mtl.binding()
            self.assertIs(caught.exception, primary)
        def alarm(*a, **kw): signal.raise_signal(signal.SIGALRM)
        with patch.object(apple_mtl.subprocess, 'run', alarm), self.assertRaises(native_ports.PhaseExpired), native_ports.phase(2):
            apple_mtl.binding()
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0., 0.))


if __name__ == '__main__':
    unittest.main()
