"""Saved-GLB contract controls: actual pairs and single faults with unchanged BIN."""
from pathlib import Path
import copy
import json
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path[:0] = [str(HERE), str(HERE.parents[1])]
from artlib import glb
from export_checks import validate_export
from evidence import PEOPLES, paths


class ExportContractTests(unittest.TestCase):
    def setUp(self):
        self.path = paths(ROOT, 'thalune')['export']
        self.document, self.binary = glb.read(self.path)
        self.assets = self.report('thalune')

    def report(self, people):
        path = ROOT / f'assets/renders/characters/viewmodels/validation/characters__fp_{people}.glb.json'
        return json.loads(path.read_text())['assets']

    def rejects(self, mutate, message, assets=None):
        document = copy.deepcopy(self.document)
        mutate(document)
        with tempfile.TemporaryDirectory(prefix='t03-export-contract-') as directory:
            path = Path(directory) / 'fp_thalune.glb'
            glb.write(path, document, self.binary)
            self.assertEqual(glb.read(path)[1], self.binary)
            with self.assertRaisesRegex(ValueError, message):
                validate_export(path, 'thalune', self.assets if assets is None else assets)

    def test_all_nine_actual_pairs(self):
        for people in PEOPLES:
            for exported in PEOPLES:
                with self.subTest(people=people, exported=exported):
                    if people == exported:
                        validate_export(paths(ROOT, exported)['export'], people, self.report(exported))
                    else:
                        with self.assertRaisesRegex(ValueError, 'expected asset'):
                            validate_export(paths(ROOT, exported)['export'], people, self.report(exported))

    def test_generic_report_asset_variant_class_and_lod_are_bound(self):
        for field, value in (('id', 'fp_ixari'), ('class', 'creature'), ('lods', [0, 1])):
            assets = copy.deepcopy(self.assets)
            assets[0]['variants'][0][field] = value
            with self.subTest(field=field):
                self.rejects(lambda d: None, 'expected one', assets)

    def test_scene_people(self):
        self.rejects(lambda d: d['scenes'][0]['extras'].update(viewmodel_people='ixari'), 'expected scene people')

    def test_active_root_and_variant(self):
        for name, error in (('fp_thalune', 'expected root'), ('fp_thalune_LOD0', 'expected variant node')):
            with self.subTest(node=name):
                self.rejects(lambda d: next(n for n in d['nodes'] if n['name'] == name).update(name='fp_ixari'), error)

    def test_mesh_variant(self):
        self.rejects(lambda d: next(n for n in d['nodes'] if 'mesh' in n)['extras'].update(art_variant='fp_ixari'), 'wrong mesh variant')

    def test_required_material_identity(self):
        for name in ('VM_thalune_Tool', 'Bio', 'Skin'):
            with self.subTest(material=name):
                self.rejects(lambda d: next(m for m in d['materials'] if m['name'] == name).update(name='wrong'), 'expected materials')

    def test_each_required_material_slot(self):
        for material in self.document['materials']:
            slots = ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture']
            if material['name'] != 'Skin': slots.append('emissiveTexture')
            for slot in slots:
                def remove(d):
                    m = next(m for m in d['materials'] if m['name'] == material['name'])
                    (m['pbrMetallicRoughness'] if slot in ('baseColorTexture', 'metallicRoughnessTexture') else m).pop(slot)
                with self.subTest(material=material['name'], slot=slot):
                    self.rejects(remove, 'missing ' + slot)

    def test_markers_and_joints_must_be_reachable_and_attached(self):
        for name in ('Muzzle', 'Grip_R', 'Grip_L', 'vm_hand_R', 'vm_hand_L', 'vm_index_02_R'):
            for detached in (False, True):
                def remove(d):
                    index = next(i for i, n in enumerate(d['nodes']) if n['name'] == name)
                    parent = next(n for n in d['nodes'] if index in n.get('children', []))
                    parent['children'].remove(index)
                    if detached: d['nodes'][d['scenes'][0]['nodes'][0]]['children'].append(index)
                with self.subTest(node=name, detached=detached):
                    self.rejects(remove, 'missing viewmodel joints|expected .* attached')

    def test_skin_membership_and_weight_attributes(self):
        self.rejects(lambda d: d['skins'][0]['joints'].pop(), 'wrong viewmodel skin')
        self.rejects(lambda d: d['meshes'][0]['primitives'][0]['attributes'].pop('WEIGHTS_0'), 'missing skin attributes')


if __name__ == '__main__':
    unittest.main(verbosity=2)
