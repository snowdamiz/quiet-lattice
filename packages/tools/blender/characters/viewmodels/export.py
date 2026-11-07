"""Validate saved viewmodels and export, or validate the exact existing GLBs.

Blender -b --factory-startup -t 2 --python-exit-code 1 -P .../export.py --
    [--validate-only] [thalune ixari ulgani]
No authoring, bake, LOD generation, source save, or codec fetch is permitted.
"""
from pathlib import Path
import argparse
import os
import sys
import traceback

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from artlib import bake, core, export, lods, rules
from evidence import PEOPLES, begin_attempt, fail_attempt, fingerprint, paths, publish_receipt, sha
from viewmodel_checks import validate_loaded
from export_checks import validate_export

ROOT = Path(__file__).resolve().parents[5]


def forbidden(*args, **kwargs):
    raise RuntimeError('Viewmodel export requires saved ready geometry and packed maps; author/bake separately')


def validate_pair(root, people, report_dir):
    files = paths(root, people)
    before = {key: fingerprint(path, root) for key, path in files.items()}
    source = core.validate_path(rules.load(), files['source'], family='characters')
    core.write_and_print(source, core.report_path('characters', files['source'], report_dir))
    if source.status != 'PASS':
        raise ValueError(f'{people}: source validation failed')
    validate_loaded(people, report_dir / f'{people}-rig.json')
    model = core.validate_path(rules.load(), files['export'], family='characters', source=files['source'])
    if model.status == 'PASS':
        try:
            validate_export(files['export'], people, model.assets)
            model['naming'].ok(f'fp_{people}', 'requested viewmodel scene, variant, materials, skin joints and markers match')
        except ValueError as error:
            model['naming'].fail(f'fp_{people}', f'viewmodel export contract: {error}')
    core.write_and_print(model, core.report_path('characters', files['export'], report_dir))
    if model.status != 'PASS':
        raise ValueError(f'{people}: export validation failed')
    return before


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('people', nargs='*')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    names = args.people or list(PEOPLES)
    if any(name not in PEOPLES for name in names):
        parser.error('people must be thalune, ixari or ulgani')
    os.environ['ART_KTX_JOBS'] = '1'
    bake.ensure_cycles = forbidden
    bake.bake_material = forbidden
    lods.generate = forbidden
    failed = False
    operation = 'validate-existing' if args.validate_only else 'export'
    for name in names:
        files = paths(ROOT, name)
        report_dir, history = begin_attempt(ROOT, name, operation)
        source_opened = False
        try:
            before_source = sha(files['source'])
            core.load(files['source'])
            source_opened = True
            bpy.context.scene.render.threads_mode = 'FIXED'
            bpy.context.scene.render.threads = 2
            validate_loaded(name, report_dir / f'{name}-rig.json')
            if not args.validate_only:
                options = export.parse(['--report-dir', str(report_dir)])
                if not export.export_one(rules.load(), 'characters', files['source'], files['export'], options):
                    raise ValueError(f'{name}: saved-source export failed')
            # Check the exact current destination bytes, including after export's move.
            validated = validate_pair(ROOT, name, report_dir)
            if validated['source']['sha256'] != before_source:
                raise ValueError(f'{name}: source changed during the attempt')
            publish_receipt(ROOT, name, report_dir, validated, operation)
        except Exception as error:
            failed = True
            fail_attempt(ROOT, name, report_dir, history, error, source_opened)
            traceback.print_exc()
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
