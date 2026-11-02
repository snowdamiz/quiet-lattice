"""Render only the revised family row's standard header, using the frozen CPU studio program."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"
program = (BASE / "standard_turntable_cpu_program.py.txt").read_text()
program = program[:program.index("manifest = {'source': src, 'targets':")]
program += '''
assert len(targets) == 1
t = targets[0]
shown = lod0_of(t)
lo, hi = bounds(shown)
dims = hi - lo
text = f'{target_label(t)}    {dims.x:.1f} x {dims.y:.1f} x {dims.z:.1f} m    LOD0, from 22, 112, 202 and 292 degrees'
header(text, 1920, 48)
render_to(os.path.join(out_dir, f'{stem}_{t[0]}_family_header.png'), 1920, 48)
with open(os.path.join(out_dir, f'{stem}_{t[0]}_family_row.json'), 'w') as stream:
    json.dump({'target': list(t), 'objects': sorted(o.name for o in shown), 'size': [round(x, 2) for x in dims], 'text': text}, stream, indent=2)
print('STANDARD FAMILY HEADER', text)
'''
exec(compile(program, str(ROOT / "packages/tools/blender/turntable.py"), "exec"),
     {"__name__": "__main__", "__file__": str(ROOT / "packages/tools/blender/turntable.py")})
