"""Deferred real-boundary fixture: saved/reopened source -> stock export.

Run ONLY after parent assigns the Blender lane. Outputs go to a new scratch
folder; no project assets or budgets change. Existing flora class + Glass profile
keep this geometry regression small, with no bake or texture codec required.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import bpy
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from artlib import checks, core, exact_masks, export, glb, rules
from artlib.report import Report


def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def obj(name, verts, faces, collection, edges=()):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, edges, faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


def rgba(i):
    r = np.float32(.1234567 + (i % 7) * .0212345)
    g = np.float32(.2345678 + (i % 5) * .0123456)
    return [r, g, np.float32(1 - r - g), np.float32(.31415927 + (i % 9) * .0512345)]


def build(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    refs = coll('REF')
    obj('REF_Grid', [(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], refs, [(0, 1), (0, 2)])
    obj('REF_Biped', [(0, 0, 0), (.5, 0, 0), (0, 0, 1.85)], [(0, 1, 2)], refs)
    root = coll('fixture')
    root['asset_class'] = 'flora'
    for domain in ('POINT', 'CORNER'):
        variant = 'fixture_' + domain.lower()
        vc = coll(variant, root)
        mats = []
        for name in ('Glass_A', 'Glass_B'):
            mat = bpy.data.materials.new(name)
            mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .375
            mats.append(mat)
        for lod, cells in enumerate((80, 32, 8, 2)):
            lc = coll(f'{variant}_LOD{lod}', vc)
            cols = min(cells, 8)
            rows = cells // cols
            verts = [(x / 8, y / 10, 0) for y in range(rows + 1) for x in range(cols + 1)]
            faces = []
            for y in range(rows):
                for x in range(cols):
                    a = y * (cols + 1) + x
                    b, c, d = a + 1, a + cols + 2, a + cols + 1
                    faces.extend([(a, b, c), (a, c, d)])
            ob = obj(f'{variant}_surface{lod}', verts, faces, lc)
            ob.location = (.125, .25, .5)
            me = ob.data
            for m in mats:
                me.materials.append(m)
            uv = me.uv_layers.new(name='UVMap')
            for face in me.polygons:
                face.material_index = face.index % 2
                for loop in face.loop_indices:
                    co = me.vertices[me.loops[loop].vertex_index].co
                    uv.data[loop].uv = (co.x + (face.index % 2) * .125, co.y)
            ca = me.color_attributes.new('Mask', 'FLOAT_COLOR', domain)
            ca.data.foreach_set('color', np.array([rgba(i) for i in range(len(ca.data))], np.float32).ravel())
            me.color_attributes.active_color = ca
            me.color_attributes.render_color_index = 0
            for name, typ, field, values in (
                ('_limb', 'FLOAT', 'value', [i % 5 for i in range(len(verts))]),
                ('_pivot', 'FLOAT_VECTOR', 'vector', [[.1234567, .2345678, .3456789] for _ in verts]),
                ('_glow', 'FLOAT', 'value', [.1123456 + (i % 3) * .1 for i in range(len(verts))]),
            ):
                me.attributes.new(name, typ, 'POINT').data.foreach_set(field, np.array(values, np.float32).ravel())
        marker = bpy.data.objects.new('Interact_' + domain.lower(), None)
        vc.objects.link(marker)
        marker.location = (.25, .5, .75)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def source_manifest():
    out = {}
    for ob in bpy.data.objects:
        if '_surface' not in ob.name:
            continue
        me = ob.data
        ca = me.color_attributes.active_color
        triangles = {}
        for face in me.polygons:
            corners = []
            for li in face.loop_indices:
                vi = me.loops[li].vertex_index
                co = me.vertices[vi].co
                uv = me.uv_layers.active.data[li].uv
                mask = ca.data[vi if ca.domain == 'POINT' else li].color
                corners.append({
                    'position': [co.x, co.z, -co.y], 'normal': [0, 1, 0],
                    'uv': [uv.x, float(np.float32(1) - np.float32(uv.y))],
                    '_limb': [me.attributes['_limb'].data[vi].value],
                    '_pivot': list(me.attributes['_pivot'].data[vi].vector),
                    '_glow': [me.attributes['_glow'].data[vi].value], 'color': list(mask),
                })
            triangles.setdefault(rules.material_name(me.materials[face.material_index]), []).append(corners)
        out[ob.name] = {'triangles': triangles, 'translation': [ob.location.x, ob.location.z, -ob.location.y]}
    return out


def export_fixture(directory):
    directory.mkdir(parents=True, exist_ok=False)
    src = directory / 'fixture.blend'
    build(src)
    source_hash = hashlib.sha256(src.read_bytes()).hexdigest()
    core.load(src)  # Assertions derive from saved Float32 values, not the builder's Python literals.
    manifest = source_manifest()
    (directory / 'source.json').write_text(json.dumps(manifest, indent=2) + '\n')
    config = rules.load()
    report = core.validate_path(config, src, family='creatures')
    assert report.status == 'PASS', report.failures()
    roots = export._build_nodes(config, report.model)
    raw = directory / 'stock-red.glb'
    export._write(roots, raw)  # Unadapted installed writer, retained before corrected exports.
    assert exact_masks.format_problems(config, 'creatures', raw), 'baseline unexpectedly exact; inspect backend drift'
    for family in ('creatures', 'flora', 'props'):
        args = SimpleNamespace(bake_res=None, report_dir=str(directory / 'reports' / family), verbose=True, quiet=False, compress=False)
        output = directory / f'{family}-raw.glb'
        assert export.export_one(config, family, src, output, args), family
    js, binary = glb.read(directory / 'creatures-raw.glb')
    cases = ({'componentType': 5123, 'normalized': True}, {'componentType': 5121, 'normalized': True},
             {'componentType': 5123}, {'normalized': True}, {'type': 'VEC3'})
    for i, change in enumerate(cases):
        altered = json.loads(json.dumps(js))
        index = next(p['attributes']['COLOR_0'] for m in altered['meshes'] for p in m['primitives'])
        altered['accessors'][index].update(change)
        bad = directory / f'format-negative-{i}.glb'
        glb.write(bad, altered, binary)
        for family in ('creatures', 'flora'):
            report = Report(str(bad), family, 'export')
            checks.geometry(config, family, None, report, bad, False)
            assert any('COLOR_0 must be FLOAT' in f['message'] for f in report.failures()), change
    assert hashlib.sha256(src.read_bytes()).hexdigest() == source_hash
    (directory / 'export-result.json').write_text(json.dumps({'source_sha256': source_hash, 'objects': len(manifest), 'negative_formats': len(cases)}, indent=2) + '\n')


def validate_compressed(directory):
    config = rules.load()
    for family in ('creatures', 'flora', 'props'):
        report = core.validate_path(config, directory / f'{family}-compressed.glb', family=family, source=directory / 'fixture.blend')
        core.write_and_print(report, directory / f'{family}-compressed-validation.json')
        assert report.status == 'PASS', report.failures()
    expected = json.loads((directory / 'export-result.json').read_text())['source_sha256']
    assert hashlib.sha256((directory / 'fixture.blend').read_bytes()).hexdigest() == expected


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('phase', choices=('export', 'validate'))
    p.add_argument('directory', type=Path)
    args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
    (export_fixture if args.phase == 'export' else validate_compressed)(args.directory)


if __name__ == '__main__':
    main()
