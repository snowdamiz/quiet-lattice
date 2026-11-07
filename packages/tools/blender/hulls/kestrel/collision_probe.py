"""CPU measurements against actual source surfaces and authored convex collision volumes."""
import hashlib,json,sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[5];sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core,rules,scene as S
SRC=ROOT/'assets/blend/hulls/kestrel.blend';OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'


def measure():
    r=rules.load();model=S.collect_source(r);asset=model.assets[0];v=asset.variants['kestrel'];objects=v.lods[0]
    cols=[o for o in v.all_objects() if S.is_collider(r,o)];planes=[]
    for c in cols:
        points=S.world_coords(c);centre=points.mean(0);m=c.matrix_world;nm=m.to_3x3().inverted().transposed();normal=[];offset=[]
        for f in c.data.polygons:
            n=np.array(nm@f.normal);p=np.array(m@f.center)
            if np.dot(n,p-centre)<0:n=-n
            normal.append(n);offset.append(np.dot(n,p))
        planes.append((np.array(normal),np.array(offset)))
    coverage={}
    for o in objects:
        if o.type!='MESH' or not o.name.startswith(('Body','CanopyGlass','CanopyFrame','GearFront_Assembly','GearLeft_Assembly','GearRight_Assembly')):continue
        points=S.world_coords(o);inside=np.zeros(len(points),bool)
        for normals,offsets in planes:
            for start in range(0,len(points),2048):inside[start:start+2048]|=np.all(points[start:start+2048]@normals.T<=offsets+.04,axis=1)
        missed=points[~inside]
        bins={}
        for p in missed:
            key=str(tuple(np.floor(p*2).astype(int).tolist()));bins[key]=bins.get(key,0)+1
        coverage[o.name]={'vertices':len(points),'outside':len(missed),'coveredFraction':float(inside.mean()) if len(points) else 1,'outsideBounds':[missed.min(0).tolist(),missed.max(0).tolist()] if len(missed) else None,'outsideHalfMetreBins':bins,'modifiers':[m.type for m in o.modifiers]}
    body=next(o for o in objects if o.name=='Body')
    tree=BVHTree.FromPolygons([body.matrix_world@v.co for v in body.data.vertices],[list(p.vertices) for p in body.data.polygons])
    hits=[];rays=0
    for y in np.linspace(1.32,2.60,9):
        for z in np.linspace(-.03,1.65,29):
            rays+=1;hit=tree.ray_cast(Vector((-1.5,float(y),float(z))),Vector((1,0,0)),1.05)
            if hit[0] is not None:hits.append({'y':float(y),'z':float(z),'hit':list(hit[0])})
    return {'convexVolumeCoverageWithin4cm':coverage,'colliders':[{'name':c.name,'bounds':[x.tolist() for x in S.bounds([c])],'matrix':[list(x) for x in c.matrix_world]} for c in cols],'boardingBodyRays':rays,'boardingBodyHits':hits,'scope':'Source outer-hull/gear/canopy surface samples and body-only side-entry rays. Not a runtime capsule simulation.'}


if __name__=='__main__':
    before=hashlib.sha256(SRC.read_bytes()).hexdigest();core.load(SRC);result=measure()
    assert hashlib.sha256(SRC.read_bytes()).hexdigest()==before
    result['sourceSha256']=before
    (OUT/'collision-probe.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
