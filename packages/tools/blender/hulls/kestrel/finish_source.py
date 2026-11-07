"""Preserve the membrane canopy at LOD3 and remove obsolete shader-livery metadata."""
import hashlib
import json
from pathlib import Path
import sys
import bpy

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core,rules,scene as S
SRC=ROOT/'assets/blend/hulls/kestrel.blend';OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'


def point(v):return tuple(round(float(x),5) for x in v)


def main():
    before=hashlib.sha256(SRC.read_bytes()).hexdigest();core.load(SRC)
    assert bpy.context.scene.get('kestrel_stage')=='final'
    r=rules.load();model=S.collect_source(r);fixes=[]
    for v in model.assets[0].variants.values():
        lo=next(o for o in v.lods[3] if o.name.startswith('CanopyGlass'))
        hi=next(o for o in v.lods[2] if o.name.startswith('CanopyGlass'))
        if not len(lo.data.polygons):
            lo.data=hi.data;fixes.append({'variant':v.id,'LOD3CanopyTriangles':S.tri_count(hi),'sourceLOD':2})
    for mat in bpy.data.materials:
        for key in ('livery_base','livery_multiply','livery_albedo_scale'):
            if key in mat:del mat[key]
        mat['livery_encoding']='authored baked PBR colours, no runtime colour-multiply required'
    current={point(v.co) for v in bpy.data.objects['Body'].data.vertices}
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
    after=hashlib.sha256(SRC.read_bytes()).hexdigest()
    rec=json.loads((Path(__file__).with_name('recovery.json')).read_text())['assets'][0]
    original=Path(rec['localObject']);assert original.stat().st_size==rec['bytes'] and hashlib.sha256(original.read_bytes()).hexdigest()==rec['sha256']
    bpy.ops.wm.open_mainfile(filepath=str(original),load_ui=False)
    body=bpy.data.objects['Body'];indices={i for p in body.data.polygons if body.material_slots[p.material_index].material.get('engine_name')=='Accent' for i in p.vertices}
    expected={point(body.data.vertices[i].co) for i in indices if not (abs(body.data.vertices[i].co.x)<1.1 and 1.0<body.data.vertices[i].co.y<3.4 and -.3<body.data.vertices[i].co.z<1.2)}
    missing=expected-current
    assert not missing,('original grown lattice changed outside cabin',len(missing))
    assert hashlib.sha256(SRC.read_bytes()).hexdigest()==after
    (OUT/'source-finish.json').write_text(json.dumps({'inputSha256':before,'outputSha256':after,'canopyLODRepairs':fixes,'retainedLatticeVerticesOutsideCabin':len(expected),'missingLatticeVertices':len(missing),'historicalSourceSha256':rec['sha256'],'liveryEncoding':'baked PBR maps; obsolete multiplier metadata removed'},indent=2)+'\n')


if __name__=='__main__':main()
