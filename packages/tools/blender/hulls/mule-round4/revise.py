"""One-time R4 edits of the recovered source. Never imported by the exporter."""
import bpy
import bmesh
import numpy as np
import math
import os
import json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

SOURCE = Path('assets/blend/hulls/mule.blend').resolve()
OUT = Path(os.environ['MULE_ATTEMPT'])
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
bpy.context.preferences.filepaths.save_version = 0
LOG = {'changes': [], 'lods': {}}


def parts(mesh):
    parents = list(range(len(mesh.vertices)))
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    for edge in mesh.edges:
        parents[root(edge.vertices[0])] = root(edge.vertices[1])
    groups = {}
    for face in mesh.polygons:
        groups.setdefault(root(face.vertices[0]), []).append(face.index)
    return list(groups.values())


def image(name, pixels):
    h,w,_ = pixels.shape
    im=bpy.data.images.new(name, width=w, height=h, alpha=True)
    im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(pixels.astype(np.float32).ravel())
    im.pack()
    return im


def raster(objects, material, field, size=2048):
    pixels=np.zeros((size,size,4),np.float32)
    for o in objects:
        me=o.data;me.calc_loop_triangles();uv=me.uv_layers.active.data
        for t in me.loop_triangles:
            if me.materials[t.material_index] != material: continue
            coords=np.array([list(o.matrix_world @ me.vertices[i].co) for i in t.vertices])
            tex=np.array([uv[i].uv[:] for i in t.loops])*size-.5
            lo=np.maximum(0,np.floor(tex.min(0)).astype(int));hi=np.minimum(size-1,np.ceil(tex.max(0)).astype(int))
            if np.any(lo>hi):continue
            xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1))
            a,b,c=tex;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-8:continue
            u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
            v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den
            w=1-u-v;inside=(u>=-.001)&(v>=-.001)&(w>=-.001)
            if not inside.any():continue
            world=u[...,None]*coords[0]+v[...,None]*coords[1]+w[...,None]*coords[2]
            val=field(world, o, me.polygons[t.polygon_index])
            pixels[yy[inside],xx[inside]]=val[inside]
    # Pad atlas islands four texels, including their alpha; no global blur across islands.
    valid=pixels[:,:,3]>0
    for _ in range(4):
        for axis,shift in [(0,1),(0,-1),(1,1),(1,-1)]:
            src=np.roll(pixels,shift,axis);mask=~valid & np.roll(valid,shift,axis)
            pixels[mask]=src[mask];valid[mask]=True
    return pixels


def mix(nt, a, b, factor, label):
    n=nt.nodes.new('ShaderNodeMixRGB');n.name=label;n.blend_type='MIX'
    for value,socket in [(a,n.inputs[1]),(b,n.inputs[2]),(factor,n.inputs[0])]:
        if hasattr(value,'node'):nt.links.new(value,socket)
        else:socket.default_value=value
    return n.outputs[0]


def trim_field(p, o, face):
    x,y,z=p[...,0],p[...,1],p[...,2]
    wear=np.zeros_like(x)
    def dab(center,scale,amount):
        nonlocal wear
        q=((p-np.array(center))/np.array(scale))**2
        wear=np.maximum(wear,amount*np.maximum(0,1-q.sum(-1))**1.4)
    # Ladder: contact centers on each rung, upper hand grips, foot/joint connections.
    for i in range(8):
        zz=-2.28+i*.34
        dab((-1.62,8.91,zz+.018),(.07,.145,.035),.72)
        for yy in [8.72,9.12]:dab((-1.62,yy,zz),(.05,.035,.05),.23)
    for yy in [8.72,9.12]:
        dab((-1.37,yy,.53),(.13,.07,.22),.78)
        dab((-1.62,yy,-2.55),(.10,.09,.065),.25)
    # Canopy latches/handles and exposed rim corners, separated patches rather than an edge wash.
    for c,s in [((-.85,9.7,.62),(.24,.10,.10)),((.85,9.7,.62),(.19,.10,.10)),((0,9.98,.86),(.09,.07,.13)),((-1.3,8,.95),(.16,.13,.09)),((1.3,8,.95),(.12,.13,.09))]:dab(c,s,.62)
    # Service access on hardpoint collars, selected outer-shell contact edges, gear joint collars.
    for c,s in [((.28,8.7,-.83),(.13,.17,.08)),((-.44,-7.35,3.36),(.14,.19,.035)),((.27,-7.77,3.36),(.10,.12,.035)),((-10.8,-5.6,.05),(.18,.5,.10)),((10.8,-5.6,.05),(.18,.35,.1))]:dab(c,s,.35)
    for gx in [-5.8,5.8]:
        for gy in [-3.8,4.4]:dab((gx,gy,-1.8),(.25,.25,.10),.24)
    # Sparse short striations only within the selected contact patches.
    wear*=.78+.22*np.sin(x*155+y*47+z*83)**2
    result=np.zeros((*x.shape,4),np.float32);result[...,0]=wear;result[...,3]=1
    return result


def trim_material(mat, objects):
    nt=mat.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    im=image(mat.name+'_R4_contact',raster(objects,mat,trim_field))
    tex=nt.nodes.new('ShaderNodeTexImage');tex.name='R4 painted contact wear';tex.image=im
    sep=nt.nodes.new('ShaderNodeSeparateColor');nt.links.new(tex.outputs['Color'],sep.inputs[0])
    livery=nt.nodes.get('Livery')
    live='Husk' not in mat.name
    base=livery.outputs[0] if livery else ((.018,.022,.024,1) if not live else (.035,.08,.10,1))
    col=mix(nt,base,(.23,.27,.28,1) if live else (.10,.065,.045,1),sep.outputs['Red'],'R4 rubbed metal')
    nt.links.new(col,bs.inputs['Base Color'])
    rough=mix(nt,(.46,.46,.46,1) if live else (.69,.69,.69,1),(.28,.28,.28,1) if live else (.49,.49,.49,1),sep.outputs['Red'],'R4 contact roughness')
    nt.links.new(rough,bs.inputs['Roughness'])
    # Keep the inherited fine brushed normal; reduce its broad-scale amplitude.
    for n in nt.nodes:
        if n.type=='BUMP':n.inputs['Strength'].default_value=.12;n.inputs['Distance'].default_value=.002
    mat['r4_wear']='Painted contact mask: rung treads, grips, joints, latches and selected exposed edges.'
    LOG['changes'].append({'material':mat.name,'wear_nonzero_fraction':float((np.array(im.pixels[:])[::4]>.01).mean())})


def crack_segments(husk):
    rng=np.random.default_rng(431 if husk else 124)
    segments=[]
    origins=[(-.62,9.23,1.0),(.72,9.77,.48)]
    if husk:origins.append((.20,8.22,.42))
    for ox,oy,scale in origins:
        for j,ang in enumerate([.13,.71,1.35,2.08,2.62,3.37,4.16,4.69,5.35,5.94]):
            length=scale*rng.uniform(.30,.95);start=np.array([ox,oy]);path=[start.copy()]
            for k in range(1,6):
                r=length*k/5;theta=ang+rng.uniform(-.12,.12)
                end=np.array([ox+math.cos(theta)*r,oy+math.sin(theta)*r])
                segments.append((start.copy(),end.copy(),.0018 if k>2 else .0035));path.append(end);start=end
            if j%3==0:
                start=path[2];theta=ang+.42;end=start+np.array([math.cos(theta),math.sin(theta)])*length*.32
                segments.append((start,end,.0012))
        # Interrupted, irregular near-impact rings, without a tiled cell network.
        for radius in [.035,.075,.13]:
            for j in range(12):
                if (j+int(radius*100))%4==0:continue
                a=j*math.tau/12;b=(j+.82)*math.tau/12
                segments.append((np.array([ox+math.cos(a)*radius,oy+math.sin(a)*radius]),np.array([ox+math.cos(b)*radius*.94,oy+math.sin(b)*radius*.94]),.0018))
    return segments,origins


def glass_material(mat, objects, husk):
    segments,origins=crack_segments(husk)
    def field(p,o,face):
        val=np.zeros(p.shape[:-1]);xy=p[...,:2]
        if o.name.startswith('CanopyGlass'):
            for a,b,width in segments:
                d=b-a;t=np.clip(((xy-a)*d).sum(-1)/np.dot(d,d),0,1)
                dist=np.sqrt(((xy-a-t[...,None]*d)**2).sum(-1))
                val=np.maximum(val,np.clip(1-dist/width,0,1))
            for x,y,s in origins:
                dist=np.sqrt(((xy-[x,y])**2).sum(-1));val=np.maximum(val,np.clip(1-dist/.018,0,1))
        r=np.zeros((*val.shape,4),np.float32);r[...,0]=val;r[...,3]=1;return r
    im=image(mat.name+'_R4_impact_fractures',raster(objects,mat,field,4096))
    nt=mat.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    tex=nt.nodes.new('ShaderNodeTexImage');tex.image=im;tex.name='R4 impact origins and tapered cracks'
    sep=nt.nodes.new('ShaderNodeSeparateColor');nt.links.new(tex.outputs[0],sep.inputs[0])
    nt.links.new(mix(nt,(.004,.008,.012,1),(.18,.23,.24,1) if not husk else (.08,.12,.12,1),sep.outputs[0],'R4 fracture colour'),bs.inputs['Base Color'])
    nt.links.new(mix(nt,(.07,.07,.07,1),(.26,.26,.26,1),sep.outputs[0],'R4 fracture roughness'),bs.inputs['Roughness'])
    for l in list(bs.inputs['Normal'].links):nt.links.remove(l)
    mat['r4_fracture_origins']=json.dumps(origins)
    LOG['changes'].append({'material':mat.name,'fracture_origins':origins,'segments':len(segments)})


# A tiny stroke alphabet keeps the instrument legends editable without external fonts.
FONT={'A':['010','101','111','101','101'],'B':['110','101','110','101','110'],'C':['011','100','100','100','011'],
      'D':['110','101','101','101','110'],'E':['111','100','110','100','111'],'F':['111','100','110','100','100'],
      'G':['011','100','101','101','011'],'H':['101','101','111','101','101'],'I':['111','010','010','010','111'],
      'L':['100','100','100','100','111'],'M':['101','111','111','101','101'],'N':['101','111','111','111','101'],
      'O':['010','101','101','101','010'],'P':['110','101','110','100','100'],'R':['110','101','110','101','101'],
      'S':['011','100','010','001','110'],'T':['111','010','010','010','010'],'U':['101','101','101','101','111'],
      'V':['101','101','101','101','010'],'Y':['101','101','010','010','010'],'0':['111','101','101','101','111'],
      '1':['010','110','010','010','111'],'2':['110','001','010','100','111'],'3':['110','001','010','001','110'],
      '4':['101','101','111','001','001'],'/':['001','001','010','100','100'],' ':['000']*5}


def text_mask(x,y,text,left,bottom,width,height):
    ix=np.floor((x-left)/width*(len(text)*4)).astype(int)
    iy=4-np.floor((y-bottom)/height*5).astype(int)
    result=np.zeros_like(x,dtype=bool)
    for j,ch in enumerate(text):
        glyph=FONT[ch]
        for row in range(5):
            for col in range(3):
                if glyph[row][col]=='1':result|=(ix==j*4+col)&(iy==row)
    return result


def cockpit_material(mat, objects, suffix):
    cockpit=bpy.data.objects['CockpitInteriorMesh'+suffix]
    me=cockpit.data;styles={}
    for fs in parts(me):
        ids={i for f in fs for i in me.polygons[f].vertices};co=np.array([me.vertices[i].co[:] for i in ids]);lo=co.min(0);hi=co.max(0);c=(lo+hi)/2;dim=hi-lo
        style=None
        if c[1]>9.18 and c[2]>-.12 and dim[0]>.25 and dim[0]<.4:
            style=('display' if dim[2]<.22 else 'bezel',lo,hi,c)
        if c[1]>9.18 and abs(c[0])<.2 and c[2]>-.12 and .25<dim[0]<.4:
            style=('display' if dim[2]<.28 else 'bezel',lo,hi,c)
        if c[1]>9.2 and dim[0]>1.2 and c[2]>.18:style=('hood',lo,hi,c)
        if abs(c[0])>.5 and 8.35<c[1]<9.16 and -.30<c[2]<.03:
            style=('switch' if max(dim)<.10 else 'console',lo,hi,c)
        if c[1]>9.18 and max(dim)<.035:style=('switch',lo,hi,c)
        if style:
            for f in fs:styles[f]=style
    def field(p,o,f):
        val=np.zeros((*p.shape[:-1],4),np.float32)
        if o!=cockpit or f.index not in styles:return val
        kind,lo,hi,c=styles[f.index];val[...,3]=1
        husk='Husk' in mat.name
        pale=np.array([.30,.43,.39])*(.20 if husk else 1)
        val[...,:3]=[.028,.044,.045]
        if kind=='display':
            x=(p[...,0]-lo[0])/(hi[0]-lo[0]);z=(p[...,2]-lo[2])/(hi[2]-lo[2]);margin=(x<.06)|(x>.94)|(z<.06)|(z>.94)
            val[...,:3]=[.007,.014,.018];val[margin,:3]=[.055,.10,.10]
            title='DRIVE' if c[0]<-.2 else 'CARGO' if c[0]>.2 else 'TRIM'
            text=text_mask(x,z,title,.13,.72,.74,.13)
            text|=text_mask(x,z,'04' if c[0]>.2 else '100',.22,.33,.5,.22)
            for k in range(6):text|=(abs(x-(.14+.14*k))<.008)&(z>.16)&(z<(.22 if k%2 else .25))
            val[text,:3]=pale
        elif kind=='bezel':val[...,:3]=[.12,.18,.17]
        elif kind=='hood':
            x=(p[...,0]-lo[0])/(hi[0]-lo[0]);y=(p[...,1]-lo[1])/(hi[1]-lo[1]);mark=text_mask(x,y,'MULE / CARGO',.22,.35,.56,.22)
            val[...,:3]=[.023,.04,.045];val[mark,:3]=pale*.7
        elif kind=='console':
            val[...,:3]=[.032,.062,.064]
            x=(p[...,0]-lo[0])/(hi[0]-lo[0]);y=(p[...,1]-lo[1])/(hi[1]-lo[1]);mark=text_mask(x,y,'SYS' if c[0]<0 else 'AIR',.12,.65,.70,.12)
            val[mark,:3]=pale
        elif kind=='switch':val[...,:3]=[.22,.30,.26] if int(abs(c[1])*80)%3 else [.32,.16,.048]
        if husk:val[...,:3]*=.32
        return val
    im=image(mat.name+'_R4_instruments',raster(objects,mat,field,4096))
    nt=mat.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    tex=nt.nodes.new('ShaderNodeTexImage');tex.image=im;tex.name='R4 instrument finishes and legends'
    base=bs.inputs['Base Color'].links[0].from_socket
    rough=bs.inputs['Roughness'].links[0].from_socket
    nt.links.new(mix(nt,base,tex.outputs['Color'],tex.outputs['Alpha'],'R4 cockpit inlays'),bs.inputs['Base Color'])
    nt.links.new(mix(nt,rough,(.34,.34,.34,1),tex.outputs['Alpha'],'R4 cockpit finish'),bs.inputs['Roughness'])
    LOG['changes'].append({'cockpit':cockpit.name,'finished_faces':len(styles)})


def tris(o):
    o.data.calc_loop_triangles();return len(o.data.loop_triangles)


def subset(source, faces, name, collection):
    me=source.data;vmap={};vs=[];fs=[];uvs=[];normals=[];mats=[];pids=[]
    cn=me.corner_normals
    for i in faces:
        p=me.polygons[i];row=[]
        for vi,li in zip(p.vertices,p.loop_indices):
            if vi not in vmap:vmap[vi]=len(vs);vs.append(me.vertices[vi].co[:])
            row.append(vmap[vi]);uvs.append(me.uv_layers.active.data[li].uv[:]);normals.append(cn[li].vector[:])
        fs.append(row);mats.append(p.material_index);pids.append(me.attributes['pid'].data[i].value if me.attributes.get('pid') else 0)
    new=bpy.data.meshes.new(name);new.from_pydata(vs,[],fs);new.update()
    for m in me.materials:new.materials.append(m)
    for p,mi in zip(new.polygons,mats):p.material_index=mi;p.use_smooth=True
    uv=new.uv_layers.new(name='UVMap');uv.data.foreach_set('uv',np.array(uvs,dtype=np.float32).ravel())
    pid=new.attributes.new('pid','INT','FACE');pid.data.foreach_set('value',pids)
    new.normals_split_custom_set(normals)
    obj=bpy.data.objects.new(name,new);collection.objects.link(obj)
    obj.matrix_world=source.matrix_world
    return obj


def normal_atlas(me, material):
    me.calc_loop_triangles();uv=me.uv_layers.active.data;cn=me.corner_normals
    points=[];polys=[];normals=[]
    for t in me.loop_triangles:
        if t.material_index != material:continue
        a=[Vector((*uv[li].uv,0)) for li in t.loops]
        if (a[1]-a[0]).cross(a[2]-a[0]).length<1e-12:continue
        polys.append(tuple(range(len(points),len(points)+3)));points.extend(a);normals.append([cn[li].vector.copy() for li in t.loops])
    return BVHTree.FromPolygons(points,polys,all_triangles=True),points,polys,normals


def simplify(obj, ratio):
    if ratio>=1:return
    atlases={mi:normal_atlas(obj.data,mi) for mi in {p.material_index for p in obj.data.polygons}}
    md=obj.modifiers.new('R4 component reduction','DECIMATE');md.ratio=ratio;md.use_collapse_triangulate=True
    with bpy.context.temp_override(object=obj,active_object=obj):bpy.ops.object.modifier_apply(modifier=md.name)
    # Remove loose vertices left by a collapsed tiny fitting.
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS');bm.to_mesh(obj.data);bm.free()
    normals=[]
    for face in obj.data.polygons:
        tree,pts,polys,ns=atlases[face.material_index]
        for index in face.loop_indices:
            li=obj.data.loops[index]
            q=Vector((*obj.data.uv_layers.active.data[index].uv,0));co,no,idx,dist=tree.find_nearest(q)
            if idx is None:normals.append(li.normal[:]);continue
            a,b,c=[pts[k] for k in polys[idx]]
            v=barycentric_transform(co,a,b,c,*ns[idx]).normalized();normals.append(v[:])
    obj.data.normals_split_custom_set(normals)


def rebuild_lods(suffix,variant):
    src=bpy.data.objects['Body'+suffix];me=src.data
    # LOD1/2 preserve every outer plate and all damage-exposed framing verbatim.
    groups=parts(me);protected=[];mechanical=[]
    for fs in groups:
        ids={v for f in fs for v in me.polygons[f].vertices};mi=me.polygons[fs[0]].material_index;role=me.materials[mi].get('engine_name','Nacre')
        pid=max(me.attributes['pid'].data[f].value for f in fs)
        co=np.array([me.vertices[i].co[:] for i in ids]);span=co.max(0)-co.min(0)
        is_damage=suffix and role in ['Dark','Accent'] and max(span)<3.2 and len(fs)<130 and co[:,2].mean()>.15
        (protected if role in ['Hull','Nacre'] or is_damage else mechanical).extend(fs)
    for lod,ratio in [(1,.54),(2,.25)]:
        col=bpy.data.collections[variant+'_LOD'+str(lod)];old=bpy.data.objects['Body'+suffix+'_l'+str(lod)]
        bpy.data.objects.remove(old,do_unlink=True)
        p=subset(src,protected,'R4_Panels'+suffix+'_l'+str(lod),col)
        m=subset(src,mechanical,'R4_Structure'+suffix+'_l'+str(lod),col);simplify(m,ratio)
        p['r4_surface_contract']='Exact LOD0 panel positions, UV corners, split normals and damage openings'
        LOG['lods'][variant+'_LOD'+str(lod)]={'protected_triangles':tris(p),'mechanical_triangles':tris(m),'protected_faces':len(protected)}
    # LOD3 uses local UV-space interpolation so a neighbouring overlapping plate cannot supply its normal.
    col=bpy.data.collections[variant+'_LOD3'];old=bpy.data.objects['Body'+suffix+'_l3'];bpy.data.objects.remove(old,do_unlink=True)
    p=subset(src,protected,'R4_Panels'+suffix+'_l3',col);simplify(p,.115 if not suffix else .085)
    m=subset(src,mechanical,'R4_Structure'+suffix+'_l3',col);simplify(m,.022)
    # Collapsed rib strips retain redundant near-planar triangulation. Dissolve that
    # interior tessellation, respecting UV/material boundaries, before final reduction.
    bm=bmesh.new();bm.from_mesh(m.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bmesh.ops.dissolve_limit(bm,angle_limit=.06,use_dissolve_boundaries=False,verts=list(bm.verts),edges=list(bm.edges),delimit={'MATERIAL','SEAM','UV'})
    bm.to_mesh(m.data);bm.free()
    simplify(m,.5)
    LOG['lods'][variant+'_LOD3']={'protected_triangles':tris(p),'mechanical_triangles':tris(m)}


def main():
    for suffix,variant,prefix in [('', 'mule','Mule_'),('_dmg','mule_damaged','MuleDmg_'),('_husk','mule_husked','MuleHusk_Husk')]:
        objects=[o for o in bpy.data.collections[variant+'_LOD0'].objects if o.type=='MESH']
        trim_material(bpy.data.materials[prefix+'Trim'],objects)
        if suffix:glass_material(bpy.data.materials[prefix+'Glass'],objects,suffix=='_husk')
        cockpit_material(bpy.data.materials[prefix+'Dark'],objects,suffix)
        rebuild_lods(suffix,variant)
        totals=[sum(tris(o) for o in bpy.data.collections[variant+'_LOD'+str(i)].objects if o.type=='MESH') for i in range(4)]
        LOG['lods'][variant]={'triangles':totals,'lod3_fraction':totals[-1]/totals[0]}
        (OUT/'changes.json').write_text(json.dumps(LOG,indent=2))
        print(variant,totals,flush=True)
        assert 60000<=totals[0]<=150000 and all(a>b for a,b in zip(totals,totals[1:])) and totals[3]<totals[0]*.05, totals

    bpy.data.collections['mule']['round4_revision']='R3 material/cockpit/LOD findings; source authoring only; GPU review pending.'
    text=bpy.data.texts.new('Mule Round 4 authoring notes');text.write(json.dumps(LOG,indent=2))
    (OUT/'changes.json').write_text(json.dumps(LOG,indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'scratch/candidate.blend'),compress=True)
    print('CANDIDATE_SAVED',flush=True)

if __name__ == '__main__':
    main()
