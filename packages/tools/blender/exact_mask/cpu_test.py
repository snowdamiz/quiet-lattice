"""Bounded packing/format tests. No Blender runtime, codecs, assets or downloads."""
import argparse
import copy
import sys
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend_cpu import load_backend
from artlib import exact_masks, glb, rules

parser = argparse.ArgumentParser()
parser.add_argument('--backend', type=Path, required=True)
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()
backend = load_backend(args.backend)
SETTINGS = {'gltf_user_extensions': [], 'gltf_meshopt_compression': False}
RGBA = np.array([[.1234567, .2345678, .6419755, .31415927], [.4567891, .1111111, .4320998, .8765432]], dtype=np.float32)


def primitive(values=RGBA):
    return {'attributes': {'COLOR_0': {'data': values.copy(), 'component_type': 5123, 'data_type': 'VEC4'}}}


def preserve():
    return nullcontext() if args.baseline else exact_masks.preserve(True)


class Packing(unittest.TestCase):
    def test_exact_float_rgba(self):
        with preserve():
            out = backend.gather_primitive_attributes(primitive(), SETTINGS)['COLOR_0']
        self.assertEqual(out.component_type, 5126)
        self.assertFalse(out.normalized)
        self.assertEqual(out.type, 'VEC4')
        self.assertEqual(out.buffer_view.data, RGBA.tobytes())

    def test_ordinary_export_remains_uint16(self):
        with exact_masks.preserve(False):
            out = backend.gather_primitive_attributes(primitive(), SETTINGS)['COLOR_0']
        self.assertEqual(out.component_type, 5123)
        self.assertTrue(out.normalized)
        rounded = np.frombuffer(out.buffer_view.data, dtype=np.uint16).astype(np.float32) / 65535
        self.assertFalse(np.array_equal(rounded, RGBA.flatten()))

    def test_original_descriptors_and_arrays_unchanged(self):
        p = primitive()
        with preserve():
            for _ in range(2):
                out = backend.gather_primitive_attributes(p, SETTINGS)['COLOR_0']
                self.assertEqual(out.buffer_view.data, RGBA.tobytes())
        self.assertEqual(p['attributes']['COLOR_0']['component_type'], 5123)
        np.testing.assert_array_equal(p['attributes']['COLOR_0']['data'], RGBA)

    def test_other_attributes_unchanged(self):
        p = primitive()
        for name, data, kind in [('_LIMB', [[1], [4]], 'SCALAR'), ('_PIVOT', [[.1, .2, .3], [.4, .5, .6]], 'VEC3'),
                                 ('_GLOW', [[.13], [.79]], 'SCALAR'), ('POSITION', [[0, 1, 2], [3, 4, 5]], 'VEC3'),
                                 ('NORMAL', [[0, 1, 0], [1, 0, 0]], 'VEC3')]:
            p['attributes'][name] = {'data': np.array(data, dtype=np.float32), 'component_type': 5126, 'data_type': kind}
        p['attributes']['COLOR_1'] = copy.deepcopy(p['attributes']['COLOR_0'])
        before = backend.gather_primitive_attributes(copy.deepcopy(p), SETTINGS)
        with preserve():
            after = backend.gather_primitive_attributes(p, SETTINGS)
        self.assertEqual(set(before), set(after))
        for name in set(before) - {'COLOR_0'}:
            for field in ('component_type', 'type', 'normalized', 'count', 'max', 'min'):
                self.assertEqual(getattr(before[name], field), getattr(after[name], field))
            self.assertEqual(before[name].buffer_view.data, after[name].buffer_view.data)

    def test_restore_on_success_exception_and_nested_scope(self):
        original = backend.gather_primitive_attributes
        with self.assertRaisesRegex(ValueError, 'injected export failure'):
            with preserve():
                outer = backend.gather_primitive_attributes
                with preserve():
                    self.assertEqual(backend.gather_primitive_attributes(primitive(), SETTINGS)['COLOR_0'].component_type, 5126)
                self.assertIs(backend.gather_primitive_attributes, outer)
                raise ValueError('injected export failure')
        self.assertIs(backend.gather_primitive_attributes, original)
        self.assertEqual(backend.gather_primitive_attributes(primitive(), SETTINGS)['COLOR_0'].component_type, 5123)

    def test_reject_already_integer_wrong_shape_and_type(self):
        original = backend.gather_primitive_attributes
        for change in ({'data': RGBA.astype(np.uint16)}, {'data': RGBA.astype(np.float64)}, {'data_type': 'VEC3'},
                       {'component_type': 5121}, {'normalized': True}, {'data': RGBA[:, :3]}, {'data': RGBA.flatten()}):
            with self.subTest(change=tuple(change)):
                p = primitive()
                p['attributes']['COLOR_0'].update(change)
                with self.assertRaisesRegex(RuntimeError, 'unpacked Float32 RGBA'), preserve():
                    backend.gather_primitive_attributes(p, SETTINGS)
                self.assertIs(backend.gather_primitive_attributes, original)

    def test_missing_mask_does_not_change_collider(self):
        with preserve():
            self.assertEqual(backend.gather_primitive_attributes({'attributes': {}}, SETTINGS), {})

    def test_restore_when_real_packer_extension_raises(self):
        class BrokenExtension:
            is_critical = True
            def gather_attribute_change(self, *args):
                raise ValueError('injected hook failure')
        class Log:
            def error(self, *args, **kwargs):
                pass
        original = backend.gather_primitive_attributes
        with self.assertRaisesRegex(RuntimeError, 'critical extension failure'), preserve():
            backend.gather_primitive_attributes(primitive(), dict(SETTINGS, gltf_user_extensions=[BrokenExtension()], log=Log()))
        self.assertIs(backend.gather_primitive_attributes, original)


class Formats(unittest.TestCase):
    def setUp(self):
        self.rules = rules.load()
        self.tmp = tempfile.TemporaryDirectory(prefix='exact-mask-cpu-')
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'control.glb'
        self.js = {'asset': {'version': '2.0'}, 'nodes': [{'name': 'body_LOD0', 'mesh': 0}],
                   'meshes': [{'primitives': [{'attributes': {'COLOR_0': 0}}]}],
                   'accessors': [{'componentType': 5126, 'type': 'VEC4', 'count': 2}]}

    def problems(self, family='creatures'):
        glb.write(self.path, self.js)
        return exact_masks.format_problems(self.rules, family, self.path)

    def test_family_scope(self):
        self.assertEqual([f for f in self.rules['families'] if exact_masks.required(self.rules, f)], ['creatures', 'flora'])
        self.js['accessors'][0].update(componentType=5123, normalized=True)
        for family in self.rules['families']:
            self.assertEqual(bool(self.problems(family)), family in ('creatures', 'flora'))

    def test_float_rgba_and_explicit_false(self):
        self.assertEqual(self.problems(), [])
        self.js['accessors'][0]['normalized'] = False
        self.assertEqual(self.problems('flora'), [])

    def test_incompatible_formats(self):
        for change in ({'componentType': 5123, 'normalized': True}, {'componentType': 5121, 'normalized': True},
                       {'componentType': 5123}, {'normalized': True}, {'type': 'VEC3'}, {'type': 'SCALAR'}):
            with self.subTest(change=change):
                self.js['accessors'][0] = dict(componentType=5126, type='VEC4', count=2)
                self.js['accessors'][0].update(change)
                self.assertEqual(len(self.problems()), 1)

    def test_missing_and_invalid_accessor(self):
        for index in (None, -1, 99, True):
            self.js['meshes'][0]['primitives'][0]['attributes'] = {} if index is None else {'COLOR_0': index}
            self.assertIn('missing COLOR_0', self.problems()[0][1])

    def test_all_primitives_lods_and_materials(self):
        self.js['nodes'] += [{'name': f'body_LOD{i}', 'mesh': 0} for i in range(1, 4)]
        self.js['meshes'][0]['primitives'].append({'attributes': {}, 'material': 1})
        self.assertEqual([p[0] for p in self.problems()], [f'body_LOD{i}/primitive1' for i in range(4)])

    def test_only_collider_node_is_excluded_even_for_shared_mesh(self):
        self.js['nodes'].append({'name': 'COL_body.001', 'mesh': 0})
        self.js['accessors'][0]['type'] = 'VEC3'
        self.assertEqual(len(self.problems()), 1)
        self.js['nodes'].pop(0)
        self.assertEqual(self.problems(), [])

    def test_compression_opt_out_does_not_waive_format(self):
        self.rules['families']['creatures']['geometry']['compress'] = False
        self.js['accessors'][0]['type'] = 'VEC3'
        self.assertEqual(len(self.problems()), 1)


if __name__ == '__main__':
    if args.baseline:
        suite = unittest.TestSuite([Packing('test_exact_float_rgba')])
        sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
    unittest.main(argv=[sys.argv[0]], verbosity=2)
