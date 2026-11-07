"""Persist the frozen shared library on a hidden reference, without changing art."""
import bpy
import hashlib
import json
from pathlib import Path
import shutil

HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]
records=[]
for family in ['creatures','constructs']:
    for path in sorted((ROOT/'assets/blend'/family).glob('*.blend')):
        bpy.ops.wm.open_mainfile(filepath=str(path))
        bpy.context.preferences.filepaths.save_version=0
        shutil.copyfile(path,HERE/'reports/history'/(path.stem+'-before-reference-link.blend'))
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        with bpy.data.libraries.load(str(ROOT/'assets/blend/_library.blend'),link=True) as (src,dst):
            candidates=[n for n in src.materials if n.startswith('LIB_')]
            assert candidates,src.materials
            chosen='LIB_Chitin' if 'LIB_Chitin' in candidates else sorted(candidates)[0]
            dst.materials=[chosen]
        bpy.data.objects['REF_Biped'].data.materials.append(dst.materials[0])
        bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(path))
        assert bpy.data.objects['REF_Biped'].data.materials[0].library is not None
        records.append(dict(path=str(path.relative_to(ROOT)),material=chosen,before=before,after=hashlib.sha256(path.read_bytes()).hexdigest()))
(HERE/'reports/reference-library.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records))
