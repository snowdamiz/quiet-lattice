"""Render the preserved close-up/bend scripts embedded in the authored source.

Blender -b character.blend --python-exit-code 1 -P this.py --
    <portraits|bendtest> <CPU|GPU> <species> <original script arguments...>

Only device selection changes for CPU runs. Cameras, samples, lighting, morphs
and poses are taken verbatim from the source's embedded review scripts.
"""
from pathlib import Path
import runpy
import sys
import tempfile

import bpy

kind, device, *arguments = sys.argv[sys.argv.index('--') + 1:]
assert kind in ('portraits', 'bendtest')
assert device in ('CPU', 'GPU')
with tempfile.TemporaryDirectory(prefix='character-review-') as temporary:
    root = Path(temporary)
    (root / 'lib').mkdir()
    for name in (f'{kind}.py', 'lib/preview.py'):
        block = bpy.data.texts.get('authoring/' + name)
        assert block is not None, f'Missing embedded review script: {name}'
        (root / name).write_text(block.as_string())
    sys.path.insert(0, str(root))
    from lib import preview

    original_setup = preview.setup

    def setup(scene, *args, **kwargs):
        original_setup(scene, *args, **kwargs)
        scene.cycles.device = device
        if device == 'CPU':
            scene.cycles.denoising_use_gpu = False

    preview.setup = setup
    sys.argv = [str(root / f'{kind}.py'), '--', *arguments]
    print('CHARACTER_DETAIL_DEVICE', device, 'SCRIPT', kind, flush=True)
    runpy.run_path(str(root / f'{kind}.py'), run_name='__main__')
