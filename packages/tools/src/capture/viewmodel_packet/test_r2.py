"""R2 actual callback/caller boundaries, with inert native command ports only."""
import base64
import json
from pathlib import Path
import signal
import unittest
from unittest.mock import patch

import boundary
import caller
import native
from test_boundary import Repo
import test_revision
from test_revision import scratch


def graph_decode(graph):
    """Independent reconstruction proves shared and cyclic identities survive JSON."""
    nodes = graph['nodes']; values = [{} if n['kind'] in ('dict', 'exception', 'object') else [] for n in nodes]
    def edge(e): return e['value'] if 'value' in e else values[e['ref']]
    for i, n in enumerate(nodes):
        if n['kind'] == 'bytes': values[i] = base64.b64decode(n['base64'])
        elif n['kind'] == 'path': values[i] = edge(n['value'])
    for i, n in enumerate(nodes):
        v = values[i]
        if n['kind'] == 'dict': v.update((edge(k), edge(x)) for k, x in n['entries'])
        elif n['kind'] in ('list', 'tuple'): v.extend(edge(x) for x in n['items'])
        elif n['kind'] in ('exception', 'object'):
            v.update(type=n['type'], attributes=edge(n['attributes']))
            if 'message' in n: v['message'] = edge(n['message'])
    return edge(graph['root'])


class R2Controls(unittest.TestCase):
    def test_reversible_stable_graph_identity_bytes_keys_and_bounds(self):
        error = ValueError('primary'); shared = {'bytes': b'\x00\xff'}
        error.unknown = {1: shared, '1': shared, 'error': error}
        encoded = boundary.raw(error)
        self.assertEqual(encoded, boundary.raw(error))
        recovered = graph_decode(json.loads(json.dumps(encoded)))
        unknown = recovered['attributes']['unknown']
        self.assertIs(unknown['error'], recovered)
        self.assertIs(unknown[1], unknown['1'])
        self.assertEqual(unknown[1]['bytes'], b'\x00\xff')
        for options in ({'cap': 32}, {'max_nodes': 1}, {'max_depth': 1}):
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, 'ceiling'):
                boundary.raw(error, **options)

    def test_cyclic_actual_callback_drains_with_failed_save_and_encoder(self):
        control = test_revision.RevisionControls()
        for encoder in (False, True):
            for save in (False, True):
                with self.subTest(encoder=encoder, save=save):
                    e, trace, caught, originals = control.adapter('cyclic', save, encoder)
                    self.assertIs(caught, originals[0])
                    self.assertEqual(trace[-1], 'mandatory-inert-drain')
                    self.assertFalse(e['released'])
                    if encoder:
                        self.assertTrue(any(f['original'] is caught for f in e['unencodedFacts']))
                        self.assertIn('INJECTED_ENCODER_FAILURE', str(e['unencodedFacts'][0]['encodingError']))
                    else:
                        r = graph_decode(json.loads(json.dumps(e['callbackFailure'])))
                        attrs = r['attributes']; unknown = attrs['unknown']
                        self.assertIs(unknown['nested']['sourceError'], r)
                        self.assertIs(unknown['shared'], unknown)
                        self.assertEqual(attrs['output'], b'RAW\xff')
                        self.assertEqual(attrs['stderr'], b'ERR\xfe')
                    if save:
                        self.assertTrue(any(f.get('message') == 'POST_OBSERVER_RECEIPT_FAILURE' for f in e['secondaryFailures']))
                    self.assertTrue(any('release unproved' in str(f) for f in e['secondaryFailures']))
                    self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)

    def test_encoder_alarm_still_drains_and_retains_original_before_deadline(self):
        e, trace, caught, originals = test_revision.RevisionControls().adapter('cyclic', True, 'deadline')
        self.assertIs(caught, originals[0])
        self.assertEqual(trace[-1], 'mandatory-inert-drain')
        self.assertNotIn('observation', e)
        self.assertTrue(any(f.get('type') == 'DeadlineExpired' for f in e['secondaryFailures']))
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)

    def test_actual_caller_preserves_cyclic_primary_cleanup_and_publication_failures(self):
        actual_capture = native.capture
        for sink in ('durable', 'fallback', 'all-sinks'):
            with self.subTest(sink=sink):
                observed = []
                def via_caller(ready, spec, paths, outer):
                    root = scratch(); repo = Repo(root); unit, p, _ = repo.grant(0); failures = []
                    def capture(r, s, ps, record):
                        try: return actual_capture(ready, s, ps, record)
                        except BaseException as error: failures.append(error); raise
                    def runner(*args):
                        return caller.run_unit(*args, capture=capture, decoder=lambda *_: self.fail('decoder before release'),
                            cache_copy=lambda r, e, rec: rec.update(initialCacheBytes=0))
                    def write(path, value):
                        if Path(path).name == 'result.json' and sink != 'durable': raise OSError('PRIMARY_SINK_FAILURE')
                        if str(path).endswith(('.fallback.json', '.failure-summary.json')) and sink == 'all-sinks': raise OSError('FALLBACK_SINK_FAILURE')
                        return boundary.exclusive_json(path, value, cap=20 * boundary.MIB)
                    def emit(_): raise OSError('STDERR_SINK_FAILURE')
                    with patch.object(caller, 'HERE', repo.packet):
                        code, result = caller.main(repo.ready_path, unit['id'], Path(p['grant']), enabled=True,
                            verifier=lambda _: {}, runner=runner, writer=write, emit=emit)
                    self.assertEqual(code, 1); self.assertEqual(result['durable'], sink != 'all-sinks')
                    self.assertFalse(result['record']['released'])
                    self.assertFalse(result['record']['checksPassed'])
                    self.assertTrue(Path(p['consumption']).is_file())
                    text = boundary.encoded(result).decode()
                    for fact in ('UkFX/w==', 'RVJS/g==', 'POST_OBSERVER_RECEIPT_FAILURE', 'Capture release unproved'):
                        self.assertIn(fact, text)
                    if sink == 'all-sinks': self.assertEqual(len(result['record']['persistenceErrors']), 4)
                    else:
                        durable = Path(result['path']).read_bytes()
                        for fact in ('UkFX/w==', 'POST_OBSERVER_RECEIPT_FAILURE', 'Capture release unproved'):
                            self.assertIn(fact.encode(), durable)
                    (root / 'observed-return.json').write_bytes(boundary.encoded(result))
                    observed.append(result); outer.update(result['record']); raise failures[0]
                with patch.object(native, 'capture', via_caller):
                    evidence, trace, caught, originals = test_revision.RevisionControls().adapter('cyclic', True, allow_git=True)
                self.assertIs(caught, originals[0]); self.assertEqual(len(observed), 1)
                self.assertEqual(trace[-1], 'mandatory-inert-drain')


if __name__ == '__main__': unittest.main()
