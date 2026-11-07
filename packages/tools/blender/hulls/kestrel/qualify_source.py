"""Five shared source gates plus Kestrel-specific byte-bound and adverse CPU checks."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import argparse
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, rules, scene as S, materials as M, export
from asset_contract import VARIANTS, REQUIRED_MATERIALS, sha

SRC=ROOT/'assets/blend/hulls/kestrel.blend'
OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'
HP={'HP_S_1':(-1.5,-.9,-.62),'HP_S_2':(1.5,-.9,-.62),'HP_M_1':(0,2.75,-.86)}
EXACT_MARKERS=('Canopy','GearFront','GearLeft','GearRight','CockpitInterior','ScreenLeft','ScreenCenter','ScreenRight','CockpitStick','CockpitThrottle')


def canonical_marker_matrices():
    original=json.loads(Path(__file__).with_name('recovery.json').read_text())['assets'][0]
    path=Path(original['localObject']);assert path.stat().st_size==original['bytes'] and sha(path)==original['sha256']
    bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False);bpy.context.view_layer.update()
    return {name:tuple(value for row in bpy.data.objects[name].matrix_world for value in row) for name in (*EXACT_MARKERS,*HP)}


def audit(expected):
    bpy.context.view_layer.update()
    r=rules.load();model=S.collect_source(r);S.assign_classes(r,'hulls',model)
    assert len(model.assets)==1 and model.assets[0].name=='kestrel'
    asset=model.assets[0];assert set(asset.variants)==set(VARIANTS),'state/livery coverage'
    markers={o.name:o for o in asset.extras}
    for name,point in HP.items():
        assert name in markers,('missing exact hardpoint',name)
        assert (markers[name].matrix_world.translation-Vector(point)).length<1e-5,('hardpoint moved',name)
        actual=tuple(value for row in markers[name].matrix_world for value in row)
        assert max(abs(x-y) for x,y in zip(actual,expected[name]))<1e-5,('hardpoint canonical transform changed',name)
    variants={}
    for v in asset.variants.values():
        assert set(v.lods)=={0,1,2,3},('LOD coverage',v.id)
        levels={};base_maps={}
        for level,objects in sorted(v.lods.items()):
            meshes=S.render_meshes(r,objects);maps={};primitives=0;names=set()
            for o in meshes:
                used={p.material_index for p in o.data.polygons};primitives+=len(used)
                for index in used:
                    mat=o.material_slots[index].material;name=rules.material_name(mat);names.add(name)
                    if name in ('Hull','Accent','Dark','Trim','Glass'):
                        info=M.MaterialInfo(mat)
                        for ch in ('baseColor','roughness','normal','occlusion'):
                            im=info.channels[ch].image
                            assert im and list(im.size)==[4096,4096] and im.packed_file,(v.id,name,ch,'packed 4K map missing')
                            maps[(name,ch)]=im.as_pointer()
            assert REQUIRED_MATERIALS<=names,(v.id,level,names)
            assert primitives<=12,(v.id,level,'primitive count',primitives)
            if level==0:base_maps=maps
            else:assert maps==base_maps,(v.id,level,'lower LOD uses independent maps')
            levels[level]={'triangles':sum(S.tri_count(o) for o in meshes),'materialPrimitives':primitives,'meshObjects':len(meshes),'images':sorted({s.material.node_tree.nodes.get('Image Texture').image.name for o in meshes for s in o.material_slots if s.material and s.material.node_tree.nodes.get('Image Texture') and s.material.node_tree.nodes.get('Image Texture').image})}
        bounds=S.bounds(S.render_meshes(r,v.lods[0]));length=float(bounds[1][1]-bounds[0][1]);assert 13<=length<=15,(v.id,'length',length)
        for name in EXACT_MARKERS:
            found=[o for o in v.lods[0] if rules.strip(o.name)==name];assert len(found)==1,(v.id,'marker missing or duplicated',name)
            actual=tuple(value for row in found[0].matrix_world for value in row)
            assert max(abs(x-y) for x,y in zip(actual,expected[name]))<1e-5,(v.id,'canonical marker transform changed',name)
        variants[v.id]={'lods':levels,'lengthMetres':length}
    colliders=[o for o in bpy.context.scene.objects if o.type=='MESH' and rules.strip(o.name).startswith('COL_')]
    assert colliders and max(S.tri_count(o) for o in colliders)<=512
    # The shared static volumes leave a real port-side approach into the cabin.
    static=[o for o in asset.extras if o.type=='MESH' and o.name.startswith('COL_')]
    passage=[Vector((x,1.96,z)) for x in (-.95,-.8,-.65,-.5) for z in (.0,.4,.8,1.2)]
    for point in passage:
        for c in static:
            lo,hi=S.bounds([c]);assert not all(lo[i]<point[i]<hi[i] for i in range(3)),('blocked boarding sample',list(point),c.name)
    return {'variants':variants,'colliderCount':len(colliders),'largestColliderTriangles':max(S.tri_count(o) for o in colliders),'boardingClearSamples':len(passage),'boundsOfClaim':'CPU source structure, sampled static passage and fitted moving colliders. No runtime, GPU draw, whole collision-system or visual PASS.'}


def negative_checks(expected):
    results=[]
    def rejects(name,mutate,restore):
        mutate()
        try:
            try:audit(expected)
            except AssertionError as e:results.append({'case':name,'rejected':True,'reason':str(e)})
            else:raise AssertionError('negative control escaped: '+name)
        finally:restore()
    hp=bpy.data.objects['HP_S_1'];saved=hp.location.copy()
    rejects('moved-hardpoint',lambda:setattr(hp,'location',saved+Vector((.5,0,0))),lambda:setattr(hp,'location',saved))
    bpy.context.view_layer.update()
    coll=bpy.data.collections['kestrel_LOD2'];asset=bpy.data.collections['kestrel']
    rejects('missing-LOD2',lambda:asset.children.unlink(coll),lambda:asset.children.link(coll))
    normal=bpy.data.images['Kestrel_R3_LOD0_Normal_4096'];small=bpy.data.images.new('_negative_1k',1024,1024);small.pack()
    mat=bpy.data.materials['Kestrel_Hull'];node=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image==normal)
    rejects('1024-normal-regression',lambda:setattr(node,'image',small),lambda:setattr(node,'image',normal))
    bpy.data.images.remove(small)
    # Actual shared exporter failure removes only its known stale output, using a tiny invalid source.
    with tempfile.TemporaryDirectory(prefix='kestrel-invalid-source-') as td:
        td=Path(td);source=td/'assets/hulls/kestrel.blend';source.parent.mkdir(parents=True);out=td/'models/hulls/kestrel.glb';out.parent.mkdir(parents=True);out.write_bytes(b'stale')
        foreign=out.with_name('foreign.glb');foreign.write_bytes(b'untouched')
        bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(source))
        code=export.main('hulls',['--src-root',str(td/'assets'),'--out-dir',str(td/'models'),'--report-dir',str(td/'reports'),'--only','kestrel','--quiet'])
        assert code==1 and not out.exists() and foreign.read_bytes()==b'untouched'
        results.append({'case':'real-exporter-invalid-source-stale-output','rejected':True,'exitCode':code,'foreignOutputPreserved':True})
    core.load(SRC)
    return results


def main():
    before=sha(SRC);expected=canonical_marker_matrices();r=rules.load();report=core.validate_path(r,SRC,family='hulls')
    core.write_and_print(report,OUT/'source-five-gates.json',quiet=True)
    assert report.status=='PASS',report.failures()
    facts=audit(expected);negatives=negative_checks(expected);assert sha(SRC)==before
    facts['canonicalMarkerWorldMatrices']=expected
    facts.update(status='PASS',scope='CPU source contracts only',sourceSha256=before,negativeChecks=negatives)
    (OUT/'source-contracts.json').write_text(json.dumps(facts,indent=2)+'\n')
    print(json.dumps({'sourceSha256':before,'variants':len(facts['variants']),'negativeChecks':len(negatives),'status':'PASS'}))


if __name__=='__main__':main()
