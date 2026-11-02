"""Synthetic CPU artifact-decoder controls; fixture images are never visual-review inputs."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
import inspect_round4_station_output as inspector
import run_round4_remaining8 as caller


class ArtifactControls(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='station-artifact-unit-')
        self.root = Path(self.temporary.name)
        self.stage = copy.deepcopy(caller.original_stages()[0])
        self.stage['out_path'] = 'synthetic-fixture-only'
        self.out = self.root / self.stage['out_path']; self.out.mkdir()

    def tearDown(self): self.temporary.cleanup()

    def png(self, name, size=(1920, 1080)):
        Image.new('RGB', size, (33, 45, 68)).save(self.out / name)

    def standard(self):
        for name in inspector.STANDARD_NAMES - {'perf.json'}:
            self.png(name, (1920, 2876) if name == 'sheet.png' else (1920, 1080))
        report = {'file': 'stations/scrapyard', 'asset': 'sy_rock', 'variant': 'sy_rock', 'gl': 'metal',
                  'viewport': [1920,1080], 'errors': [], 'perf': [{}, {}, {}], 'class': 'building'}
        (self.out / 'perf.json').write_text(json.dumps(report))

    def test_standard_full_decode_and_honest_backend_limit(self):
        self.standard(); value = inspector.inspect(self.stage, self.root)
        self.assertTrue(value['valid']); self.assertEqual(len(value['files']), 12)
        self.assertEqual(sum('decoded_rgba_sha256' in r for r in value['files']), 11)
        self.assertTrue(value['metadata']['actual_backend'].startswith('UNKNOWN'))

    def test_standard_missing_corrupt_or_wrong_resolution_refused(self):
        self.standard()
        self.png('far_lod2.png', (960, 540))
        with self.assertRaisesRegex(AssertionError, 'Resolution'): inspector.inspect(self.stage, self.root)
        (self.out / 'far_lod2.png').write_bytes(b'not png')
        with self.assertRaises(Exception): inspector.inspect(self.stage, self.root)
        (self.out / 'far_lod2.png').unlink()
        with self.assertRaisesRegex(AssertionError, 'Missing'): inspector.inspect(self.stage, self.root)

    def test_standard_page_errors_refused(self):
        self.standard(); path = self.out / 'perf.json'; value = json.loads(path.read_text())
        value['errors'] = ['synthetic failure']; path.write_text(json.dumps(value))
        with self.assertRaises(AssertionError): inspector.inspect(self.stage, self.root)

    def supplement(self):
        self.stage = copy.deepcopy(caller.original_stages()[2]); self.stage['out_path'] = 'synthetic-fixture-only'
        shot = dict(v.split('=',1) for v in self.stage['requested_shots'][0].split(','))
        self.png(shot['name'] + '.png')
        row = {'name': shot['name'], 'shot': shot, 'spec': 'waystation_uncut_figures.glb', 'viewport': [1920,1080],
               'gl': 'metal', 'renderer': 'ANGLE Metal CPU TEST STRING', 'errors': [], 'perf': [],
               'groundBlocks': True, 'orbit': {'elevation': 0}, 'fov': 60}
        (self.out / 'shots.json').write_text(json.dumps([row])); return row

    def test_supplement_exact_requested_and_actual_recorded_without_equivalence(self):
        self.supplement(); value = inspector.inspect(self.stage, self.root)
        self.assertTrue(value['valid']); self.assertFalse(value['metadata']['requested_actual_camera_equivalence_claimed'])
        self.assertTrue(value['metadata']['ground_occlusion_is_an_evidence_limit'])

    def test_supplement_changed_request_or_perf_refused(self):
        row = self.supplement(); path = self.out / 'shots.json'
        changed = copy.deepcopy(row); changed['shot']['fov'] = '40'; path.write_text(json.dumps([changed]))
        with self.assertRaisesRegex(AssertionError, 'Requested shot'): inspector.inspect(self.stage, self.root)
        row['perf'] = [{'unexpected': True}]; path.write_text(json.dumps([row]))
        with self.assertRaisesRegex(AssertionError, 'zero perf'): inspector.inspect(self.stage, self.root)


if __name__ == '__main__': unittest.main(verbosity=2)
