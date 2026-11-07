"""Validate and export SAVED viewmodels, never author geometry or bake materials.

Blender -b --factory-startup -t 2 --python-exit-code 1 -P .../export.py -- [people]
KTX must point at an already installed local KTX binary. ART_KTX_JOBS=1.
"""
from pathlib import Path
import hashlib
import os
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from artlib import bake, export, lods, rules
from viewmodel_checks import validate_loaded

ROOT = Path(__file__).resolve().parents[5]

def forbidden(*args, **kwargs):
    raise RuntimeError('Viewmodel export requires saved ready geometry and packed maps; author/bake separately')

def main():
    names = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['thalune', 'ixari', 'ulgani']
    assert names and all(n in ('thalune', 'ixari', 'ulgani') for n in names)
    os.environ['ART_KTX_JOBS'] = '1'
    bake.ensure_cycles = forbidden
    bake.bake_material = forbidden
    lods.generate = forbidden
    report_dir = ROOT / 'assets/renders/characters/viewmodels/validation'
    args = export.parse(['--report-dir', str(report_dir)])
    for name in names:
        source = ROOT / f'assets/blend/characters/viewmodels/fp_{name}.blend'
        destination = ROOT / f'packages/client/public/models/characters/viewmodels/fp_{name}.glb'
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        bpy.ops.wm.open_mainfile(filepath=str(source))
        bpy.context.scene.render.threads_mode = 'FIXED'
        bpy.context.scene.render.threads = 2
        validate_loaded(name, report_dir / f'{name}-rig.json')
        assert export.export_one(rules.load(), 'characters', source, destination, args)
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    return 0

if __name__ == '__main__':
    sys.exit(main())
