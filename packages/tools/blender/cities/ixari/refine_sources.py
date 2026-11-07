"""Saved-source edit session: audited passage fixes, fitted crystal colliders and clean LODs.

No author import. Edits the existing .blend meshes and regenerates only derived LODs.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[5]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, lods, rules as R, scene as S
TASK=ROOT/'assets/blend/cities/ixari'


def members(ob,name):
    group=ob.vertex_groups.get(name)
    return {v.index for v in ob.data.vertices if group and any(g.group==group.index for g in v.groups)}


def remove_islands(ob,names):
    ids=set().union(*(members(ob,n) for n in names))
    bm=bmesh.new();bm.from_mesh(ob.data);bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=[bm.verts[i] for i in ids],context='VERTS')
    bm.to_mesh(ob.data);bm.free();ob.data.update()


def main():
    rules=R.load();log=[]
    for ip in sorted((TASK/'inventory').glob('*.json')):
        inventory=json.loads(ip.read_text());path=ROOT/inventory[0]['source'];before=hashlib.sha256(path.read_bytes()).hexdigest()
        core.load(path);bpy.context.preferences.filepaths.save_version=0
        model=S.collect_source(rules);S.assign_classes(rules,'cities',model)
        for aa in model.assets:
            for v in aa.variants.values():
                mesh=S.render_meshes(rules,v.lods[0])[0]
                if v.id=='gate_ixari' and not mesh.get('gate_clearance_applied'):
                    for side,index in ((-1,0),(1,2)):
                        for group in mesh.vertex_groups:
                            if group.name.startswith(f'GateSpire{index}'):
                                for i in members(mesh,group.name):mesh.data.vertices[i].co.x+=side*.25
                        for ob in v.all_objects():
                            if ob.type=='MESH' and ob.name.startswith(f'COL_{v.id}_GateSpire{index}'):
                                for vert in ob.data.vertices:vert.co.x+=side*.25
                    mesh['gate_clearance_applied']=True
                if v.id=='anchor_quavel' and not mesh.get('cleft_blades_applied'):
                    blades=((-1.8,0,2.1,2.4,49,-4.4,-1), (1.4,.7,1.8,2,43,4.8,.5),
                            (.1,2.4,1.7,1.5,52,.4,2.8),(-3.2,2.1,1,1.3,33,-2.7,.7),
                            (3,2.2,1.2,1.2,37,2.8,2.2))
                    # Six broad faces with unequal bevels; local fault beds replace uniform barrel ridges.
                    hexagon=[(1,0),(.52,1),(-.62,.88),(-1,-.12),(-.48,-1),(.65,-.82)]
                    cross=[]
                    for j,q in enumerate(hexagon):
                        prev=hexagon[j-1];nxt=hexagon[(j+1)%6]
                        cross.extend([(q[0]*.9+prev[0]*.1,q[1]*.9+prev[1]*.1),
                                      (q[0]*.92+nxt[0]*.08,q[1]*.92+nxt[1]*.08)])
                    for j,(x,y,rx,ry,h,lx,ly) in enumerate(blades):
                        ids=sorted(members(mesh,f'AnchorBlade{j}'))
                        for index,i in enumerate(ids):
                            vert=mesh.data.vertices[i];t=vert.co.z/h
                            fault=sum(math.exp(-((t-a)/.014)**2)*b for a,b in ((.19,.035),(.43,-.04),(.68,.025),(.86,-.03)))
                            taper=1-.40*t+fault
                            xx,yy=cross[index%12]
                            vert.co.x=x+xx*rx*taper+lx*t
                            vert.co.y=y+yy*ry*taper+ly*t
                        for group in mesh.vertex_groups:
                            if group.name.startswith((f'GlyphStem{j}_',f'GlyphFork{j}_')):
                                for i in members(mesh,group.name):
                                    vert=mesh.data.vertices[i];t=min(vert.co.z/h,.97)
                                    vert.co.x+=lx*t
                                    vert.co.y=y-ry*(1-.40*t)+ly*t-.025
                                    vert.co.z=min(vert.co.z,h-.6)
                        collider=bpy.data.objects[f'COL_{v.id}_AnchorBlade{j}']
                        rings=(0,24,26,54,57,87,90,111,114,130)
                        cv=[mesh.data.vertices[ids[k*12+n]].co.copy() for k in rings for n in range(12)]
                        cf=[tuple(reversed(range(12))),tuple(range((len(rings)-1)*12,len(rings)*12))]
                        cf += [(k*12+n,k*12+(n+1)%12,(k+1)*12+(n+1)%12,(k+1)*12+n) for k in range(len(rings)-1) for n in range(12)]
                        data=bpy.data.meshes.new(collider.name+'_Cleft');data.from_pydata(cv,[],cf);data.update();collider.data=data
                    mesh['cleft_blades_applied']=True
                if v.id.startswith('ixari_low_') and not mesh.get('front_cut_applied'):
                    # Carve the first low hall's two front shaft cheeks back by 0.45m.
                    for side,index in ((1,2),(-1,22)):
                        for group in mesh.vertex_groups:
                            if group.name==f'ShaftBed{index}' or group.name.startswith(f'ShaftFacet{index}_'):
                                for i in members(mesh,group.name):mesh.data.vertices[i].co.x+=side*.65
                        collider=bpy.data.objects[f'COL_{v.id}_ShaftBed{index}']
                        for vert in collider.data.vertices:vert.co.x+=side*.65
                    mesh['front_cut_applied']=True
                if v.id=='ixari_landmark_summit' and not mesh.get('summit_exit_applied'):
                    # A ramp-shaped landing follows the last turn instead of presenting a 0.38m riser.
                    for i in members(mesh,'SummitLanding'):
                        vert=mesh.data.vertices[i]
                        if vert.co.z>48:
                            vert.co.z+=min(vert.co.x,0)*.128
                    collider=bpy.data.objects['COL_'+v.id+'_SummitLanding']
                    for vert in collider.data.vertices:
                        if vert.co.z>48:vert.co.z+=min(vert.co.x,0)*.128
                    # Open the inner rail at the radial exit to the plaza.
                    remove_islands(mesh, ['SpiralRail0_254','SpiralRail0_255'])
                    for name in ('SpiralRail0_254','SpiralRail0_255'):
                        aa.extras=[o for o in aa.extras if o.name!='COL_'+v.id+'_'+name]
                        v.extras=[o for o in v.extras if o.name!='COL_'+v.id+'_'+name]
                        bpy.data.objects.remove(bpy.data.objects['COL_'+v.id+'_'+name],do_unlink=True)
                    spec=next(s for s in inventory if s['id']==v.id)
                    spec['walkRoutes'].append(dict(points=[[0,-15,48.18],[0,-9,48.18]],width=3,height=3.2,kind='summit_exit'))
                    mesh['summit_exit_applied']=True
                # Growth colliders now follow the actual stepped mesh instead of a convex end-to-end chord.
                for collider in list(v.all_objects()):
                    if not S.is_collider(rules,collider) or 'Growth' not in collider.name:continue
                    name=collider.name.removeprefix('COL_'+v.id+'_')
                    ids=members(mesh,name)
                    if not ids:raise RuntimeError('Collider has no source island: '+collider.name)
                    ids=sorted(ids);index={old:new for new,old in enumerate(ids)}
                    faces=[tuple(index[i] for i in p.vertices) for p in mesh.data.polygons if all(i in index for i in p.vertices)]
                    data=bpy.data.meshes.new(collider.name+'_Fitted')
                    data.from_pydata([mesh.data.vertices[i].co for i in ids],[],faces);data.update()
                    collider.data=data
                # Rebuild only derivative levels from the now edited LOD0.
                for level in (1,2,3):
                    for ob in v.lods[level]:bpy.data.objects.remove(ob,do_unlink=True)
                    bpy.data.collections.remove(bpy.data.collections[f'{v.id}_LOD{level}'])
                v.lods={0:v.lods[0]};v.decl={0:v.decl[0]}
                work=bpy.data.collections.new('_Derived');aa.holder.children.link(work)
                lods.generate(rules,v,work)
                cleanup=[]
                for level in range(1,4):
                    coll=bpy.data.collections.new(f'{v.id}_LOD{level}');aa.holder.children.link(coll)
                    for ob in v.lods[level]:
                        for old in list(ob.users_collection):old.objects.unlink(ob)
                        coll.objects.link(ob);ob.name=f'{v.id}_Facets_L{level}';ob.data.name=ob.name
                        old_count=len(ob.data.polygons)
                        changed=ob.data.validate()
                        assert not ob.data.validate(), 'Mesh is still invalid after cleanup'
                        cleanup.append(dict(level=level,removedDuplicateFaces=old_count-len(ob.data.polygons),changed=changed))
                        ob.hide_render=True
                bpy.data.collections.remove(work)
                S.clear_cache();spec=next(s for s in inventory if s['id']==v.id)
                spec['lodTriangles']=[sum(S.tri_count(o) for o in v.lods[n]) for n in range(4)]
                box=S.bounds([mesh]);spec['bounds']=[list(map(float,x)) for x in box]
                spec['authoredHeight']=float(box[1][2]-box[0][2])
                spec['footprintRadius']=max(math.hypot(co[0],co[1]) for co in S.world_coords(mesh))
                spec['colliders']=[o.name for o in v.all_objects() if S.is_collider(rules,o) and o.name in bpy.data.objects]
                log.append(dict(asset=v.id,cleanup=cleanup))
        bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        for s in inventory:s['sourceSha256']=digest
        ip.write_text(json.dumps(inventory,indent=2)+'\n')
        log.append(dict(source=str(path.relative_to(ROOT)),before=before,after=digest))
    out=ROOT/sys.argv[sys.argv.index('--')+1]
    assert not out.exists();out.write_text(json.dumps(log,indent=2)+'\n')


if __name__=='__main__':main()
