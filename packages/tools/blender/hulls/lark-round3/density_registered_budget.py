"""Measure registered physical projection reuse against complete original paint fields.

This is an allocation experiment only. Full-resolution pixel comparisons include
all covered texels, not just corner/average samples. Normal/AO compatibility is
deliberately not inferred from colour compatibility; no source is saved.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[5]
OUT = ROOT/'assets/renders/hulls/lark-round3-current/density-20261107'
sys.path.insert(0, str(Path(__file__).parent))
from density_fields import srgb, alternate

SOURCE = OUT/'20261107T113800619229Z-registered-surface-input-v2-exact-surfaces.npz'
data = np.load(SOURCE)
report = {'premise': 'Physically registered near-planar layers can share complete paint fields at 512 px/m without folding or changing physical scale.',
    'input': SOURCE.name, 'input_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'resolution_px_per_m': 512, 'comparison_tolerance': 1/255,
    'normal_ao_equivalence': 'NOT ESTABLISHED; these candidate savings cannot authorize an asset rewrite',
    'working_set': '256-row strips; no full-hull image buffers', 'groups': []}
partial = (OUT/(os.environ['LARK_ATTEMPT_ID']+'-registered-budget.rows.jsonl')).open('x')

for state, object_name in [('lark', 'Body'), ('lark_damaged', 'Body_dmg'), ('lark_husked', 'Body_husk')]:
    key=state+'_LOD0/'+object_name
    triangles=data[key+'/triangles']; xyz=data[key+'/world'][data[key+'/loop_vertex'][triangles]]
    cross=np.cross(xyz[:,1]-xyz[:,0],xyz[:,2]-xyz[:,0]); norm=np.linalg.norm(cross,axis=1)
    normals=cross/np.maximum(norm[:,None],1e-15); areas=norm*.5
    roles=data[key+'/roles'][triangles[:,0]]
    color=data[key+'/color'][triangles]; orm=data[key+'/orm'][triangles]
    # Keep linear colour to interpolate the actual saved authoring fields before display conversion.
    values=np.concatenate((color[:,:,:3],orm[:,:,1:3]),axis=2)
    for role in range(4):
      for axis in range(3):
        select=(roles==role)&(np.abs(normals[:,axis])>.90)&(areas>1e-10)
        ids=np.flatnonzero(select)
        if not len(ids):continue
        axes=[i for i in range(3) if i!=axis];p=xyz[ids][:,:,axes]*512
        lo=np.floor(p.min(axis=(0,1))).astype(int)-1;hi=np.ceil(p.max(axis=(0,1))).astype(int)+1;p-=lo
        w,h=(hi-lo).tolist()
        assert w < 16384 and h < 16384, (state, role, axis, w, h)
        contributions=covered_total=overlap_total=incompatible=0
        max_difference=0.;hist=np.zeros(7,np.int64); bins=np.array([0,1/255,.01,.03,.1,.3,1.01,np.inf])
        for stripe_y in range(0,h,256):
          height=min(256,h-stripe_y)
          count=np.zeros((height,w),np.uint16)
          low=np.full((height,w,5),np.inf,np.float32);high=np.full((height,w,5),-np.inf,np.float32)
          intersects=(p[:,:,1].max(1)>=stripe_y)&(p[:,:,1].min(1)<stripe_y+height)
          for index,q in zip(ids[intersects],p[intersects]):
            a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-12:continue
            mn=np.maximum((0,stripe_y),np.floor(q.min(0)).astype(int));mx=np.minimum((w-1,stripe_y+height-1),np.ceil(q.max(0)).astype(int))
            xx,yy=np.meshgrid(np.arange(mn[0],mx[0]+1),np.arange(mn[1],mx[1]+1));x=xx+.5;y=yy+.5
            aa=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
            bb=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
            mask=(aa>=0)&(bb>=0)&(aa+bb<=1)
            if not mask.any():continue
            xs=xx[mask];ys=yy[mask]-stripe_y;av=aa[mask];bv=bb[mask]
            field=av[:,None]*values[index,0]+bv[:,None]*values[index,1]+(1-av-bv)[:,None]*values[index,2]
            low[ys,xs]=np.minimum(low[ys,xs],field);high[ys,xs]=np.maximum(high[ys,xs],field)
            count[ys,xs]+=1;contributions+=len(xs)
          covered_total+=int((count>0).sum());overlap=count>1;overlap_total+=int(overlap.sum())
          for y in range(0,height,64):
            mask=overlap[y:y+64]
            if not mask.any():continue
            l=low[y:y+64][mask];u=high[y:y+64][mask]
            diff=np.maximum(np.max(srgb(u[:,:3])-srgb(l[:,:3]),axis=1),np.max(u[:,3:]-l[:,3:],axis=1))
            if state=='lark':
                for scheme in ('compact','working'):
                    r=np.full(len(l),role);lc=np.column_stack((l[:,:3],np.ones(len(l))));uc=np.column_stack((u[:,:3],np.ones(len(u))))
                    diff=np.maximum(diff,np.max(srgb(alternate(uc,r,scheme)[:,:3])-srgb(alternate(lc,r,scheme)[:,:3]),axis=1))
            incompatible+=int((diff>1/255).sum());max_difference=max(max_difference,float(diff.max()));hist+=np.histogram(diff,bins=bins)[0]
          del low,high,count,overlap
        row={'state':state,'role':['Hull','Accent','Trim','Dark'][role],'projection_dropped_axis':'XYZ'[axis],
             'triangles':len(ids),'source_area_m2':float(areas[ids].sum()),'projected_contribution_m2':contributions/512**2,
             'occupied_union_m2':covered_total/512**2,'overlap_m2':overlap_total/512**2,
             'incompatible_overlap_m2':incompatible/512**2,'max_channel_difference':max_difference,
             'overlap_error_histogram':hist.tolist(),'bins':[0,1/255,.01,.03,.1,.3,1.01,'inf'],
             'minimum_principal_density':float(512*np.min(np.abs(normals[ids,axis]))),
             'rectangle_size_pixels':[w,h]}
        report['groups'].append(row);print(json.dumps(row),flush=True)
        partial.write(json.dumps(row)+'\n');partial.flush()
partial.close()
with (OUT/(os.environ['LARK_ATTEMPT_ID']+'-registered-budget.json')).open('x') as f:json.dump(report,f,indent=2)
