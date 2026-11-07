"""CPU geometry checks against saved sources or decoded shipped GLBs, never author functions."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import numpy as np

ROOT=Path(__file__).resolve().parents[5]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, rules as R, scene as S

TASK=ROOT/'assets/blend/cities/ixari'
RULES=R.load()


def tree(objects):
    vertices=[];faces=[]
    for ob in objects:
        start=len(vertices)
        vertices.extend(Vector(x) for x in S.world_coords(ob))
        faces.extend(tuple(start+i for i in p.vertices) for p in ob.data.polygons)
    return BVHTree.FromPolygons(vertices,faces), vertices, faces


def segment_hit(bvh,start,end):
    a=Vector(start);delta=Vector(end)-a
    if delta.length<.001:return None
    location,normal,index,distance=bvh.ray_cast(a,delta.normalized(),delta.length)
    return list(location) if location is not None and distance<delta.length-.02 else None


def audit_variant(v,spec):
    meshes=S.render_meshes(RULES,v.lods[0]);bvh,verts,faces=tree(meshes)
    colliders=[o for o in v.all_objects() if S.is_collider(RULES,o)]
    cbvh,_,_=tree(colliders)
    errors=[];checks={};bounds=S.bounds(meshes)
    height=float(bounds[1][2]-bounds[0][2])
    radius=max(math.hypot(co.x,co.y) for co in verts)
    checks['actualFootprintRadius']=radius
    if abs(radius-spec['footprintRadius'])>.04:errors.append('planner footprint does not match actual geometry')
    band={'low':(6,14),'mid':(20,60),'tall':(170,340),'anchor':(40,60)}.get(spec['role'])
    if band and not band[0]<=height<=band[1]:errors.append(f'height {height} outside nominal band {band}')
    counts=[sum(S.tri_count(o) for o in S.render_meshes(RULES,v.lods.get(i,[]))) for i in range(4)]
    if not all(counts[i]>counts[i+1]>0 for i in range(3)) or counts[3]/counts[0]>=.05:
        errors.append('four strictly decreasing LODs, LOD3 <5%, required')
    fit=[]
    for c in colliders:
        cv=S.world_coords(c);limit=.08+.04*max(np.ptp(cv[:,0]),np.ptp(cv[:,1]))
        # Endpoints and face centres reveal bulging or enclosing collider proxies.
        samples=list(cv)+[cv[list(p.vertices)].mean(0) for p in c.data.polygons]
        distances=[bvh.find_nearest(Vector(x))[3] for x in samples]
        worst=max(d for d in distances if d is not None)
        fit.append(dict(name=R.strip(c.name),maxSurfaceDistance=worst,tolerance=limit,triangles=S.tri_count(c)))
        if worst>limit:errors.append(f'{R.strip(c.name)} surface fit {worst:.3f} > {limit:.3f}m')
        if S.tri_count(c)>512:errors.append(f'{R.strip(c.name)} collider >512 triangles')
    checks['colliderFit']=fit
    rails=[]
    for c in colliders:
        if 'SpiralRail' not in c.name and 'BridgeRail' not in c.name:continue
        columns={}
        for x,y,z in S.world_coords(c):columns.setdefault((round(x,4),round(y,4)),[]).append(float(z))
        spans=[max(z)-min(z) for z in columns.values()]
        deviation=max(abs(h-1.05) for h in spans)
        rails.append(dict(name=R.strip(c.name),maxDeviationMetres=deviation))
        if deviation>.03:errors.append('railing not 1.05m above its local deck: '+R.strip(c.name))
    checks['railHeights']=rails
    rays=0;hits=[]
    for route in spec['walkRoutes']:
        points=route['points']
        for start,end in zip(points,points[1:]):
            start=Vector(start);end=Vector(end);direction=end-start
            side=Vector((-direction.y,direction.x,0)).normalized()
            for lateral in (-route['width']/2+.04,0,route['width']/2-.04):
                for lift in (.23,1.1,1.85,route['height']-.03):
                    a=start+side*lateral+Vector((0,0,lift));b=end+side*lateral+Vector((0,0,lift))
                    for label,t in [('render',bvh),('collider',cbvh)]:
                        hit=segment_hit(t,a,b);rays+=1
                        if hit:hits.append(dict(kind=label,start=list(a),end=list(b),hit=hit))
    if hits:errors.append(f'{len(hits)} intersections inside the declared walk corridor')
    checks['clearanceRays']=rays;checks['clearanceHits']=hits[:30]
    supports=[]
    for route in spec['walkRoutes']:
        if route.get('kind') not in ('spiral','summit_exit') and v.id!='bridge_ixari':continue
        samples=0;missing=[];max_delta=0
        for start,end in zip(route['points'],route['points'][1:]):
            a=Vector(start);b=Vector(end);steps=max(1,math.ceil((b-a).length/.25))
            side=Vector((-(b-a).y,(b-a).x,0)).normalized()
            for j in range(steps+1):
                for lateral in (-1.4,0,1.4):
                    feet=a.lerp(b,j/steps)+side*lateral
                    hit,normal,index,distance=bvh.ray_cast(feet+Vector((0,0,.6)),Vector((0,0,-1)),.9)
                    samples+=1
                    if hit is None:missing.append(list(feet))
                    else:max_delta=max(max_delta,abs(hit.z-feet.z))
        supports.append(dict(kind=route.get('kind','bridge'),samples=samples,missing=missing[:10],maxHeightDelta=max_delta))
        if missing or max_delta>.25:errors.append('walking deck support missing or more than .25m from the route')
    checks['deckSupport']=supports
    checks['openings']=[]
    for opening in spec['openings']:
        if opening['width']<2 or opening['height']<3:errors.append('service opening below 3h x2w')
        x,y,z=opening['center'];open_hits=[]
        for side in np.linspace(-opening['width']/2+.05,opening['width']/2-.05,9):
            for h in (.2,1,1.85,2.9):
                a=(x+side,y-.1,z+h);b=(x+side,y+.1,z+h)
                for label,t in [('render',bvh),('collider',cbvh)]:
                    hit=segment_hit(t,a,b)
                    if hit:open_hits.append(dict(kind=label,point=hit))
        if open_hits:errors.append(f'service opening is obstructed at {len(open_hits)} samples')
        checks['openings'].append(dict(**opening,hits=open_hits))
    checks['markers']=[]
    by_name={R.strip(o.name):o for o in v.all_objects()}
    for marker in spec['markers']:
        o=by_name.get(marker['name'])
        if o is None:errors.append('missing marker '+marker['name']);continue
        pos=o.matrix_world.translation
        distance=bvh.find_nearest(pos)[3]
        entry=dict(name=marker['name'],position=list(pos),nearestSurface=distance)
        if marker['name'].startswith('Light_'):
            if not isinstance(o.get('color'),str) or not o.get('color','').startswith('#'):
                errors.append('invalid light colour '+o.name)
            if any(not isinstance(o.get(k),(float,int)) or not math.isfinite(o[k]) or o[k]<=0 for k in ('intensity','distance')):
                errors.append('invalid light range/intensity '+o.name)
            if distance is None or distance>2.5:errors.append('light detached from visible growth '+o.name)
        if marker['name'].startswith('Interact'):
            # A horizontal 0.76m player capsule diameter must be unobstructed at torso height.
            for d in ((.38,0,0),(0,.38,0)):
                hit=segment_hit(cbvh,pos-Vector(d),pos+Vector(d))
                if hit:errors.append('interaction point inside collider boundary '+o.name)
            if distance is None or distance>3:errors.append('interaction more than 3m from the asset '+o.name)
        checks['markers'].append(entry)
    return dict(id=v.id,errors=errors,height=height,lodTriangles=counts,checks=checks)


def negative_controls(source):
    results=[]
    def check(name,mutate):
        core.load(source);mutate()
        result=core.run_checks(RULES,source,'cities','source')
        assert result.status=='FAIL',f'negative control {name} not rejected'
        results.append(dict(control=name,stockStatus=result.status))
    check('missing collider',lambda:[bpy.data.objects.remove(o,do_unlink=True) for o in list(bpy.data.objects) if o.name.startswith('COL_')])
    check('missing LOD3',lambda:[bpy.data.collections.remove(c) for c in list(bpy.data.collections) if c.name.endswith('_LOD3')])
    check('wrong biped height',lambda:setattr(bpy.data.objects['REF_Biped'].scale,'z',.5))
    def no_normal():
        for m in bpy.data.materials:
            if m.name.startswith('LIB_IxariAtlas'):
                bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
                for link in list(bs.inputs['Normal'].links):m.node_tree.links.remove(link)
    check('missing normal map',no_normal)
    # Geometry checks, not labels: obstruction injected into an otherwise open passage.
    core.load(source);model=S.collect_source(RULES)
    v=next(v for a in model.assets for v in a.variants.values())
    mesh=S.render_meshes(RULES,v.lods[0])[0]
    original=mesh.data.copy()
    bv=[(-2,-4,0),(2,-4,0),(2,-3,0),(-2,-3,0),(-2,-4,4),(2,-4,4),(2,-3,4),(-2,-3,4)]
    bf=[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
    me=bpy.data.meshes.new('negative_door_block');me.from_pydata(bv,[],bf);mesh.data=me
    bvh,_,_=tree([mesh]);hit=segment_hit(bvh,(0,-7,1),(0,0,1))
    assert hit is not None
    results.append(dict(control='actual BVH door obstruction',hit=hit,status='REJECTED'))
    mesh.data=original
    return results


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--mode',choices=('source','export'),required=True)
    ap.add_argument('--out',required=True);ap.add_argument('--negative',action='store_true')
    a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);out=ROOT/a.out
    assert not out.exists(),'exclusive new audit output required'
    records=[]
    for path in sorted((TASK/'inventory').glob('*.json')):
        inventory=json.loads(path.read_text());source=ROOT/inventory[0]['source'];file=source if a.mode=='source' else ROOT/inventory[0]['glb']
        core.load(file);model=S.collect_source(RULES) if a.mode=='source' else S.collect_export(RULES)
        S.assign_classes(RULES,'cities',model)
        variants={v.id:v for aa in model.assets for v in aa.variants.values()}
        assert set(variants)=={s['id'] for s in inventory},(file,'inventory mismatch')
        audits=[audit_variant(variants[s['id']],s) for s in inventory]
        records.append(dict(path=str(file.relative_to(ROOT)),sha256=hashlib.sha256(file.read_bytes()).hexdigest(),variants=audits))
        print('AUDIT',file.name,[(v['id'],len(v['errors'])) for v in audits],flush=True)
    result=dict(mode=a.mode,backend='CPU geometry; not GPU visual PASS',files=records)
    if a.negative:result['negativeControls']=negative_controls(ROOT/'assets/blend/cities/ixari_low.blend')
    result['status']='FAIL' if any(v['errors'] for f in records for v in f['variants']) else 'PASS'
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
    print(result['status'],out,flush=True)
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':main()
