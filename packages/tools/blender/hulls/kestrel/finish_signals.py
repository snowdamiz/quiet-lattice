"""Keep dormant husk nav below visible lighting levels while satisfying the shared signal profile."""
import hashlib,json,sys
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parents[5];sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core
src=ROOT/'assets/blend/hulls/kestrel.blend';before=hashlib.sha256(src.read_bytes()).hexdigest();core.load(src)
changed=[]
for mat in bpy.data.materials:
    if 'husked' in mat.name and mat.get('engine_name')=='NavWhite':
        bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        bs.inputs['Emission Color'].default_value=(.006,.006,.006,1);bs.inputs['Emission Strength'].default_value=.01
        mat['round3_note']='dormant nav: emitted linear RGB 0.00006, below one 8-bit linear code value; common signal profile requires a nonzero value'
        changed.append(mat.name)
assert len(changed)==3
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
(ROOT/'assets/renders/hulls/kestrel-round3-current/signal-compatibility.json').write_text(json.dumps({'inputSha256':before,'outputSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'materials':changed,'emittedLinearRGB':[.00006]*3,'reason':'the common signal profile rejects exact zero; 1e-12 rounded to zero after glTF export/import','limit':'visually dark compatibility value; not a claim of mathematically zero radiance or tested runtime lighting'},indent=2)+'\n')
