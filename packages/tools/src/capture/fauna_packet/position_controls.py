"""Inspect real-source CPU receipts; no Pillow, image decoder or launch imports."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
HERE = Path(__file__).resolve().parent
if str(HERE) in sys.path: sys.path.remove(str(HERE))
import copy
import importlib.util
import json
import unittest

spec = importlib.util.spec_from_file_location('position_inspector', HERE / 'inspect.py')
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)
SOURCE_RESULTS = Path(sys.argv.pop(1))
ROWS = json.loads(SOURCE_RESULTS.read_text())['rows']


class PositionControls(unittest.TestCase):
    def test_actual_replay_remote_fauna_hud_and_fixture_receipts_pass(self):
        self.assertEqual([(r['width'], r['delayed']) for r in ROWS], [(1920, False), (1920, True), (2520, False), (2520, True)])
        for row in ROWS:
            with self.subTest(width=row['width'], delayed=row['delayed']):
                inspector.flyer_sample_oracle(row['sample'], [row['width'], 1080])
                if row['delayed']: self.assertGreater(row['delta'], 0.5)
        self.assertNotIn('PIL', sys.modules)

    def test_boundary_evidence_must_belong_to_the_captured_target_and_time(self):
        for change in ('time', 'target', 'target-identity', 'number-target', 'number-identity'):
            raw = copy.deepcopy(ROWS[1]['sample'])
            if change == 'time': raw['gameTime'] += 0.01
            if change == 'target': raw['target']['id'] += 1
            if change == 'target-identity': raw['target']['incarnation'] += 1
            if change == 'number-target': raw['numbers'][0]['target'] += 1
            if change == 'number-identity': raw['numbers'][0]['incarnation'] += 1
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'captured target/time'):
                inspector.flyer_sample_oracle(raw, [1920, 1080])

    def test_renderer_position_mutations_are_strictly_refused(self):
        for row in ROWS:
            for key in ('position', 'posePosition', 'world', 'bufferedPosition'):
                receipt = copy.deepcopy(row['receipt'])
                receipt['positionAudit']['calls'][10]['after'][key][0] += 1e-7
                with self.subTest(width=row['width'], delayed=row['delayed'], key=key), self.assertRaisesRegex(ValueError, 'mutated its position inputs'):
                    inspector.flyer_oracle(receipt, [row['width'], 1080])

    def test_real_authoritative_movement_is_not_reclassified_as_draw_settling(self):
        for change in ('position', 'frame', 'mode'):
            receipt = copy.deepcopy(ROWS[1]['receipt'])
            for side in ('before', 'after'):
                snapshot = receipt['positionAudit']['calls'][10][side]['authoritative']
                if change == 'position': snapshot['pos'][0] += 1e-7
                if change == 'frame': snapshot['frame'] = '7:1'
                if change == 'mode': snapshot['mode'] = 'fly'
            with self.subTest(change=change), self.assertRaises(ValueError): inspector.flyer_oracle(receipt, [1920, 1080])

    def test_incomplete_stale_or_unrelated_evidence_is_refused(self):
        for change in ('missing', 'short', 'extra', 'reorder', 'time', 'end-time', 'identity', 'sample-identity', 'same-record', 'same-frame', 'missing-after', 'nonfinite', 'fixture-start', 'fixture-end'):
            receipt = copy.deepcopy(ROWS[1]['receipt']); audit = receipt['positionAudit']; calls = audit['calls']
            if change == 'missing': del receipt['positionAudit']
            if change == 'short': calls.pop()
            if change == 'extra': calls.append(copy.deepcopy(calls[-1]))
            if change == 'reorder': calls[10], calls[11] = calls[11], calls[10]
            if change == 'time': calls[10]['time'] += 0.01; calls[10]['afterTime'] += 0.01
            if change == 'end-time': audit['gameTime'] += 0.01
            if change == 'identity': calls[10]['incarnation'] += 1
            if change == 'sample-identity': audit['incarnation'] += 1
            if change == 'same-record': calls[10]['after']['sameRecord'] = False
            if change == 'same-frame': calls[10]['after']['sameFrame'] = False
            if change == 'missing-after': del calls[10]['after']
            if change == 'nonfinite': calls[10]['before']['position'][0] = float('nan')
            if change == 'fixture-start': receipt['sourcePosition'][0] += 1e-7
            if change == 'fixture-end': receipt['sourcePositionAfter'][0] += 1e-7
            with self.subTest(change=change), self.assertRaises(ValueError): inspector.flyer_oracle(receipt, [1920, 1080])


if __name__ == '__main__': unittest.main(verbosity=2)
