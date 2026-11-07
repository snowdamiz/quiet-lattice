"""Insert actual rail bend topology while preserving the existing UVs and rigid weights."""
import bpy,bmesh,json,hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[5];SRC=ROOT/'assets/blend/hulls/lark.blend';OUT=ROOT/'assets/renders/hulls/lark-round3-current'
before=hashlib.sha256(SRC.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(SRC));bpy.context.preferences.filepaths.save_version=0
A=Vector((-3,.95,-1.95));B=Vector((-.92,.95,1.08));D=B-A;N=Vector((D.z,0,-D.x)).normalized();E=Vector((-2.25,.95,1.10));F=Vector((-.92,.95,1.48));d1=(E-A).normalized();d2=(F-E).normalized();n1=Vector((d1.z,0,-d1.x));n2=Vector((d2.z,0,-d2.x))
def unpose(p):
    q1=(p-A).dot(d1)/(E-A).length;q2=(p-E).dot(d2)/(F-E).length
    near1=A+(E-A)*min(1,max(0,q1));near2=E+(F-E)*min(1,max(0,q2))
    if (p-near1).length<(p-near2).length:t=q1*.72;cross=(p-A).dot(n1)
    else:t=.72+q2*.28;cross=(p-E).dot(n2)
    return A+D*t+N*cross+Vector((0,p.y-.95,0))
def pose(p):
    t=(p-A).dot(D)/D.length_squared;cross=(p-A).dot(N)
    if t<=.72:center=A+(E-A)*(t/.72);normal=n1
    else:center=E+(F-E)*((t-.72)/.28);normal=n2
    return center+normal*cross+Vector((0,p.y-.95,0))
rows=[]
for c in bpy.data.collections:
    if not c.name.startswith('lark') or '_LOD' not in c.name:continue
    o=next(o for o in c.objects if o.type=='MESH' and o.name.startswith('LandingMechanism'));bm=bmesh.new();bm.from_mesh(o.data)
    if c.name.startswith(('lark_damaged_','lark_husked_')):
        for v in bm.verts:
            if .4<v.co.y<1.5 and v.co.x<-.7:v.co=pose(v.co)
    remaining=set(bm.verts);components=[]
    while remaining:
        seed=remaining.pop();seen={seed};stack=[seed]
        while stack:
            for edge in stack.pop().link_edges:
                for v in edge.verts:
                    if v in remaining:remaining.remove(v);seen.add(v);stack.append(v)
        components.append(seen)
    rails=[vs for vs in components if min(v.co.y for v in vs)>.4 and max(v.co.y for v in vs)<1.5 and max(v.co.z for v in vs)-min(v.co.z for v in vs)>2]
    assert len(rails)==4,(c.name,len(rails))
    for rail in rails:
        for v in rail:v.co=unpose(v.co)
        edges={e for v in rail for e in v.link_edges};faces={f for v in rail for f in v.link_faces}
        for t in (.70,.74):
            result=bmesh.ops.bisect_plane(bm,geom=list(rail|edges|faces),plane_co=A+D*t,plane_no=D.normalized(),dist=.00001,clear_inner=False,clear_outer=False)
            rail={v for f in faces if f.is_valid for v in f.verts}|{x for x in result['geom'] if isinstance(x,bmesh.types.BMVert) and x.is_valid}
            edges={e for v in rail for e in v.link_edges};faces={f for v in rail for f in v.link_faces}
        layer=bm.verts.layers.deform.verify();group=o.vertex_groups['GearLeft'].index
        for v in rail:v.co=pose(v.co);v[layer].clear();v[layer][group]=1
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update();o.data.calc_loop_triangles();rows.append({'collection':c.name,'rails':len(rails),'triangles':len(o.data.loop_triangles)})
bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
(OUT/'access-rail-topology.json').write_text(json.dumps({'input_source_sha256':before,'output_source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'repair':'Two UV-interpolated rings per rail around the bend; all four rails remain continuous; original GearLeft rigid ownership preserved','results':rows},indent=2)+'\n')
