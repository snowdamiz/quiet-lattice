"""Read-only exact convex enclosure certificates for hidden surface allocation.

No visibility threshold or geometry changes: a triangle is certified only when
all three world-space vertices lie strictly inside another watertight convex
component of the same static Body mesh. Moving assemblies are not occluders.
Failure to certify means unknown/visible, never hidden. All LODs are measured.
"""
import hashlib
import json
import os
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[5]
OUT=ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
SOURCE=OUT/'20261107T113800619229Z-registered-surface-input-v2-exact-surfaces.npz'
data=np.load(SOURCE)
MARGIN=.001
report={'input':SOURCE.name,'input_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'clearance_m':MARGIN,'policy':'Strict convex containment only; unknown geometry remains unique. No source change.', 'objects':[]}
certificates={}
for key in sorted(k[:-6] for k in data.files if k.endswith('/world') and '/Body' in k):
    xyz=data[key+'/world'];tri=data[key+'/loop_vertex'][data[key+'/triangles']]
    parents=list(range(len(xyz)))
    def root(a):
        while parents[a]!=a:parents[a]=parents[parents[a]];a=parents[a]
        return a
    for a,b,c in tri:
        parents[root(int(b))]=root(int(a));parents[root(int(c))]=root(int(a))
    components={}
    for i,t in enumerate(tri):components.setdefault(root(int(t[0])),[]).append(i)
    convex=[];rejections={};component_ids=np.empty(len(tri),np.int32)
    for component,indices in components.items():
        component_ids[indices]=component;ts=tri[indices];ids=np.unique(ts);points=xyz[ids]
        edges=np.sort(np.concatenate((ts[:,[0,1]],ts[:,[1,2]],ts[:,[2,0]])),axis=1)
        _,counts=np.unique(edges,axis=0,return_counts=True)
        if not (counts==2).all():
            rejections['not_watertight']=rejections.get('not_watertight',0)+1;continue
        ps=xyz[ts];cross=np.cross(ps[:,1]-ps[:,0],ps[:,2]-ps[:,0]);length=np.linalg.norm(cross,axis=1)
        nonzero=length>1e-12
        if not nonzero.any():continue
        ns=cross[nonzero]/length[nonzero,None];ps=ps[nonzero]
        volume=np.sum(np.einsum('ij,ij->i',ps[:,0]-points.mean(0),cross[nonzero]))/6
        if abs(volume)<1e-10:continue
        if volume<0:ns=-ns
        d=np.einsum('ij,ij->i',ns,ps[:,0])
        # Every actual vertex must be inside every actual face plane: a convex-hull
        # approximation of a concave source is never accepted as an occluder.
        is_convex=True
        for start in range(0,len(points),256):
            if np.max(points[start:start+256]@ns.T-d)>1e-6:is_convex=False;break
        if not is_convex:
            rejections['nonconvex']=rejections.get('nonconvex',0)+1;continue
        convex.append((component,ns,d,points.min(0),points.max(0)))
    ps=xyz[tri];low=ps.min(1);high=ps.max(1)
    certified=np.full(len(tri),-1,np.int32);clearance=np.zeros(len(tri),np.float32)
    for component,ns,d,lo,hi in convex:
        candidates=np.flatnonzero((component_ids!=component)&(certified<0)&(low>lo+MARGIN).all(1)&(high<hi-MARGIN).all(1))
        for start in range(0,len(candidates),128):
            ix=candidates[start:start+128]
            distance=d-(ps[ix].reshape(-1,3)@ns.T)
            minimum=distance.min(1).reshape(-1,3).min(1)
            ok=minimum>MARGIN;certified[ix[ok]]=component;clearance[ix[ok]]=minimum[ok]
    area=np.linalg.norm(np.cross(ps[:,1]-ps[:,0],ps[:,2]-ps[:,0]),axis=1)*.5
    roles=data[key+'/roles'][data[key+'/triangles'][:,0]]
    row={'object':key,'components':len(components),'certified_convex_occluders':len(convex),'rejections':rejections,
         'certified_triangles':int((certified>=0).sum()),'total_triangles':len(tri),
         'roles':{r:{'area_m2':float(area[roles==i].sum()),'certified_enclosed_area_m2':float(area[(roles==i)&(certified>=0)].sum())} for i,r in enumerate(['Hull','Accent','Trim','Dark'])}}
    report['objects'].append(row);print(json.dumps(row),flush=True)
    certificates[key+'/component']=certified;certificates[key+'/clearance']=clearance
name=os.environ['LARK_ATTEMPT_ID']
npz=OUT/(name+'-enclosure.npz');assert not npz.exists();np.savez_compressed(npz,**certificates)
report['certificate_arrays']=npz.name;report['certificate_sha256']=hashlib.sha256(npz.read_bytes()).hexdigest()
with (OUT/(name+'-enclosure.json')).open('x') as f:json.dump(report,f,indent=2)
