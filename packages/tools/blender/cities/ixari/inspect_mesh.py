"""Diagnose saved LOD validity without modifying source files."""
import json
from pathlib import Path
import sys
import bpy

ROOT=Path(__file__).resolve().parents[5]
results=[]
for path in sorted((ROOT/'assets/blend/cities').glob('ixari_*.blend')):
    bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False)
    for ob in bpy.data.objects:
        if ob.type!='MESH' or 'Facets' not in ob.name:continue
        copy=ob.data.copy()
        before=[len(copy.vertices),len(copy.polygons)]
        changed=copy.validate(verbose=True)
        results.append(dict(file=path.name,object=ob.name,changed=changed,before=before,
                            after=[len(copy.vertices),len(copy.polygons)]))
        bpy.data.meshes.remove(copy)
out=ROOT/sys.argv[sys.argv.index('--')+1]
assert not out.exists()
out.write_text(json.dumps(results,indent=2)+'\n')
print('MESH VALIDITY',sum(r['changed'] for r in results),'of',len(results),'changed')
