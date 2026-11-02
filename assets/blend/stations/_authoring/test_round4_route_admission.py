"""Fresh-process CPU route queries and caller refusal; no package code/job/browser/GPU."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
import run_round4_remaining8 as caller

NODE = str(Path(shutil.which('node')).resolve())
QUERY = Path(__file__).with_name('test_round4_station_routes.mjs')
OUT = Path(os.environ['ROUND4_ROUTE_ADMISSION_OUTPUT']).resolve()
OUT.mkdir(exist_ok=False, parents=True)
RECORDS = []


class Controls(unittest.TestCase):
    def setUp(self):
        self.owner = tempfile.TemporaryDirectory(prefix='station-route-admission-')
        self.root = Path(self.owner.name); self.out = OUT / self._testMethodName; self.out.mkdir()
    def tearDown(self):
        owned = str(self.root); self.owner.cleanup(); self.assertFalse(Path(owned).exists())
        RECORDS.append({'test': self.id(), 'root': owned, 'absent': True, 'scope': 'OWNED_FAKE_TREE_CPU_ONLY'})
        (OUT / 'fixtures.json').write_text(json.dumps(RECORDS, indent=2)+'\n')
    def package(self, directory, entry='index.mjs'):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'package.json').write_text(json.dumps({'name':'fake-route', 'exports':{'import':'./'+entry, 'require':'./index.cjs'}}))
        (directory / entry).write_text('throw Error("CPU fixture must never execute");')
        (directory / 'index.cjs').write_text('throw Error("CPU fixture must never execute");')
    def query(self, origin):
        file = self.root / 'query.json'; file.write_text(json.dumps({'origin':str(origin), 'specifier':'fake-route', 'mode':'import'}))
        run = subprocess.run([NODE, '--experimental-import-meta-resolve', str(QUERY), '--query', str(file)], capture_output=True, text=True, timeout=5)
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(run.stdout)
    def test_new_shadow_rejected_in_fresh_node_queries(self):
        origin = self.root / 'project/deep/entry.mjs'; origin.parent.mkdir(parents=True)
        old = self.root / 'project/node_modules/fake-route'; self.package(old)
        before = self.query(origin); previous = (old/'index.mjs').read_bytes()
        self.package(self.root / 'project/deep/node_modules/fake-route')
        after = self.query(origin)
        self.assertEqual((old/'index.mjs').read_bytes(), previous)
        self.assertNotEqual(before, after); self.assertNotEqual(before['entry']['resolved'], after['entry']['resolved'])
        (self.out / 'observed.json').write_text(json.dumps({'before':before, 'after':after,'oldTargetBytesUnchanged':True},indent=2)+'\n')
    def test_exports_retarget_rejected_in_fresh_node_queries(self):
        origin = self.root / 'project/entry.mjs'; origin.parent.mkdir(parents=True)
        package = origin.parent/'node_modules/fake-route'; self.package(package)
        before = self.query(origin); self.package(package,'replacement.mjs'); after = self.query(origin)
        self.assertNotEqual(before['entry']['resolved'], after['entry']['resolved'])
        self.assertTrue((package/'index.mjs').exists())
    def test_real_preflight_route_failure_stops_before_stage_allocation(self):
        ready = json.loads((caller.BASE / 'station_remaining8_ready01/readiness.json').read_text())
        ready['input_sha256'] = {}
        # Pure Node verifier intentionally compares fake snapshots; no dependency is touched.
        expected = self.root / 'bad-routes.json'; expected.write_text('{}')
        ready['route_verify_argv'] = [NODE, '--experimental-import-meta-resolve',
            str(QUERY.with_name('resolve_round4_station_routes.mjs')), '--verify', str(expected)]
        ready_path = self.root/'ready.json'; ready_path.write_text(json.dumps(ready))
        grant = {'authorization_id':'CPU_ONLY_FAKE_ROUTE_REFUSAL_NOT_AUTHORIZATION',
                 'purpose':'STATION_ROUND4_REMAINING_EIGHT_ONLY', 'readiness_sha256':caller.sha(ready_path),
                 'runner_sha256':caller.sha(caller.__file__),
                 'entry_sha256':caller.sha(QUERY.with_name('capture_round4_stage.py')),
                 'authorized_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=caller.ROOT,text=True).strip()}
        grant_path = self.root/'fake_grant.json'; grant_path.write_text(json.dumps(grant))
        with patch.object(caller,'GRANT',grant_path), patch.object(caller,'READY',ready_path), \
             patch.dict(os.environ,{'STATION_ROUND4_GPU_GRANT':grant['authorization_id']}), \
             patch.object(caller,'create_private_tmp',side_effect=AssertionError('must not allocate')), \
             patch.object(caller,'StationJob',side_effect=AssertionError('must not construct')):
            with self.assertRaisesRegex(AssertionError,'Logical dependency route check failed'):
                caller.preflight(check_outputs=False)
    def test_verifier_success_and_exact_command(self):
        argv = [NODE, '--experimental-import-meta-resolve', str(QUERY.with_name('resolve_round4_station_routes.mjs')),
            '--verify', str(caller.FREEZE/'resolution_routes.json')]
        caller.verify_routes({'route_verify_argv':argv})


if __name__ == '__main__': unittest.main(verbosity=2)
