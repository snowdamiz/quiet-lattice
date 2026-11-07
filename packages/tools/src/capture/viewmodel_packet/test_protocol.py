"""Actual helper receipt -> OS exit -> parent authentication -> successor gate."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import boundary
from test_boundary import Repo, digest
from test_r2 import graph_decode

HERE = Path(__file__).resolve().parent


def scratch():
    return Path(tempfile.mkdtemp(prefix='vm-protocol-', dir=os.environ.get('VM_REVISION_TMP', '/private/tmp'))).resolve()


def repository():
    root = scratch(); repo = Repo(root)
    frozen = json.loads((HERE / 'readiness.json').read_text())
    repo.ready['bindings'] = {**frozen['bindings'], **repo.ready['bindings']}
    repo.ready_path.write_text(json.dumps(repo.ready))
    return root, repo


def process(repo, index, mode='success'):
    args = [sys.executable, '-B', str(HERE / 'protocol_child.py'), '--inert-cpu-fixture', str(repo.root.parent), str(index), mode]
    p = subprocess.run(args, capture_output=True, timeout=15)
    prefix = repo.root.parent / f'os-{index}-{mode}'
    prefix.with_suffix('.stdout').write_bytes(p.stdout); prefix.with_suffix('.stderr').write_bytes(p.stderr)
    prefix.with_suffix('.json').write_text(json.dumps({'argv': args, 'exit': p.returncode}, indent=2)+'\n')
    return p


class ProtocolTests(unittest.TestCase):
    def test_seven_actual_helper_processes_publish_admissible_protocol_receipts(self):
        root, repo = repository(); rows = []
        for index, unit in enumerate(repo.plan['units']):
            spec, paths, grant = repo.grant(index)
            # Real parent gate consumes the same authenticated receipts it read after OS exit.
            repo.admit(index, (spec, paths, grant))
            child = process(repo, index)
            self.assertEqual(child.returncode, 0, child.stdout + child.stderr)
            result_path = Path(paths['evidence']) / 'result.json'
            result, result_hash = boundary.json_snapshot(result_path, 20 * boundary.MIB)
            consumed, consumed_hash = boundary.json_snapshot(paths['consumption'])
            self.assertEqual(result['schema'], boundary.RESULT_SCHEMA)
            self.assertEqual(consumed['schema'], boundary.CONSUMPTION_SCHEMA)
            self.assertNotIn('rawGraph', result)
            self.assertFalse(result['accepted']); self.assertTrue(result['checksPassed']); self.assertTrue(result['released'])
            self.assertEqual(result['status'], 'AWAITING_CALLER_COMPLETION')
            self.assertEqual(result['consumptionSha256'], consumed_hash)
            self.assertEqual(len(result['outputManifest']), len(spec['files']))
            observations = graph_decode(result['observations'])
            native = observations['native']
            self.assertIs(native['allocations'][0]['admission'], native['privateRelease']['admission'])
            self.assertIs(observations['sharedAdmission'], native['privateRelease']['admission'])
            self.assertIs(observations['unknownCycle']['self'], observations['unknownCycle'])
            self.assertEqual(observations['unknownCycle']['byte'], b'\x00\xff')
            trace = json.loads(child.stdout)['trace']
            self.assertLess(trace.index('actual-native-returned-released'), trace.index('inert-decoder'))
            repo.previous.append({'unit': spec['id'], 'callerExit': child.returncode, 'resultSha256': result_hash, 'consumptionSha256': consumed_hash})
            self.assertEqual(boundary.git(repo.root, 'rev-parse', 'HEAD').decode().strip(), repo.head)
            rows.append({'unit': spec['id'], 'exit': child.returncode, 'head': repo.head, 'files': len(result['outputManifest']), 'resultSha256': result_hash, 'consumptionSha256': consumed_hash})
        self.assertEqual(sum(r['files'] for r in rows), 101)
        (root / 'chain.json').write_text(json.dumps(rows, indent=2)+'\n')

    def test_failed_publication_refused_drain_and_os_failure_stop_next_job(self):
        for mode in ('publication', 'all-sinks', 'drain-refused', 'after-return'):
            with self.subTest(mode=mode):
                root, repo = repository(); spec, paths, _ = repo.grant(0)
                child = process(repo, 0, mode)
                self.assertEqual(child.returncode, 1, child.stdout + child.stderr)
                summary = json.loads(child.stdout)
                self.assertTrue(Path(paths['consumption']).exists())
                if mode == 'drain-refused': self.assertNotIn('inert-decoder', summary['trace'])
                result_file = Path(paths['evidence']) / 'result.json'
                repo.previous = [{'unit': spec['id'], 'callerExit': child.returncode,
                    'resultSha256': digest(result_file) if result_file.exists() else '0'*64, 'consumptionSha256': digest(paths['consumption'])}]
                next_spec, next_paths, grant = repo.grant(1)
                with self.assertRaisesRegex(ValueError, 'observe caller exit 0'):
                    repo.admit(1, (next_spec, next_paths, grant))
                refused = process(repo, 1)
                self.assertEqual(refused.returncode, 1)
                self.assertEqual(json.loads(refused.stdout)['trace'], [])
                for name in ('output','evidence','consumption'): self.assertFalse(Path(next_paths[name]).exists())

    def test_changed_receipt_hash_and_reauthenticated_wrong_schema_stop_next_job(self):
        for mode in ('changed-hash', 'wrong-result-schema', 'wrong-consumption-schema'):
            with self.subTest(mode=mode):
                root, repo = repository(); spec, paths, _ = repo.grant(0)
                child = process(repo, 0); self.assertEqual(child.returncode, 0, child.stdout+child.stderr)
                result_file = Path(paths['evidence']) / 'result.json'
                repo.previous = [{'unit':spec['id'], 'callerExit':child.returncode, 'resultSha256':digest(result_file), 'consumptionSha256':digest(paths['consumption'])}]
                if mode == 'changed-hash': result_file.write_bytes(result_file.read_bytes()+b' ')
                else:
                    victim = result_file if mode == 'wrong-result-schema' else Path(paths['consumption'])
                    data=json.loads(victim.read_text());data['schema']='wrong/1';victim.write_text(json.dumps(data))
                    repo.previous[0]['resultSha256' if mode == 'wrong-result-schema' else 'consumptionSha256']=digest(victim)
                next_spec, next_paths, grant = repo.grant(1)
                with self.assertRaisesRegex(ValueError, 'hash mismatch|receipt schema'): repo.admit(1,(next_spec,next_paths,grant))
                refused=process(repo,1);self.assertEqual(refused.returncode,1)
                self.assertEqual(json.loads(refused.stdout)['trace'], [])
                self.assertFalse(Path(next_paths['consumption']).exists())

    def test_actual_entry_reads_python_consumption_schema_without_dispatch(self):
        root, repo = repository()
        # Fresh fixture pins for the currently edited source; no product readiness write.
        for pin in repo.ready['bindings']['bindings']:
            data=Path(pin['realpath']).read_bytes();pin['bytes']=len(data);pin['sha256']=__import__('hashlib').sha256(data).hexdigest()
        repo.ready_path.write_text(json.dumps(repo.ready))
        spec, paths, _ = repo.grant(0)
        child=process(repo,0);self.assertEqual(child.returncode,0,child.stdout+child.stderr)
        consumption=json.loads(Path(paths['consumption']).read_text())
        script=root/'entry-admission.mjs'
        script.write_text('import {admit} from '+json.dumps((HERE/'entry.mjs').as_uri())+';const c=admit();process.stdout.write(JSON.stringify({unit:c.spec.id,schema:c.consumption.schema}));')
        env={**os.environ,'VIEWMODEL_READY':str(repo.ready_path),'VIEWMODEL_CONSUMPTION':paths['consumption'],
            'VIEWMODEL_CONSUMPTION_SHA256':digest(paths['consumption']),'VIEWMODEL_ENTRY_TOKEN':consumption['entryToken'],
            'VIEWMODEL_SOURCE_HEAD':repo.head,'VIEWMODEL_UNIT':spec['id']}
        command=[repo.ready['bindings']['node'],str(script)]
        result=subprocess.run(command,env=env,capture_output=True,timeout=10)
        (root/'entry-admit.stdout').write_bytes(result.stdout);(root/'entry-admit.stderr').write_bytes(result.stderr)
        (root/'entry-admit-command.json').write_text(json.dumps({'argv':command,'exit':result.returncode},indent=2)+'\n')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),{'unit':spec['id'],'schema':boundary.CONSUMPTION_SCHEMA})
        self.assertFalse((Path(paths['evidence'])/'entry-claim').exists())

    def test_protocol_fields_keep_value_semantics_while_unknown_aliases_are_reversible(self):
        shared = {'future': b'\x00'}; cycle = {'shared': shared}; cycle['self'] = cycle
        value = {'schema':boundary.CONSUMPTION_SCHEMA,'previousOutputs':[[],[]],'unknown':cycle,'alias':shared}
        value['previousOutputs'][1] = value['previousOutputs'][0]
        document = json.loads(boundary.encoded(value))
        self.assertEqual(document['schema'], boundary.CONSUMPTION_SCHEMA)
        self.assertEqual(document['previousOutputs'], [[], []])
        observed = graph_decode(document['observations'])
        self.assertIs(observed['unknown']['self'], observed['unknown'])
        self.assertIs(observed['unknown']['shared'], observed['alias'])
        value['previousOutputs'][0].append(value['previousOutputs'])
        with self.assertRaisesRegex(ValueError, 'Circular'): boundary.encoded(value)


if __name__ == '__main__': unittest.main()
