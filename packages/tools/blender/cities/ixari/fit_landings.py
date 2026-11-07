"""Extend the saved bridge and spiral ends into usable flat approach/exit aprons."""
import hashlib
import json
from pathlib import Path
import sys

import bmesh
import bpy

ROOT=Path(__file__).resolve().parents[5]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, lods, rules as R, scene as S
TASK=ROOT/'assets/blend/cities/ixari'


def apron(mesh,collection,name,x0,x1,y0,y1,height):
    xyz=[(x0,y0,height-.18),(x1,y0,height-.18),(x1,y1,height-.18),(x0,y1,height-.18),
         (x0,y0,height),(x1,y0,height),(x1,y1,height),(x0,y1,height)]
    indices=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    bm=bmesh.new();bm.from_mesh(mesh.data);uv=bm.loops.layers.uv.active;deform=bm.verts.layers.deform.verify()
    group=mesh.vertex_groups.new(name=name)
    vs=[bm.verts.new(co) for co in xyz]
    for v in vs:v[deform][group.index]=1
    for face in indices:
        f=bm.faces.new([vs[i] for i in face])
        for loop,(u,v) in zip(f.loops,((0,0),(1,0),(1,1),(0,1))):loop[uv].uv=((3+.025+.95*u)/4,(1+.025+.95*v)/2)
    bm.to_mesh(mesh.data);bm.free();mesh.data.update()
    data=bpy.data.meshes.new('COL_'+name);data.from_pydata(xyz,[],indices);data.update()
    ob=bpy.data.objects.new('COL_'+collection.name+'_'+name,data);collection.objects.link(ob)
    ob.hide_render=True;ob.display_type='WIRE'


def main():
    rules=R.load();receipt=[]
    for group in ('kit','landmarks'):
        path=ROOT/f'assets/blend/cities/ixari_{group}.blend';core.load(path)
        bpy.context.preferences.filepaths.save_version=0
        model=S.collect_source(rules);S.assign_classes(rules,'cities',model)
        ip=TASK/'inventory'/f'{group}.json';inventory=json.loads(ip.read_text())
        for aa in model.assets:
            for v in aa.variants.values():
                if v.id not in ('bridge_ixari','kit_ixari_spiral','ixari_landmark_summit'):continue
                mesh=S.render_meshes(rules,v.lods[0])[0]
                assert not mesh.get('end_aprons_applied'),'source already edited'
                if v.id=='bridge_ixari':
                    apron(mesh,aa.holder,'SouthApproach',-2.1,2.1,-12.8,-11.8,.18)
                    apron(mesh,aa.holder,'NorthApproach',-2.1,2.1,11.8,12.8,.18)
                else:
                    radius,rise=(9,6) if v.id=='kit_ixari_spiral' else (15,48)
                    apron(mesh,aa.holder,'EntryLanding',-.8,.8,-radius-1.9,-radius+1.9,.18)
                    apron(mesh,aa.holder,'ExitLanding',-.8,.8,-radius-1.9,-radius+1.9,rise+.18)
                mesh['end_aprons_applied']=True
                for level in (1,2,3):
                    for ob in v.lods[level]:bpy.data.objects.remove(ob,do_unlink=True)
                    bpy.data.collections.remove(bpy.data.collections[f'{v.id}_LOD{level}'])
                v.lods={0:v.lods[0]};v.decl={0:v.decl[0]}
                work=bpy.data.collections.new('_ApronDerived');aa.holder.children.link(work)
                lods.generate(rules,v,work)
                for level in (1,2,3):
                    coll=bpy.data.collections.new(f'{v.id}_LOD{level}');aa.holder.children.link(coll)
                    for ob in v.lods[level]:
                        for old in list(ob.users_collection):old.objects.unlink(ob)
                        coll.objects.link(ob);ob.name=f'{v.id}_Facets_L{level}';ob.data.name=ob.name
                        ob.data.validate();assert not ob.data.validate();ob.hide_render=True
                bpy.data.collections.remove(work);S.clear_cache()
                spec=next(s for s in inventory if s['id']==v.id)
                spec['lodTriangles']=[sum(S.tri_count(o) for o in v.lods[n]) for n in range(4)]
                box=S.bounds([mesh]);spec['bounds']=[list(map(float,x)) for x in box]
                spec['authoredHeight']=float(box[1][2]-box[0][2])
                spec['colliders']=[o.name for o in aa.holder.all_objects if S.is_collider(rules,o)]
                receipt.append(dict(asset=v.id,lodTriangles=spec['lodTriangles'],aprons='full 3m approach width'))
        bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
        for spec in inventory:spec['sourceSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        ip.write_text(json.dumps(inventory,indent=2)+'\n')
    out=ROOT/sys.argv[sys.argv.index('--')+1]
    with out.open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')


if __name__=='__main__':main()
