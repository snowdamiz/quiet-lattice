"""Remove zero-area rib triangles from R4 lower LODs; preserve saved material authoring."""
import bpy,bmesh,json,os,sys
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.geometry import barycentric_transform
sys.path.insert(0,str(Path(__file__).resolve().parent))
import revise as r

src=Path(sys.argv[sys.argv.index('--')+1]).resolve()
bpy.ops.wm.open_mainfile(filepath=str(src));bpy.context.preferences.filepaths.save_version=0
out=Path(os.environ['MULE_ATTEMPT']);report={}
for suffix in ['','_dmg','_husk']:
    high=bpy.data.objects['Body'+suffix].data
    atlases={mi:r.normal_atlas(high,mi) for mi in {p.material_index for p in high.polygons}}
    for lod in [1,2,3]:
        o=bpy.data.objects['R4_Structure'+suffix+'_l'+str(lod)];before=r.tris(o)
        bm=bmesh.new();bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        dead=[]
        for f in bm.faces:
            a,b,c=np.asarray([v.co[:] for v in f.verts],dtype=np.float64)
            double_area=np.linalg.norm(np.cross(b-a,c-a))
            edge=max(np.linalg.norm(b-a),np.linalg.norm(c-b),np.linalg.norm(a-c))
            if double_area<2e-9 or double_area/max(edge,1e-12)<1e-5:dead.append(f)
        bmesh.ops.delete(bm,geom=dead,context='FACES')
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
        bm.to_mesh(o.data);bm.free();o.data.update()
        # A collapsed thin rib can leave opposing faces in one smooth fan. Give
        # each corner a valid face basis, then restore the authored smooth normal.
        for edge in o.data.edges:edge.use_edge_sharp=True
        o.data.update()
        normals=[];fallback=0
        for p in o.data.polygons:
            tree,points,polys,ns=atlases[p.material_index]
            for li in p.loop_indices:
                q=Vector((*o.data.uv_layers.active.data[li].uv,0));co,no,i,d=tree.find_nearest(q)
                a,b,c=[points[k] for k in polys[i]]
                n=barycentric_transform(co,a,b,c,*ns[i]).normalized()
                if n.length<.99:n=p.normal;fallback+=1
                normals.append(n[:])
            p.use_smooth=True
        o.data.normals_split_custom_set(normals)
        report[o.name]={'before':before,'after':r.tris(o),'removed_zero_area':len(dead),'fallback_normals':fallback}
(out/'repairs.json').write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'scratch/candidate.blend'),compress=True)
print('REPAIRED',report,flush=True)
