"""Make the frozen reference-library link portable across app worktrees."""
import bpy
import hashlib
import json
from pathlib import Path
import shutil

HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]
records=[]
for family in ['creatures','constructs']:
    for path in sorted((ROOT/'assets/blend'/family).glob('*.blend')):
        bpy.ops.wm.open_mainfile(filepath=str(path)); bpy.context.preferences.filepaths.save_version=0
        shutil.copyfile(path,HERE/'reports/history'/(path.stem+'-before-relative-path.blend'))
        previous=[lib.filepath for lib in bpy.data.libraries]
        for lib in bpy.data.libraries:
            assert Path(lib.filepath).name=='_library.blend'
            lib.filepath='//../_library.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True,relative_remap=False)
        bpy.ops.wm.open_mainfile(filepath=str(path))
        assert all(lib.filepath=='//../_library.blend' for lib in bpy.data.libraries)
        records.append(dict(path=str(path.relative_to(ROOT)),before=previous,after=[lib.filepath for lib in bpy.data.libraries],sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
(HERE/'reports/portable-paths.json').write_text(json.dumps(records,indent=2)+'\n')
print('Reopened',len(records),'sources with portable shared-library links')
