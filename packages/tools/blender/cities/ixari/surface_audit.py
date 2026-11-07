"""Read saved/exported surfaces and reject decorative use of network glyph light."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

ROOT=Path(__file__).resolve().parents[5]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
sys.path.insert(0,str(Path(__file__).parent))
from artlib import core, rules as R, scene as S
from revise_surfaces import groups, mesh_signature, members, OLD

TASK=ROOT/'assets/blend/cities/ixari'


def surface_contract(variant,rules):
    errors=[];levels=[]
    for level,objects in sorted(variant.lods.items()):
        count=0;area=0
        for ob in S.render_meshes(rules,objects):
            uv=ob.data.uv_layers.active.data
            for face in ob.data.polygons:
                point=sum((uv[i].uv for i in face.loop_indices),start=uv[face.loop_indices[0]].uv*0)/len(face.loop_indices)
                if int(point.x*4)==2 and int(point.y*2)==1:
                    count+=1;area+=face.area
        if count:errors.append(f'LOD{level}: {count} visible faces use reserved atlas cell')
        levels.append(dict(lod=level,reservedCellFaces=count,reservedCellArea=area))
    for ob in variant.all_objects():
        if ob.name.startswith('Light_') and ob.get('color','').upper() in ('#D8F6FF','#7FD8FF'):
            errors.append('exclusive network light on decorative surface')
    return dict(asset=variant.id,errors=errors,levels=levels)


def main():
    out=ROOT/sys.argv[sys.argv.index('--')+1];assert not out.exists()
    rules=R.load();results=[];negatives=[]
    edit_records=json.loads((TASK/'receipts/revise-r1-surfaces/edits.json').read_text())
    for mode in ('source','export'):
        for family in ('anchor','props'):
            path=ROOT/(f'assets/blend/cities/ixari_{family}.blend' if mode=='source' else f'packages/client/public/models/cities/ixari_{family}.glb')
            core.load(path);model=S.collect_source(rules) if mode=='source' else S.collect_export(rules)
            variants={v.id:v for a in model.assets for v in a.variants.values()}
            record=dict(path=str(path.relative_to(ROOT)),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),variants=[])
            for variant in variants.values():
                check=surface_contract(variant,rules);assert not check['errors'],check
                record['variants'].append(check)
            if mode=='source':
                edit=next(e for e in edit_records if e['source']==str(path.relative_to(ROOT)))
                for name,digest in edit['preservedMeshHashes'].items():assert mesh_signature(bpy.data.objects[name])==digest
                for asset in edit['assets']:
                    ob=S.render_meshes(rules,variants[asset['asset']].lods[0])[0]
                    actual=groups(ob)
                    assert all(actual[k]==v for k,v in asset['preservedArchitectureGroups'].items())
                    assert not any(g.name.startswith(OLD) for g in ob.vertex_groups)
                    growths={g.name:len(members(ob,g.name)) for g in ob.vertex_groups if g.name.startswith(('FaultColony','PressureFacet'))}
                    assert growths and all(n>=24 for k,n in growths.items() if not k.endswith('Socket'))
                    asset_check=next(a for a in record['variants'] if a['asset']==asset['asset'])
                    asset_check['nativeEditableGrowthVertexCounts']=growths
                    asset_check['architectureGroupsUnchanged']=len(asset['preservedArchitectureGroups'])
                for image in bpy.data.images:
                    if not image.name.startswith('Ixari_Atlas_'):continue
                    w,h=image.size;pixels=np.empty(w*h*4,dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(h,w,4)
                    assert np.array_equal(pixels[h//2:,w//2:3*w//4],pixels[:h//2,3*w//4:]),image.name
                variant=next(iter(variants.values()));ob=S.render_meshes(rules,variant.lods[0])[0]
                face=ob.data.polygons[0];uv=ob.data.uv_layers.active.data
                original=[uv[i].uv.copy() for i in face.loop_indices]
                for i in face.loop_indices:uv[i].uv=(.62,.75)
                rejected=surface_contract(variant,rules)['errors'];assert rejected
                for i,value in zip(face.loop_indices,original):uv[i].uv=value
                negatives.append(dict(case=family+' actual face assigned reserved cell',status='REJECTED',errors=rejected))
                light=next(o for o in variant.all_objects() if o.name.startswith('Light_'))
                color=light['color'];light['color']='#D8F6FF'
                rejected=surface_contract(variant,rules)['errors'];assert rejected
                light['color']=color
                negatives.append(dict(case=family+' exclusive network light marker',status='REJECTED',errors=rejected))
            results.append(record)
    report=dict(status='PASS',claim='CPU saved-source and decoded-export surface evidence; not GPU visual PASS',
                canonicalGlyphApplication='E10.T08 pending; no network alphabet claimed by these decorative surfaces',
                files=results,negativeControls=negatives)
    out.write_text(json.dumps(report,indent=2)+'\n')
    print('PASS: source and decoded export use no reserved cell or network light; architecture and COL unchanged; four negatives rejected')


if __name__=='__main__':main()
