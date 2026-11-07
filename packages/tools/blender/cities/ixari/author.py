"""Ixari sculpt session, P1.E10.T06. Saved meshes and packed paintings are authoritative.

This is an authoring-session record, never imported by an exporter. Stock export_cities.py
reads the editable flat .blend files. Pieces retain individual named mesh islands in LOD0.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
from artlib import core, lods, rules as R, scene as S

TASK = ROOT / 'assets/blend/cities/ixari'
TAU = math.tau
RULES = R.load()
PALETTE = ['3B4252', '222735', 'B9A6FF', '7A4FD0', '64E3FF', '2A2C30', 'D8F6FF', '4A5263']


def linear(rgb):
    a = np.asarray(rgb, dtype=np.float32)
    return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055)**2.4)


def paint_atlas(res):
    """Eight hand-directed trim fields: slate, socket soot, clouded crystal, violet,
    fracture light, basalt, glyph, foot-polished slate. No stochastic noise layer."""
    side = res // 4
    maps = {k: np.zeros((res, res, 4), np.float32) for k in ('BaseColor', 'ORM', 'Normal', 'Emissive')}
    y, x = np.mgrid[0:side*2, 0:side].astype(np.float32)
    x /= side - 1
    y /= side*2 - 1
    for tile, color in enumerate(PALETTE):
        c = np.asarray([int(color[i:i+2], 16)/255 for i in (0, 2, 4)],dtype=np.float32)
        # Long cloud inclusions occupy selected places, with chipped diagonal growth bands.
        cloud = (np.exp(-((x-.32)**2/.025 + (y-.67)**2/.04)) * .6
                 + np.exp(-((x-.72)**2/.018 + (y-.29)**2/.065)) * .45)
        cuts = np.zeros_like(x)
        for px, py, slope, length, width in ((.08,.23,.34,.39,.007), (.48,.72,-.45,.25,.009),
                                             (.68,.38,.25,.23,.004), (.23,.91,-.6,.18,.006)):
            dist = np.abs(y - py - (x - px)*slope)
            cuts += np.exp(-(dist/width)**2) * ((x > px) & (x < px+length))
        edge = np.exp(-x/.04) + np.exp(-(1-x)/.04)
        stratum = np.exp(-((y - .42 - .11*x)/.012)**2) + .4*np.exp(-((y-.81+.15*x)/.02)**2)
        if tile in (2, 3):
            tone = .60 + .34*cloud + .10*x - .15*cuts - .06*edge
            rough = .14 + .22*cloud + .19*cuts + .05*edge
            height = .012*cloud - .009*cuts - .012*edge + .004*stratum
        else:
            tone = .67 + .15*cloud + .1*y - .21*cuts - .10*stratum
            rough = .63 + .15*cloud + .15*cuts - (.22*np.exp(-((x-.5)/.23)**2) if tile == 7 else 0)
            height = .018*cloud - .015*cuts - .012*stratum - .008*edge
        # Socket trim has a localized smoky contact band; path has a polished centre.
        if tile == 1:
            tone *= .62 + .36*y
        base = c[None,None,:] * tone[:,:,None]
        if tile == 2:
            base += cloud[:,:,None] * np.asarray([.13,.13,.18],np.float32)[None,None,:]
        dy, dx = np.gradient(height, 1/(side*2), 1/side)
        n = np.stack([-dx*.25, -dy*.25, np.ones_like(x)], axis=-1)
        n /= np.linalg.norm(n, axis=-1)[:,:,None]
        emission = np.zeros_like(base)
        if tile in (4, 6):
            emission = c[None,None,:] * (.32 + .55*cloud + .18*y)[:,:,None]
        elif tile in (2, 3):
            emission = np.asarray([.39,.89,1],np.float32)[None,None,:] * (cuts*.025)[:,:,None]
        yy, xx = (tile//4)*side*2, (tile%4)*side
        sl = np.s_[yy:yy+side*2, xx:xx+side]
        maps['BaseColor'][sl][:,:,:3] = np.clip(base,0,1)
        maps['ORM'][sl][:,:,0] = np.clip(.96 - .25*cuts - .17*edge - .08*stratum, .3, 1)
        maps['ORM'][sl][:,:,1] = np.clip(rough,.08,.94)
        maps['ORM'][sl][:,:,2] = 0
        maps['Normal'][sl][:,:,:3] = n*.5+.5
        maps['Emissive'][sl][:,:,:3] = emission
    images = {}
    for key, data in maps.items():
        data[:,:,3] = 1
        img = bpy.data.images.new(f'Ixari_Atlas_{res}_{key}', res, res, alpha=False)
        img.colorspace_settings.name = 'sRGB' if key in ('BaseColor','Emissive') else 'Non-Color'
        img.pixels.foreach_set(data.ravel())
        img.update()
        img.pack()
        images[key] = img
    return images


def material(res):
    # Append, never mutate the shared library. Keep original linked-look materials as author references.
    with bpy.data.libraries.load(str(ROOT/'assets/blend/_library.blend'), link=False) as (src, dst):
        dst.materials = [m for m in ('LIB_GrownCrystal','LIB_SlateStone','LIB_Basalt','LIB_GlyphLight') if m in src.materials]
    for m in dst.materials:
        m.use_fake_user = True
    original = bpy.data.materials['LIB_GrownCrystal']
    mat = original.copy()
    mat.name = f'LIB_IxariAtlas{res}'
    mat['engine_name'] = f'IxariAtlas{res}'
    mat['library_origin'] = 'LIB_GrownCrystal + LIB_SlateStone + LIB_Basalt; authored trim atlas'
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
    images = paint_atlas(res)
    nodes = {}
    for key,img in images.items():
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image=img
        node.label = key
        nodes[key]=node
    nt.links.new(nodes['BaseColor'].outputs['Color'], bs.inputs['Base Color'])
    sep=nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(nodes['ORM'].outputs['Color'],sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'],bs.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
    nm=nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nodes['Normal'].outputs['Color'],nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
    nt.links.new(nodes['Emissive'].outputs['Color'],bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value=1.4
    ng=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
    ng.interface.new_socket('Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
    gn=nt.nodes.new('ShaderNodeGroup'); gn.node_tree=ng
    nt.links.new(sep.outputs['Red'],gn.inputs['Occlusion'])
    return mat


def mesh_object(name, verts, faces, collection, mat=None, tiles=None):
    me=bpy.data.meshes.new(name)
    me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); collection.objects.link(ob)
    if mat:
        me.materials.append(mat)
        uv=me.uv_layers.new(name='IxariTrimUV')
        for i,p in enumerate(me.polygons):
            tile, part_lo, part_hi=tiles[i] if tiles else (0, None, None)
            coords=[Vector(verts[k]) for k in p.vertices]
            normal=p.normal
            axis=max(range(3),key=lambda a:abs(normal[a]))
            plane=[a for a in range(3) if a!=axis]
            lo=[part_lo[a] if part_lo is not None else min(v[a] for v in coords) for a in plane]
            hi=[part_hi[a] if part_hi is not None else max(v[a] for v in coords) for a in plane]
            # Large connected facets carry the painted trim; slight island rotations break repetitions.
            for li,v in zip(p.loop_indices,coords):
                u=(v[plane[0]]-lo[0])/max(hi[0]-lo[0],.0001)
                w=(v[plane[1]]-lo[1])/max(hi[1]-lo[1],.0001)
                uv.data[li].uv=((tile%4+.025+.95*u)/4,(tile//4+.025+.95*w)/2)
    return ob


class Piece:
    def __init__(self, asset, role, title, cls, mat):
        self.id=asset; self.role=role; self.title=title; self.cls=cls; self.mat=mat
        self.coll=bpy.data.collections.new(asset); bpy.context.scene.collection.children.link(self.coll)
        self.coll['asset_class']=cls
        self.lod=bpy.data.collections.new(asset+'_LOD0'); self.coll.children.link(self.lod)
        self.v=[]; self.f=[]; self.tiles=[]; self.islands=[]; self.markers=[]; self.routes=[]; self.openings=[]
        self.colliders=[]; self.pad=None

    def add(self,name,verts,faces,tile=0,collider=False):
        start=len(self.v); self.v.extend(tuple(v) for v in verts)
        self.f.extend(tuple(start+i for i in f) for f in faces)
        lo=tuple(min(v[a] for v in verts) for a in range(3))
        hi=tuple(max(v[a] for v in verts) for a in range(3))
        self.tiles.extend([(tile,lo,hi)]*len(faces)); self.islands.append([name,start,len(verts)])
        if collider:
            ob=mesh_object('COL_'+self.id+'_'+name,verts,faces,self.coll)
            ob.display_type='WIRE'; ob.hide_render=True
            self.colliders.append(ob.name)
        return verts,faces

    def collider(self,name,verts,faces):
        ob=mesh_object('COL_'+self.id+'_'+name,verts,faces,self.coll)
        ob.hide_render=True; ob.display_type='WIRE'; self.colliders.append(ob.name)

    def marker(self,name,xyz,**props):
        ob=bpy.data.objects.new(name+'_'+self.id,None); self.coll.objects.link(ob)
        ob.location=xyz; ob.empty_display_size=.35
        for k,v in props.items():ob[k]=v
        self.markers.append(dict(name=ob.name,position=list(xyz),properties=props))

    def finish(self):
        mesh=mesh_object(self.id+'_Facets',self.v,self.f,self.lod,self.mat,self.tiles)
        # Editable islands with labels and individual vertex groups, not a fused uneditable proxy.
        for name,start,count in self.islands:
            group=mesh.vertex_groups.new(name=name)
            group.add(list(range(start,start+count)),1,'REPLACE')
        bpy.context.view_layer.update()
        model=S.collect_source(RULES); S.assign_classes(RULES,'cities',model)
        variant=next(v for a in model.assets for v in a.variants.values() if v.id==self.id)
        tris=S.tri_count(mesh)
        low,high=RULES['classes'][self.cls]['tris']
        print('AUTHOR',self.id,'LOD0',tris,'budget',low,high,flush=True)
        assert low<=tris<=high,(self.id,tris,low,high)
        generated=bpy.data.collections.new('_LOD_build_'+self.id); self.coll.children.link(generated)
        lods.generate(RULES,variant,generated)
        for level in range(1,4):
            coll=bpy.data.collections.new(f'{self.id}_LOD{level}'); self.coll.children.link(coll)
            for ob in variant.lods[level]:
                for old in list(ob.users_collection):old.objects.unlink(ob)
                ob.name=f'{self.id}_Facets_L{level}'; ob.data.name=ob.name
                coll.objects.link(ob); ob.hide_render=True
        bpy.data.collections.remove(generated)
        b=S.bounds([mesh]); h=float(b[1][2]-b[0][2])
        return dict(id=self.id,title=self.title,role=self.role,assetClass=self.cls,
                    bounds=[list(map(float,x)) for x in b],authoredHeight=h,
                    footprintRadius=max(math.hypot(x,y) for x,y,z in self.v),
                    lodTriangles=[tris]+[sum(S.tri_count(o) for o in variant.lods[k]) for k in range(1,4)],
                    markers=self.markers,colliders=self.colliders,openings=self.openings,walkRoutes=self.routes,
                    padDiameter=self.pad,sourceIslands=len(self.islands),node=self.id)


def polygon(rx,ry,n=6,angle=0):
    return [(rx*math.cos(angle+i*TAU/n),ry*math.sin(angle+i*TAU/n)) for i in range(n)]


def slab(p,name,xy,z0,z1,tile=0,collider=True):
    n=len(xy)
    ztop=[z1]*n if isinstance(z1,(float,int)) else z1
    v=[(x,y,z0) for x,y in xy]+[(x,y,z) for (x,y),z in zip(xy,ztop)]
    f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    p.add(name,v,f,tile,collider)


def crystal(p,name,xyz,radius,height,lean=(0,0),tile=2,collider=False,rhomb=False,detail=1):
    sides=4 if rhomb else 6
    # Bevelled hex/rhombic section; unequal facets and a snapped tip.
    base=polygon(radius,radius*(.67 if rhomb else .87),sides,.19)
    cross=[]
    for i,q in enumerate(base):
        prev=base[i-1]; nxt=base[(i+1)%sides]
        cross += [(q[0]*.89+prev[0]*.11,q[1]*.89+prev[1]*.11),
                  (q[0]*.91+nxt[0]*.09,q[1]*.91+nxt[1]*.09)]
    zs=[0,.20,.21,.46,.47,.69,.70,.94,1]
    scales=[1,1,.88,.88,.71,.71,.52,.32,.025]
    v=[]; n=len(cross)
    for k,(z,s) in enumerate(zip(zs,scales)):
        for j,(x,y) in enumerate(cross):
            chip=1-.12*(k in (4,8,10) and j==(len(name)%n))
            v.append((xyz[0]+x*s*chip+lean[0]*z, xyz[1]+y*s*chip+lean[1]*z, xyz[2]+z*height))
    f=[tuple(reversed(range(n))),tuple(range((len(zs)-1)*n,len(zs)*n))]
    for k in range(len(zs)-1):
        for j in range(n):f.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
    p.add(name,v,f,tile)
    if collider:
        # The external faceted section is the collider; no invisible enclosing central box.
        cv=[(xyz[0]+x,xyz[1]+y,xyz[2]) for x,y in base]
        cv += [(xyz[0]+x*.35+lean[0]*.94,xyz[1]+y*.35+lean[1]*.94,xyz[2]+height*.94) for x,y in base]
        cf=[tuple(reversed(range(sides))),tuple(range(sides,sides*2))]
        cf += [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
        p.collider(name,cv,cf)


def stone_shard(p,name,xyz,rx,ry,h,tile=0,collider=False,segments=6):
    # Narrow fracture beds and faceted erosion; each section is edited, asymmetric, and stepped.
    n=12; v=[]
    for k in range(segments+1):
        t=k/segments
        for j in range(n):
            a=j*TAU/n+.12
            ridge=1+.055*math.sin(j*1.71+k*.94)+.028*math.sin(k*2.7-j*.62)
            taper=1-.30*t+.035*(k%3==0)
            v.append((xyz[0]+math.cos(a)*rx*taper*ridge+.07*rx*t,
                      xyz[1]+math.sin(a)*ry*taper*ridge-.10*ry*t,xyz[2]+h*t))
    f=[tuple(reversed(range(n))),tuple(range(segments*n,(segments+1)*n))]
    f += [(k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for k in range(segments) for j in range(n)]
    p.add(name,v,f,tile)
    if collider:
        cv=v[:n]+v[-n:]; cf=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        cf += [(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)]
        p.collider(name,cv,cf)


def ribbon(p,name,a,b,width,thick,tile=4,collider=False):
    direction=Vector(b)-Vector(a)
    side=Vector((-direction.y,direction.x,0)).normalized()*width*.5
    if side.length==0:side=Vector((width*.5,0,0))
    aa=Vector(a); bb=Vector(b); up=Vector((0,0,thick))
    v=[aa-side,aa+side,bb+side,bb-side,aa-side+up,aa+side+up,bb+side+up,bb-side+up]
    p.add(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],tile,collider)


def socket_cluster(p,name,xyz,r,h,count=5,phase=0,collision=False):
    stone_shard(p,name+'Socket',xyz,r*1.16,r*.94,min(h*.18,r*.45),1,collision,4)
    for i in range(count):
        a=phase+i*2.39996
        offset=r*(.25+.12*(i%3)) if i else 0
        size=r*(.46 if i else .72)*(1-.035*i)
        crystal(p,name+f'Growth{i}',(xyz[0]+math.cos(a)*offset,xyz[1]+math.sin(a)*offset,xyz[2]+.1*r),
                size,h*(1-.095*i),(.14*h*math.cos(a),.08*h*math.sin(a)),2 if i%3 else 3,collision,rhomb=i%3==2)
    # A few illuminated fractures leak from between the facets, never an all-over neon outline.
    for j in range(2):
        a=phase+j*2.1
        crystal(p,name+f'Leak{j}',(xyz[0]+r*.53*math.cos(a),xyz[1]+r*.53*math.sin(a),xyz[2]+.12*h),
                r*.025,h*.36,(.06*h*math.cos(a),.025*h*math.sin(a)),4,False,True)


def biolume(p,name,xyz,size=1,interact=False):
    socket_cluster(p,name,xyz,.45*size,1.9*size,4,.3,True)
    p.marker('Light_'+name,(xyz[0],xyz[1],xyz[2]+1.55*size),color='#64E3FF',intensity=1.1,distance=7*size)
    if interact:p.marker('Interact_'+name,(xyz[0],xyz[1]-size,xyz[2]+1.1))


def hall(p,rx,ry,height,seed=0,civic=False):
    slab(p,'FootPolishedFloor',polygon(rx,ry,24),0,.18,7)
    # Carved portal opens the front of the stone shaft; 3.6 m clear centre aisle.
    n=24; step=TAU/n; front=-math.pi/2
    for j in range(n):
        a=front+(j-.5)*step; b=a+step
        center=(a+b)*.5
        if math.sin(center)<-.90: continue
        xy=[(rx*math.cos(a),ry*math.sin(a)),(rx*math.cos(b),ry*math.sin(b)),
            ((rx-.80)*math.cos(b),(ry-.80)*math.sin(b)),((rx-.80)*math.cos(a),(ry-.80)*math.sin(a))]
        # Wide stone terraces get deliberate fracture shelves, not plain cylinders.
        h=height*(.66+.11*math.sin(j*.83+seed)+.04*math.cos(j*2.1))
        verts=[]; ring_count=22 if height>70 else 14
        for k in range(ring_count+1):
            t=k/ring_count
            taper=1-.21*t + .018*(k%4==1)
            for ix,(x,y) in enumerate(xy):
                radial=1+.008*math.sin(j*1.2+k*1.7+ix)
                verts.append((x*taper*radial,y*taper*radial,.18+h*t))
        faces=[(3,2,1,0),tuple(range(ring_count*4,ring_count*4+4))]
        faces += [(k*4+i,k*4+(i+1)%4,(k+1)*4+(i+1)%4,(k+1)*4+i) for k in range(ring_count) for i in range(4)]
        p.add(f'ShaftBed{j}',verts,faces,0)
        cv=verts[:4]+verts[-4:]
        p.collider(f'ShaftBed{j}',cv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
        # Outcrops trace the stepped terraces; corner crystal sockets do not block the doorway.
        levels=3 if height<20 else 4
        for k in range(levels):
            t=(k+.6)/(levels+1)
            if j%3 != (seed%3) and k>0: continue
            size=(.32+.10*(j%3))*(1 if height<20 else 1.6 if height<70 else 2.9)
            socket_cluster(p,f'ShaftFacet{j}_{k}',(rx*(1-.18*t)*math.cos(center),ry*(1-.18*t)*math.sin(center),.18+h*t),
                           size,min(height*.16,9)*(1+.1*(j%3)),3,center,False)
    # Socket-collared portal sides; no mesh spans the passage below its clear header.
    for side in (-1,1):
        stone_shard(p,f'PortalCheek{side+1}',(side*2.7,-ry*.94,.18),.8,1.05,3.7,1,True,10)
        crystal(p,f'PortalCrown{side+1}',(side*2.65,-ry*.94,3.6),.52,2.1,(side*.55,.1),2)
        biolume(p,f'EntryGrowth{side+1}',(side*(rx-.6),-ry*.67,.18),.65)
    ribbon(p,'PortalLintel',(-3.15,-ry*.94,3.6),(3.15,-ry*.94,3.6),1.4,.45,1,True)
    slab(p,'HollowHallCanopy',polygon(rx*.82,ry*.82,12,.13),.18+height*.51,.18+height*.57,0,True)
    # A single leaning roof crystal, then smaller, nonuniform siblings for individual silhouettes.
    for k in range(5+seed%3):
        a=seed*.7+k*2.39996
        r=(rx*.28 if seed%4==1 else .4) if k==0 else rx*.48
        z=.18+height*.57
        socket_cluster(p,f'Crown{k}',(r*math.cos(a),r*ry/rx*math.sin(a)+ry*.12,z),
                       rx*(.28 if k==0 else .13),height*(.43 if k==0 else .28)*(1-.04*k),5,a,False)
    # Floor-level faceted alcoves at the sides; main corridor remains traversable.
    for side in (-1,1):
        for i in range(3):
            slab(p,f'ListeningBench{side+1}_{i}',[(side*(rx-2),-1+i),(side*(rx-.9),-.8+i),
                (side*(rx-.9),-.3+i),(side*(rx-2),-.45+i)],.18,.63,7)
    p.openings.append(dict(center=[0,-ry*.94,.18],width=3.6,height=3.42,axis='Y'))
    p.routes.append(dict(points=[[0,-ry-2,.18],[0,0,.18]],width=3,height=3.2))
    p.marker('Interact_Service',(0,-ry+.8,1.28),service=p.role)


def residence(p,band,i):
    if band=='low':rx,ry,h=5.2+i*.35,5.8+i*.25,[7.8,9.6,11.4,13.2][i]
    elif band=='mid':rx,ry,h=7+i*.7,8+i*.4,[25,34,44,55][i]
    else:rx,ry,h=11+i*.7,12+i*.5,[180,225,275,325][i]
    hall(p,rx,ry,h,i)


def plaza(p,rx=24,ry=24,z=0):
    slab(p,'SummitTerrace',polygon(rx,ry,36),z,z+.18,7)
    for j in range(18):
        a=j*TAU/18
        if j in (12,13,14,15):continue
        xy=(math.cos(a)*rx*.87,math.sin(a)*ry*.87,z+.18)
        socket_cluster(p,f'MemoryPier{j}',xy,1.15,4.2+.6*math.sin(j),6,a,True)
        p.marker(f'Light_MemoryPier{j}',(xy[0],xy[1],z+2.8),color='#64E3FF',intensity=.85,distance=9)
    # Broken radial facets in the plaza paving and an empty 12m anchor socket.
    for j in range(36):
        a=j*TAU/36; b=a+.08
        xy=[(math.cos(a)*r,math.sin(a)*r) for r in (6.2,rx*.81)]
        xy += [(math.cos(b)*r,math.sin(b)*r) for r in (rx*.81,6.2)]
        slab(p,f'PavingInlay{j}',xy,z+.1802,z+.185,3,False)
    p.routes.append(dict(points=[[0,-ry,z+.18],[0,-6.4,z+.18]],width=3,height=3.2))
    p.marker('Interact_Plaza',(0,-7,z+1.28),service='recall_assembly')


def yard(p,salvage=False):
    rx=22 if salvage else 28; p.pad=24 if salvage else 36
    slab(p,'YardShelf',polygon(rx,rx*.90,24),0,.18,7)
    for j in range(36):
        a=j*TAU/36
        if math.sin(a)<-.7:continue
        socket_cluster(p,f'YardSocket{j}',(rx*.89*math.cos(a),rx*.8*math.sin(a),.18),.62,
                       2.6+(j%5)*.42,4,a,True)
    # Docking limit is a grown inlay; no fasteners or generic technical gantries.
    for j in range(48):
        a=j*TAU/48; b=a+TAU/48*.82; r=p.pad/2
        ribbon(p,f'PadRim{j}',(r*math.cos(a),r*math.sin(a),.181),(r*math.cos(b),r*math.sin(b),.181),.15,.012,4)
    for side in (-1,1):
        biolume(p,f'YardMouth{side+1}',(side*4,-rx*.72,.18),1)
        for k in range(4):
            stone_shard(p,f'YardStore{side+1}_{k}',(side*(rx-2),k*2-2,.18),1.1,.7,1.4,1,True,10)
            crystal(p,f'StoredMemory{side+1}_{k}',(side*(rx-2),k*2-2,1.3),.52,1.1,(side*.3,0),2)
    p.marker('Interact_Yard',(0,-rx*.70,1.28),service=p.role)
    p.marker('BAY_Listener' if salvage else 'BAY_Shipyard',(0,0,.18),padDiameter=p.pad)
    p.routes.append(dict(points=[[0,-rx*.90,.18],[0,0,.18]],width=3,height=3.2))


def bridge(p,length=24,width=4.2,z=0):
    # One continuous, thick-grown crystal with rhombic undersides and chipped edge scales.
    segments=24
    for j in range(segments):
        y0=-length/2+j*length/segments; y1=y0+length/segments
        rise0=.18+z+.50*math.sin(math.pi*j/segments)
        rise1=.18+z+.50*math.sin(math.pi*(j+1)/segments)
        slab(p,f'CrystalDeck{j}',[(-width/2,y0),(width/2,y0),(width/2,y1),(-width/2,y1)],z,[rise0,rise0,rise1,rise1],2,True)
        for side in (-1,1):
            # Continuous faceted rail slab, exactly 1.05m above the local deck; shard cutouts stay outside it.
            ribbon(p,f'BridgeRail{side+1}_{j}',(side*(width/2+.15),y0,rise0),(side*(width/2+.15),y1,rise1),.26,1.05,3,True)
            if j%2==0:
                crystal(p,f'BridgeEdge{side+1}_{j}',(side*(width/2+.36),y0,z),.24,1.2,(side*.5,.2),2)
    for end in (-1,1):
        for side in (-1,1):
            socket_cluster(p,f'Abutment{end+1}_{side+1}',(side*(width/2+.65),end*(length/2-.7),z),.55,2.8,4,.2,True)
    p.routes.append(dict(points=[[0,-length/2,z+.18],[0,0,z+.68],[0,length/2,z+.18]],width=3,height=3.2))
    p.marker('Interact_Crossing',(0,-length/2+1,z+1.28))
    p.marker('Light_BridgeHeart',(0,0,z+.8),color='#64E3FF',intensity=1.1,distance=10)


def spiral(p,turns=1,radius=9,rise=6,z=0,detail=True):
    count=int(turns*64); width=3.8
    points=[]
    for j in range(count):
        a=-math.pi/2+j*TAU/64; b=a+TAU/64
        za=z+.18+j*rise/count; zb=z+.18+(j+1)*rise/count
        xy=[(r*math.cos(t),r*math.sin(t)) for t,r in ((a,radius-width/2),(a,radius+width/2),(b,radius+width/2),(b,radius-width/2))]
        slab(p,f'SpiralDeck{j}',xy,min(za,zb)-.4,[za,za,zb,zb],7,True)
        points.append([radius*math.cos(a),radius*math.sin(a),za])
        for side in (-1,1):
            r=radius+side*(width/2+.12)
            ribbon(p,f'SpiralRail{side+1}_{j}',(r*math.cos(a),r*math.sin(a),za),(r*math.cos(b),r*math.sin(b),zb),.22,1.05,3,True)
        if detail and j%8==0:
            r=radius+width/2+.75
            socket_cluster(p,f'SpiralGrowth{j}',(r*math.cos(a),r*math.sin(a),za-.3),.6,2.4,4,a,False)
            p.marker(f'Light_Spiral{j}',(r*math.cos(a),r*math.sin(a),za+.6),color='#64E3FF',intensity=.6,distance=7)
    points.append([radius*math.cos(b),radius*math.sin(b),zb])
    p.routes.append(dict(points=points,width=3,height=3.2,kind='spiral',railHeight=1.05))
    p.marker('Interact_Ascent',points[0][:2]+[points[0][2]+1.1])


def wall(p,corner=False):
    paths=[((-8,0),(8,0))] if not corner else [((-8,0),(0,0)),((0,0),(0,8))]
    for k,(a,b) in enumerate(paths):
        count=7 if corner else 12
        for j in range(count):
            if corner and k==1 and j==0:continue
            t=j/(count-1); x=a[0]+(b[0]-a[0])*t; y=a[1]+(b[1]-a[1])*t
            stone_shard(p,f'WallBed{k}_{j}',(x,y,0),.9,.65,2.6+.16*math.sin(j),0,True,6)
            socket_cluster(p,f'WallCrest{k}_{j}',(x,y,2.1),.42,1.25+.25*(j%3),3,j,False)


def gate(p):
    for side in (-1,1):
        socket_cluster(p,f'GateSpire{side+1}',(side*4,0,0),1.3,10.5 if side<0 else 8.3,9,side,True)
        for k in range(4):
            stone_shard(p,f'GateSocketBed{side+1}_{k}',(side*(3.4+k*.6),.3*k,0),.6,.8,2.4,1,True,8)
    ribbon(p,'CrownBridge',(-4.7,0,4.7),(4.7,0,4.7),2.1,.8,2,True)
    for j in range(8):
        crystal(p,f'GateCrownFacet{j}',(-3.8+j,0,5.3),.35,1.6+(j%3)*.3,(.2,.1),3)
    slab(p,'GateThreshold',[(-3,-3),(3,-3),(3,3),(-3,3)],0,.18,7)
    p.openings.append(dict(center=[0,0,.18],width=4.4,height=4.5,axis='Y'))
    p.routes.append(dict(points=[[0,-3,.18],[0,3,.18]],width=3,height=3.2))
    p.marker('Interact_Gate',(0,-2,1.28))


def prop(p,kind):
    if kind=='stall':
        for side in (-1,1):socket_cluster(p,f'StallPost{side+1}',(side*1.6,.3,0),.4,2.9,4,side,True)
        ribbon(p,'GrownAwning',(-1.8,.3,2.7),(1.8,.3,2.7),2,.25,2,True)
        slab(p,'Counter',[(-1.4,-.2),(1.4,-.2),(1.2,.65),(-1.2,.65)],0,.95,1)
        for j in range(7):socket_cluster(p,f'Offerings{j}',(-1.2+j*.4,.12,.95),.13,.5,3,j)
        p.marker('Interact_Vendor',(0,-1,1.1))
    elif kind=='seat':
        slab(p,'Seat',[(-1.4,-.4),(1.4,-.4),(1.55,.35),(-1.45,.45)],0,.45,7)
        for side in (-1,1):socket_cluster(p,f'SeatArm{side+1}',(side*1.35,.1,0),.24,.8,4,side,True)
        for j in range(9):crystal(p,f'SeatBack{j}',(-1.2+j*.3,.43,.3),.16,1+.13*math.sin(j),(.05,.1),3)
        p.marker('Interact_Seat',(0,-.75,.95))
    elif kind=='basin':
        for j in range(12):
            a=j*TAU/12
            stone_shard(p,f'BasinRim{j}',(.7*math.cos(a),.7*math.sin(a),0),.23,.23,.48,1,True,5)
        for j in range(8):
            a=j*2.4;socket_cluster(p,f'BiolumeColony{j}',(.35*math.cos(a),.35*math.sin(a),.15),.18,.7,3,a)
        p.marker('Light_Colony',(0,0,.7),color='#64E3FF',intensity=.8,distance=5)
        p.marker('Interact_Basin',(0,-1.1,1))
    else:
        stone_shard(p,'MemoryLectern',(0,0,0),.9,.5,1.1,1,True,12)
        for j in range(9 if kind=='board' else 6):
            x=(j-4)*.22 if kind=='board' else (j-2.5)*.24
            socket_cluster(p,f'MemoryFacet{j}',(x,.1,1),.17,1.8 if kind=='board' else .9,3,j*.7)
        for j in range(8):
            ribbon(p,f'RecordedStroke{j}',(-.65+j*.17,-.47,1.1),(-.56+j*.17,-.47,1.4+(j%3)*.12),.025,.015,6)
        p.marker('Interact_QuestBoard' if kind=='board' else 'Interact_Memory',(0,-.9,1.1))
        p.marker('Light_Memory',(0,-.1,1.6),color='#B9A6FF',intensity=.7,distance=4)


def landmark(p,summit=False):
    if summit:
        # Four turns, 48m of actual continuous ascent to a small summit plaza; no teleporter stand-in.
        stone_shard(p,'HollowMountainSocket',(0,0,0),9.8,9.2,47.7,0,True,54)
        spiral(p,4,15,48)
        plaza(p,12,12,48)
        # The spiral finishes at (0,-15); the radial landing reaches the summit terrace.
        slab(p,'SummitLanding',[(-1.9,-17),(1.9,-17),(1.9,-10),(-1.9,-10)],47.78,48.18,7)
        for j in range(52):
            a=j*2.39996; z=2+(j%13)*3.3
            socket_cluster(p,f'MountainGrowth{j}',(9.2*math.cos(a),8.8*math.sin(a),z),.7,4.5+j%4,5,a,False)
        p.marker('Interact_Summit',(0,-9,49.28),service='summit_plaza')
    else:
        hall(p,15,16,112,3,True)
        # A cleft spire choir with two high, offset growths and memory shelves cut into the sides.
        for side in (-1,1):
            for k in range(32):
                a=(k/32)*TAU
                socket_cluster(p,f'ChoirGrowth{side+1}_{k}',(side*13+2*math.cos(a),3+4*math.sin(a),4+k*2.6),
                               1.0+(k%3)*.2,8+(k%5),5,a,False)


def anchor(p):
    # The Cartographer anchor is basalt, not an Ixari crystal: five unequal broken blades and cut glyphs.
    for j,(x,y,rx,ry,h) in enumerate(((-1.8,0,2.1,2.4,49),(1.4,.7,1.8,2.0,43),(.1,2.4,1.7,1.5,52),
                                     (-3.2,2.1,1.0,1.3,33),(3.0,2.2,1.2,1.2,37))):
        stone_shard(p,f'AnchorBlade{j}',(x,y,0),rx,ry,h,5,True,130)
        for k in range(22):
            # Paired/forked strokes on the oblique face form a vertical archive rather than random sci-fi runes.
            z=3+k*1.6
            gy=y-ry*(1-.30*z/h)-.06
            ribbon(p,f'GlyphStem{j}_{k}',(x-.22,gy,z),(x+.18,gy+.30*ry*.6/h,z+.6),.05,.025,6)
            if k%3!=1:ribbon(p,f'GlyphFork{j}_{k}',(x+.03,gy,z+.36),(x+.40,gy,z+.42),.05,.025,6)
    for j in range(42):
        a=j*2.39996; r=4.8+(j%5)*.48
        # Detached rubble skirts only the side and back; the approach to the hum is open.
        if math.sin(a)<-.55:continue
        stone_shard(p,f'FallStone{j}',(r*math.cos(a),r*math.sin(a),0),.65,.55,1.2+(j%5)*.7,5,True,28)
        socket_cluster(p,f'ResonantGrowth{j}',(r*math.cos(a),r*math.sin(a),.25),.42,2.8+j%3,5,a)
    p.marker('Interact_Anchor',(0,-3.9,1.1),service='memory_dive_recall')
    p.marker('Light_Anchor',(0,-2.5,22),color='#D8F6FF',intensity=1.1,distance=12)
    p.routes.append(dict(points=[[0,-9,0],[0,-3.9,0]],width=3,height=3.2))


def references():
    ref=bpy.data.collections.new('REF');bpy.context.scene.collection.children.link(ref)
    v=[(x,y,0) for x in range(-10,11) for y in range(-10,11)]
    edges=[]
    for x in range(21):
        for y in range(21):
            if x<20:edges.append((x*21+y,(x+1)*21+y))
            if y<20:edges.append((x*21+y,x*21+y+1))
    me=bpy.data.meshes.new('REF_Grid');me.from_pydata(v,edges,[])
    ob=bpy.data.objects.new('REF_Grid',me);ref.objects.link(ob);ob.hide_render=True
    # Actual reference biped mesh with separate legs and arms, not a single measuring stick.
    bv=[];bf=[]
    for xyz,rx,ry,h in (((-.13,0,0),.09,.10,.88),((.13,0,0),.09,.10,.88),
                         ((0,0,.83),.26,.14,.59),((0,0,1.44),.13,.12,.41),
                         ((-.34,0,.88),.075,.09,.50),((.34,0,.88),.075,.09,.50)):
        xy=polygon(rx,ry,8); start=len(bv)
        bv += [(x+xyz[0],y+xyz[1],xyz[2]+z) for z in (0,h) for x,y in xy]
        bf += [tuple(start+i for i in range(8)),tuple(start+i for i in range(8,16))]
        bf += [(start+i,start+(i+1)%8,start+(i+1)%8+8,start+i+8) for i in range(8)]
    ob=mesh_object('REF_Biped',bv,bf,ref);ob.hide_render=True
    ref.hide_render=True


GROUPS={
 'low': [('ixari_low_'+str(i),'low',t,'building',lambda p,i=i:residence(p,'low',i)) for i,t in enumerate(('Cleft Hearth','Paired Memory','Terrace Nest','Slanted Crown'))],
 'mid': [('ixari_mid_'+str(i),'mid',t,'building',lambda p,i=i:residence(p,'mid',i)) for i,t in enumerate(('Listening Stack','Forked Archive','Violet Steps','Cloud Gallery'))],
 'tall':[('ixari_tall_'+str(i),'tall',t,'building',lambda p,i=i:residence(p,'tall',i)) for i,t in enumerate(('First Hum','Split Witness','High Memory','Last Listener'))],
 'civic':[
 ('ixari_plaza','plaza','Summit Gathering','building',lambda p:plaza(p)),
 ('ixari_market_hall','market','Hollow Exchange','building',lambda p:hall(p,11,13,23,0,True)),
 ('ixari_skill_house','skill','Resonance House','building',lambda p:hall(p,8,10,18,1,True)),
 ('ixari_compact_office','compact','Passage Archive','building',lambda p:hall(p,10,12,28,2,True)),
 ('ixari_listening_house','listening','House of Kept Voices','building',lambda p:hall(p,12,11,35,3,True)),
 ('ixari_shipyard','shipyard','Listener Ship Shelf','building',lambda p:yard(p)),
 ('ixari_salvage_yard','salvage','Found Memory Yard','building',lambda p:yard(p,True))],
 'kit':[
 ('gate_ixari','gate','Cleft Gate','kit',gate),
 ('wall_ixari_straight','wall','Socket Wall','kit',lambda p:wall(p)),
 ('wall_ixari_corner','wall_corner','Turned Socket Wall','kit',lambda p:wall(p,True)),
 ('bridge_ixari','bridge','Single Growth Crossing','kit',bridge),
 ('kit_ixari_spiral','spiral_street','Ascending Memory Street','kit',spiral),
 ('lamp_ixari_biolume','lighting','Bioluminescent Growth','kit',lambda p:biolume(p,'Wayfinding',(0,0,0),1.6,True))],
 'props':[(f'prop_ixari_{key}',key,title,'prop',lambda p,k=key:prop(p,k)) for key,title in
          (('terminal','Memory Lectern'),('board','Passage Quest Board'),('stall','Crystal Vendor'),('seat','Listening Seat'),('basin','Biolume Basin'))],
 'landmarks':[
 ('ixari_landmark_spire_hall','spire_landmark','The Cleft Choir','hero',lambda p:landmark(p)),
 ('ixari_landmark_summit','summit_landmark','Spiral of Kept Voices','hero',lambda p:landmark(p,True))],
 'anchor':[('anchor_quavel','anchor','The Stone That Remembers','hero',anchor)]
}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('group',choices=GROUPS)
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc=bpy.context.scene;sc.unit_settings.system='METRIC';sc.unit_settings.scale_length=1
    sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.render.threads_mode='FIXED';sc.render.threads=2
    res=RULES['classes'][GROUPS[args.group][0][3]]['texture']
    mat=material(res);references();inventory=[]
    for asset,role,title,cls,fn in GROUPS[args.group]:
        p=Piece(asset,role,title,cls,mat);fn(p);inventory.append(p.finish())
    source=ROOT/f'assets/blend/cities/ixari_{args.group}.blend'
    sc['task']='P1.E10.T06';sc['authoring']='Editable saved sculpt; stock exporter consumes this file, never this author script'
    sc['cpu_only']='CPU source iteration; not GPU visual PASS'
    bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
    for asset in inventory:
        asset.update(source=str(source.relative_to(ROOT)),glb=f'packages/client/public/models/cities/ixari_{args.group}.glb',
                     sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest())
    out=TASK/'inventory';out.mkdir(parents=True,exist_ok=True)
    (out/(args.group+'.json')).write_text(json.dumps(inventory,indent=2)+'\n')
    print('SAVED',source,flush=True)


if __name__=='__main__':main()
