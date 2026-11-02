"""Resume a saved character authoring session, pausing before any GPU work.

Blender -b --factory-startup --python-exit-code 1 -P this.py --
    <authoring-dir> <people> <output.blend> <textures-dir> <gpu-release-file>

The inspected authoring program creates the editable source. Exporters never call it.
The release file is explicit coordination with the worker measuring GPU performance.
"""
from pathlib import Path
import runpy
import sys
import time

import bpy

source, people, output, textures, release = sys.argv[sys.argv.index('--') + 1:]
source, output, textures, release = map(lambda p: Path(p).resolve(), (source, output, textures, release))
assert people in ('ixari', 'ulgani'), 'This resumes only the unfinished round-four sources'
assert not output.exists(), 'Keep the previous authored source; choose a fresh staging path'
output.parent.mkdir(parents=True, exist_ok=True)
sys.argv = [str(source / 'build.py'), '--', people, str(output), '--res', '4096', '--heads', '1,2,3,4,5,6', '--suits', '1,2,3,4', '--tex', str(textures)]
session = runpy.run_path(str(source / 'build.py'), run_name='character_authoring_session')
original_cycles = session['bake'].cycles


def coordinated_cycles(*args, **kwargs):
    checkpoint = output.with_name(output.stem + '_before_bake.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(checkpoint), compress=True)
    print('AUTHORING_GEOMETRY_READY', checkpoint, flush=True)
    print('WAITING_FOR_GPU_RELEASE', release, flush=True)
    while not release.exists():
        time.sleep(2)
    print('GPU_RELEASE_RECEIVED', flush=True)
    result = original_cycles(*args, **kwargs)
    scene = args[0]
    prefs = bpy.context.preferences.addons['cycles'].preferences
    print('BAKE_DEVICE', scene.cycles.device, prefs.compute_device_type, [(device.name, device.type, device.use) for device in prefs.devices], flush=True)
    return result


session['bake'].cycles = coordinated_cycles
session['main']()
for path in sorted(source.glob('*.py')) + sorted((source / 'lib').glob('*.py')):
    name = 'authoring/' + str(path.relative_to(source))
    block = bpy.data.texts.get(name) or bpy.data.texts.new(name)
    block.clear()
    block.write(path.read_text())
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
print('AUTHORING_SAVED', output, flush=True)
