"""P1.E08.T08 authoring session. Saved meshes are the source; export never calls this.

The station contours below describe sculpted anatomical sections, shell panels, and
joint loops. Each part remains an editable vertex group in the saved mesh.
"""
import bpy
import bmesh
import json
import math
import sys
from pathlib import Path
import numpy as np
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
TAU = math.tau
P = (1, 0, 0, 1)
S = (0, 1, 0, 1)
A = (0, 0, 1, 1)
DARK = (0, 0, 1, .07)
INVENTORY = {
 'quad_heavy': ['0', '0_charge', '0_stomp', '1', '1_charge', '1_stomp'],
 'quad_grazer': ['0', '0_kick', '1', '1_kick'],
 'quad_small': ['0', '0_bite_swarm', '1', '1_bite_swarm', 'predator', 'predator_bite_swarm'],
 'biped': ['0', '0_leap', '0_claw_combo', '1', '1_leap', '1_claw_combo', 'predator', 'predator_leap', 'predator_claw_combo'],
 'flyer': ['0', '0_dive', '0_screech', '1', '1_dive', '1_screech', 'predator', 'predator_dive', 'predator_screech'],
 'outpost_drone': [''], 'outpost_overseer': ['', 'dome', 'core']}

def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c

def interp(stations, steps):
    a = np.asarray(stations, dtype=float)
    out = []
    for t in np.linspace(0, len(a)-1, steps):
        i = min(int(t), len(a)-2)
        u = t-i
        p0,p1,p2,p3 = a[max(0,i-1)], a[i], a[i+1], a[min(len(a)-1,i+2)]
        out.append(.5*((2*p1)+(-p0+p2)*u+(2*p0-5*p1+4*p2-p3)*u*u+(-p0+3*p1-3*p2+p3)*u*u*u))
    return out

class Mesh:
    def __init__(self):
        self.v=[]; self.f=[]; self.uv=[]; self.mask=[]; self.limb=[]; self.pivot=[]; self.glow=[]; self.parts={}

    def vertex(self, p, uv, mask, limb, pivot, glow=0):
        self.v.append(tuple(p)); self.uv.append(tuple(uv)); self.mask.append(mask)
        self.limb.append(limb); self.pivot.append(pivot); self.glow.append(glow)
        return len(self.v)-1

    def loft(self, name, stations, axis='Y', sides=32, steps=30, limb=0, pivot=(0,0,0),
             mask=P, tile=0, sculpt=0, ribs=0, glow=0):
        start=len(self.v)
        rows=interp(stations, steps)
        for j, row in enumerate(rows):
            x,y,z,rx,ry=row
            rx=max(.0001,rx); ry=max(.0001,ry)
            for k in range(sides):
                a=TAU*k/sides; c=math.cos(a); s=math.sin(a); t=j/(steps-1)
                # Shaped muscle beds, not surface noise: paired lateral muscles,
                # dorsal tendon, and inset abdominal groove.
                relief=1+sculpt*(.13*math.cos(2*a)*math.sin(math.pi*t)**2+.055*math.cos(6*a))
                relief*=1+ribs*.045*math.sin(18*math.pi*t)**4
                if axis=='Y': p=(x+rx*c*relief,y,z+ry*s*relief)
                elif axis=='Z': p=(x+rx*c*relief,y+ry*s*relief,z)
                else: p=(x,y+rx*c*relief,z+ry*s*relief)
                col=mask(t,a,p) if callable(mask) else mask
                uv=((tile%4+.04+.92*k/sides)/4,(tile//4+.04+.92*t)/4)
                self.vertex(p,uv,col,limb,pivot,glow)
        for j in range(steps-1):
            for k in range(sides):
                n=start+j*sides+k; nn=start+j*sides+(k+1)%sides
                self.f.append((n,nn,nn+sides,n+sides))
        self.f.append(tuple(start+k for k in reversed(range(sides))))
        self.f.append(tuple(start+(steps-1)*sides+k for k in range(sides)))
        self.parts[name]=(start,len(self.v))

    def tube(self,name,points,radii,**kw):
        start=len(self.v); sides=kw.pop('sides',16); steps=kw.pop('steps',18)
        limb=kw.pop('limb',0); pivot=kw.pop('pivot',(0,0,0)); mask=kw.pop('mask',P); tile=kw.pop('tile',2)
        glow=kw.pop('glow',0)
        rows=interp([(*p,r,r) for p,r in zip(points,radii)],steps)
        for j,row in enumerate(rows):
            tangent=Vector(rows[min(j+1,steps-1)][:3])-Vector(rows[max(0,j-1)][:3]); tangent.normalize()
            b=tangent.cross(Vector((0,0,1)))
            if b.length<.1: b=tangent.cross(Vector((0,1,0)))
            b.normalize(); c=tangent.cross(b).normalized()
            for k in range(sides):
                a=TAU*k/sides; r=float(max(.0002,row[3])*(1+.04*math.sin(j*2.1)**4))
                p=Vector(row[:3])+r*(b*math.cos(a)+c*math.sin(a))
                self.vertex(p,((tile%4+.05+.9*k/sides)/4,(tile//4+.05+.9*j/(steps-1))/4),mask,limb,pivot,glow)
        for j in range(steps-1):
            for k in range(sides):
                n=start+j*sides+k; nn=start+j*sides+(k+1)%sides
                self.f.append((n,nn,nn+sides,n+sides))
        self.f.append(tuple(start+k for k in reversed(range(sides))))
        self.f.append(tuple(start+(steps-1)*sides+k for k in range(sides)))
        self.parts[name]=(start,len(self.v))

    def object(self,name,coll,material,creature=True):
        me=bpy.data.meshes.new(name+'_editable'); me.from_pydata(self.v,[],self.f); me.update()
        bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(me); bm.free()
        uv=me.uv_layers.new(name='PaintAtlas')
        for p in me.polygons:
            p.use_smooth=True
            for li in p.loop_indices: uv.data[li].uv=self.uv[me.loops[li].vertex_index]
        if creature:
            for name_,type_,prop,values in [('_limb','FLOAT','value',self.limb),('_pivot','FLOAT_VECTOR','vector',self.pivot),('_glow','FLOAT','value',self.glow)]:
                a=me.attributes.new(name_,type_,'POINT'); a.data.foreach_set(prop,np.asarray(values,dtype=np.float32).ravel())
            a=me.color_attributes.new(name='RegionMask',type='FLOAT_COLOR',domain='POINT')
            a.data.foreach_set('color',np.asarray(self.mask,dtype=np.float32).ravel())
            me.color_attributes.active_color=a; me.color_attributes.render_color_index=0
        o=bpy.data.objects.new(name,me); coll.objects.link(o); me.materials.append(material)
        for label,(a,b) in self.parts.items(): o.vertex_groups.new(name=label).add(list(range(a,b)),1,'REPLACE')
        o['author_task']='P1.E08.T08'; o['source_contract']='Z-up point joints; authored anatomical loops; pose baked in vertices'
        return o

def atlas(stem,construct=False):
    """A packed 2k paint set. Drawn edge abrasions and folds follow the UV panels.

    Tiles are semantic surfaces; no random field or generic noise is used.
    """
    size=2048; yy,xx=np.mgrid[0:size,0:size].astype(np.float32); u=(xx%512)/511; v=(yy%512)/511
    tile=(xx//512+4*(yy//512)).astype(int)
    colours=(['22406A','F4F4F0','F28C28','303B48','1B2D41','8395A5','D3DBDE','805D34',
              '122031','A5B6C9','C56F21','F0CF9A','2C3A44','657781','0D1926','FFFFFF'] if construct else
             ['8A6B4F','D8C6A0','4E3D2F','45382D','D0BA8F','241D19','B28D68','DACCB0',
              '977A5C','BBA184','5C4531','E0C599','715944','9F8664','342A23','D4BC91'])
    pal=np.asarray([[int(c[i:i+2],16)/255 for i in (0,2,4)] for c in colours],np.float32)
    col=pal[tile].copy()
    edge=np.exp(-((u-.07)/.017)**2)+np.exp(-((u-.93)/.018)**2)
    ridge=np.exp(-((v-.18-.12*u)/.02)**2)+.6*np.exp(-((v-.69+.08*u)/.023)**2)
    # Three deliberately placed scar/brush strokes, tapering at their ends.
    scar=np.zeros_like(u)
    for x,y,l in [(.21,.38,.22),(.58,.64,.17),(.71,.24,.12)]:
        scar+=np.exp(-((v-y-.23*(u-x))/.008)**2)*np.clip(1-np.abs(u-x)/l,0,1)
    wear=np.clip(edge*.35+scar*.45,0,.7)
    col=np.clip(col*(1-.14*ridge[:,:,None])+wear[:,:,None]*.11,0,.9)
    rough=np.clip((.43 if construct else .66)+ridge*.12-wear*.20, .25,.9)
    metal=np.clip((.08+wear*.65 if construct else .015+wear*.035),0,1)
    ao=np.clip(1-.24*ridge-.1*edge,.4,1)
    height=.035*ridge-.022*scar
    dv,du=np.gradient(height); nx=-du*160; ny=-dv*160; nz=np.ones_like(nx)
    norm=np.sqrt(nx*nx+ny*ny+nz*nz)
    normal=np.stack((nx/norm*.5+.5,ny/norm*.5+.5,nz/norm*.5+.5),axis=-1)
    images={}
    for key,data in [('base',col),('roughness',rough),('metallic',metal),('normal',normal),('occlusion',ao)]:
        if data.ndim==2: data=np.repeat(data[:,:,None],3,axis=2)
        rgba=np.concatenate((data,np.ones((size,size,1),np.float32)),axis=2)
        im=bpy.data.images.new(stem+'_'+key,width=size,height=size,alpha=False)
        im.colorspace_settings.name='sRGB' if key=='base' else 'Non-Color'
        im.pixels.foreach_set(rgba.ravel()); im.pack(); images[key]=im
    mat=bpy.data.materials.new('CompactPaint' if construct else 'FaunaHide'); mat.use_nodes=True
    nt=mat.node_tree; bs=nt.nodes.get('Principled BSDF')
    for key,socket in [('base','Base Color'),('roughness','Roughness'),('metallic','Metallic')]:
        tex=nt.nodes.new('ShaderNodeTexImage'); tex.image=images[key]; nt.links.new(tex.outputs['Color'],bs.inputs[socket])
    tex=nt.nodes.new('ShaderNodeTexImage'); tex.image=images['normal']; n=nt.nodes.new('ShaderNodeNormalMap'); n.inputs['Strength'].default_value=.45
    nt.links.new(tex.outputs['Color'],n.inputs['Color']); nt.links.new(n.outputs[0],bs.inputs['Normal'])
    grp=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree'); grp.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
    gn=nt.nodes.new('ShaderNodeGroup'); gn.node_tree=grp; tex=nt.nodes.new('ShaderNodeTexImage'); tex.image=images['occlusion']; nt.links.new(tex.outputs['Color'],gn.inputs['Occlusion'])
    return mat

def bodymask(t,a,p):
    belly=max(0,min(1,(-math.sin(a)-.05)*1.6))
    stripe=max(0,min(.8,(math.sin(a)-.88)*6))
    # Two broken bands over the scapula and haunch, readable without textures.
    band=.30 if (.23<t<.29 or .69<t<.74) and math.sin(a)>.02 else 0
    accent=max(stripe,band)
    return (max(0,1-belly-accent),belly,accent,.85+.15*max(0,math.sin(a)))

def leg(m,name,x,y,hip,width,limb,pose='',side=1):
    pivot=(x,y,hip)
    # Explicit hip, 0.62, knee at 0.50, 0.38, ankle at 0.13 and sole loops.
    zs=[1,.88,.72,.62,.55,.50,.45,.38,.27,.24,.18,.13,.10,.055,0]
    ws=[.85,1,.9,.66,.62,.68,.65,.52,.44,.45,.48,.55,.64,.72,.70]
    rows=[]
    for z,w in zip(zs,ws):
        dx=.03*width*math.sin(z*math.pi); dy=.1*width*math.sin(z*TAU)
        zz=hip*z
        if pose=='raised': dy-=hip*.6*(1-z); zz+=hip*.35*(1-z)
        if pose=='drive': dy+=hip*.45*(1-z)
        if pose=='kick': dy+=hip*1.1*(1-z); zz+=hip*.65*(1-z)
        if pose=='reach': dy-=hip*.8*(1-z); zz+=hip*.12*(1-z)
        rows.append((x+dx,y+dy,zz,width*w,width*w*.85))
    m.loft(name,rows,axis='Z',steps=43,sides=24,limb=limb,pivot=pivot,sculpt=.7,
           mask=lambda t,a,p:(.1,.15,.75,.9) if t>.88 else P,tile=3)
    # Divided hoof/toes sit flush at the exact sole, with a sculpted heel lip.
    foot=Vector(rows[-1][:3])
    for i in [-1,1]:
        p=foot+Vector((i*width*.36,-width*.32,0))
        m.loft(name+'_toe'+str(i),[(p.x,p.y+width*.45,p.z+.1*width,width*.20,.08*width),
                     (p.x,p.y,p.z+.25*width,width*.34,.25*width),
                     (p.x,p.y-width*.70,p.z+.12*width,width*.26,.12*width),
                     (p.x,p.y-width*.86,p.z+.06*width,.005,.005)],
               sides=20,steps=15,limb=limb,pivot=pivot,mask=A,tile=3)

def head(m,pos,scale,pivot,kind='grazer',openjaw=False,crest=0):
    x,y,z=pos; w,l,h=scale
    m.loft('Skull_malar_ridge',[(x,y+l*.46,z,w*.32,h*.4),(x,y+l*.15,z+h*.12,w*.92,h*.82),
                 (x,y-l*.20,z+h*.09,w,h),(x,y-l*.58,z-h*.10,w*.70,h*.55),
                 (x,y-l*.98,z-h*.16,w*.65,h*.34),(x,y-l*1.08,z-h*.16,.01,.01)],
           steps=36,sides=36,limb=6,pivot=pivot,mask=bodymask,tile=0,sculpt=.45)
    jawdrop=.8*h if openjaw else .17*h
    m.loft('Mandible_grinding_pad',[(x,y+l*.15,z-h*.35,w*.65,h*.2),
              (x,y-l*.38,z-h*.50-jawdrop*.6,w*.73,h*.25),
              (x,y-l*.97,z-h*.35-jawdrop,w*.61,h*.15),(x,y-l*1.07,z-h*.35-jawdrop,.005,.005)],
           steps=28,sides=28,limb=6,pivot=pivot,mask=S,tile=1,sculpt=.3)
    # Mouth cavity remains a separate inset rather than a dark line painted on a muzzle.
    if openjaw:
        m.loft('Oral_cavity',[(x,y-l*.18,z-h*.4,w*.4,h*.04),(x,y-l*.56,z-h*.42-jawdrop*.25,w*.63,jawdrop*.45),
                              (x,y-l*1.0,z-h*.34-jawdrop*.45,w*.51,jawdrop*.35)],
               steps=18,sides=24,limb=6,pivot=pivot,mask=DARK,tile=5)
    for s in [-1,1]:
        ex=x+s*w*1.01; ey=y-l*.18; ez=z+h*.34
        m.loft('Eye_orbital_rim'+str(s),[(ex-s*w*.09,ey,ez,.04*l,.04*h),(ex,ey,ez,.20*l,.22*h),
                     (ex+s*w*.04,ey,ez,.16*l,.17*h),(ex+s*w*.07,ey,ez,.005,.005)],
               axis='X',sides=24,steps=14,limb=6,pivot=pivot,mask=S,tile=4)
        m.loft('Eye_pupil'+str(s),[(ex+s*w*.055,ey-.01*l,ez,.12*l,.13*h),(ex+s*w*.08,ey-.01*l,ez,.11*l,.12*h),
                     (ex+s*w*.095,ey-.01*l,ez,.005,.005)],axis='X',sides=24,steps=12,limb=6,pivot=pivot,mask=DARK,tile=5)
        m.tube('Eye_catch'+str(s),[(ex+s*w*.099,ey-.05*l,ez+.055*h),(ex+s*w*.10,ey-.05*l,ez+.065*h)],
               [h*.026,h*.02],limb=6,pivot=pivot,mask=S,glow=1,steps=4,sides=8,tile=7)
        # Flattened ear leaf, tilted backward, no antennae.
        m.loft('Ear_leaf'+str(s),[(x+s*w*.6,y+l*.18,z+h*.5,w*.16,h*.1),
                    (x+s*w*1.22,y+l*.32,z+h*.83,w*.31,h*.19),
                    (x+s*w*1.65,y+l*.52,z+h*.96,.003,.003)],steps=21,sides=20,limb=6,pivot=pivot,mask=S,tile=1)
        if kind=='predator':
            for i in range(5):
                yy=y-l*(.38+i*.13); zz=z-h*.33
                m.tube('Fang'+str(s)+'_'+str(i),[(x+s*w*.55,yy,zz),(x+s*w*.49,yy-.03*l,zz-h*(.5 if i==1 else .25))],
                       [w*.07,.001],limb=6,pivot=pivot,mask=S,tile=7,steps=9,sides=10)
        if kind in ('heavy','heavy_broad'):
            path=([(x+s*w*.65,y-l*.3,z+h*.65),(x+s*w*1.15,y-l*.15,z+h*.85),
                   (x+s*w*1.40,y+l*.15,z+h*1.35),(x+s*w*1.20,y+l*.35,z+h*1.72)] if kind=='heavy_broad' else
                  [(x+s*w*.65,y-l*.3,z+h*.65),(x+s*w*.9,y-l*.7,z+h*1.1),
                   (x+s*w*.85,y-l*1.25,z+h*1.1),(x+s*w*.60,y-l*1.45,z+h*.85)])
            m.tube('Brow_horn'+str(s),path,
                   [w*.34,w*.25,w*.12,.001],limb=6,pivot=pivot,mask=S,tile=4,steps=30,sides=24)
    if crest:
        m.loft('Sagittal_crest',[(x,y+l*.3,z+h*.85,w*.18,h*.1),(x,y,z+h*(1+crest),w*.12,h*crest),
                     (x,y-l*.65,z+h*.5,.001,.001)],sides=24,steps=26,limb=6,pivot=pivot,mask=A,tile=2)

def quadruped(stem,which,pose):
    m=Mesh(); pred=which=='predator'; alt=which=='1'
    if stem=='quad_heavy':
        shoulder=3.25 if not alt else 3.85; length=4.7 if not alt else 4.1; w=1.2 if not alt else 1.44; hip=2.15 if not alt else 2.5
    elif stem=='quad_grazer':
        shoulder=1.7 if not alt else 2.12; length=2.8 if not alt else 2.5; w=.55 if not alt else .66; hip=1.23 if not alt else 1.55
    else:
        shoulder=.64 if not alt and not pred else (.92 if alt else .84); length=1.3 if not pred else 1.85; w=.32 if not alt else .40; hip=shoulder*.69
    by=length*.5; z=shoulder*.73
    m.loft('Thorax_abdomen',[(0,by,z,w*.16,w*.20),(0,by*.8,z,w*.8,w*.64),
               (0,by*.4,z,w,z*.39),(0,0,z,w*1.04,z*.45),
               (0,-by*.45,z+.06*shoulder,w*.95,shoulder*.28),
               (0,-by*.77,z+.12*shoulder,w*.8,shoulder*.25),(0,-by,z+.12*shoulder,w*.45,w*.45)],
           steps=72,sides=48,mask=bodymask,tile=0,sculpt=.8)
    for hind,yy in [(False,-length*.30),(True,length*.31)]:
        for s in [-1,1]:
            limb=(3 if s<0 else 4) if hind else (1 if s<0 else 2)
            pp=''
            if pose=='charge': pp='drive' if hind else 'reach'
            if pose=='stomp' and not hind and s<0: pp='raised'
            if pose=='kick' and hind and s>0: pp='kick'
            if pose=='bite_swarm' and not hind and s<0: pp='reach'
            leg(m,('Hind' if hind else 'Fore')+str(s),s*w*.70,yy,hip,w*(.35 if stem=='quad_heavy' else .30),limb,pp,s)
    ny=-length*.43; nz=shoulder*.90
    if stem=='quad_grazer':
        necktip=(0,ny-.42,shoulder*1.42 if not alt else shoulder*1.12)
        m.loft('Neck_dewlap',[(0,ny+.15,nz,w*.52,w*.45),(0,ny-.14,nz+shoulder*.16,w*.42,w*.53),
                      (0,necktip[1],necktip[2],w*.33,w*.38)],steps=32,sides=32,limb=6,pivot=(0,ny,nz),mask=bodymask,tile=1)
        hs=(w*.6,w*1.1,w*.45); kind='grazer'
    else:
        necktip=(0,ny-.16,shoulder*.91)
        if pose in ('charge','bite_swarm'): necktip=(0,ny-.42,shoulder*.76)
        hs=(w*.80,w*1.30,w*.65); kind=('heavy_broad' if alt else 'heavy') if stem=='quad_heavy' else ('predator' if pred else 'small')
        m.loft('Cervical_muscle_bridge',[(0,ny+.18,shoulder*.88,w*.57,w*.53),
                    (0,(ny+necktip[1])*.5,shoulder*.85,w*.52,w*.48),
                    (0,necktip[1]+hs[1]*.21,necktip[2],w*.50,w*.43)],
               sides=24,steps=18,limb=6,pivot=(0,ny,nz),mask=bodymask,tile=0,sculpt=.5)
    head(m,necktip,hs,(0,ny,nz),kind,pose=='bite_swarm',crest=.35 if alt and stem!='quad_heavy' else 0)
    # Broad keratin saddles: horn-like ridges, not stone crystals.
    plates=6 if stem=='quad_heavy' else (4 if alt else 0)
    for i in range(plates):
        yy=-length*.31+i*length*.115; zz=shoulder*(1.04 if i<3 else .94)
        m.loft('Dorsal_saddle_'+str(i),[(0,yy-length*.05,zz,w*.70,w*.03),(0,yy,zz+w*.04,w*.88,w*.15),
                    (0,yy+length*.075,zz-w*.06,w*.66,w*.08),(0,yy+length*.09,zz-w*.09,.01,.01)],
               steps=13,sides=32,mask=A if i%3==1 else P,tile=2)
    tp=(0,by*.84,z)
    m.tube('Counterweight_tail' if pred else 'Tail', [tp,(0,by+.3,z-.08),(0,by+length*(.67 if pred else .35),z*.72),
                 (.12*length,by+length*(.95 if pred else .53),z*.68)],
           [w*.28,w*.20,w*.10,.003],limb=5,pivot=tp,mask=P,tile=0,steps=40,sides=24)
    if pred:
        # A narrow lumbar waist and swept nape quills identify the hunting plan.
        for s in [-1,1]:
            for i in range(4):
                yy=-length*.25+i*.14
                m.tube('Nape_fin'+str(s)+str(i),[(s*w*.4,yy,shoulder),(s*w*.58,yy+.18,shoulder+.12),(s*w*.6,yy+.3,shoulder+.1)],
                       [w*.11,w*.06,.001],mask=A,steps=15,sides=12)
    return m,dict(shoulder=shoulder,hip=hip,role='pack' if pred else 'herd')

def biped(which,pose):
    m=Mesh(); pred=which=='predator'; alt=which=='1'
    height=2.28 if pred else (2.44 if alt else 1.94); hip=height*.47
    w=height*(.19 if alt else .15); z=height*.65
    forward=-.27 if pred else 0
    m.loft('Torso_ribcage',[(0,.20,hip*.88,w*.45,w*.32),(0,.12,hip*1.10,w*.92,w*.75),
                (0,forward,z,w,height*.22),(0,forward-.08,z+height*.18,w*.68,w*.64),
                (0,forward-.15,z+height*.23,w*.30,w*.35)],axis='Z',steps=60,sides=48,mask=bodymask,tile=0,sculpt=.9)
    for s in [-1,1]:
        leg(m,'Weightbearing_leg'+str(s),s*w*.62,.12,hip,w*.52,1 if s<0 else 2,'drive' if pose=='leap' else '')
        ap=(s*w*.85,forward-.04,z+height*.11)
        reach=pose=='leap' or (pose=='claw_combo' and s<0)
        end=(s*w*(1.8 if reach else 1.3),forward-(height*.60 if reach else .18),height*(.72 if reach else .40))
        elbow=(s*w*1.4,forward-(.22 if reach else -.12),height*.62)
        limb=7 if s<0 else 8
        m.tube('Reach_arm'+str(s),[ap,elbow,end],[w*.43,w*.31,w*.22],steps=38,sides=28,limb=limb,pivot=ap,mask=P,tile=0)
        for k in range(3):
            p=Vector(end)+Vector(((k-1)*w*.16,0,0))
            q=p+Vector((s*.035,-height*(.16 if pred else .09),-.04)); r=q+Vector((0,.015,-height*.08))
            m.tube('Articulated_digit'+str(s)+str(k),[p,q,r],[w*.095,w*.065,.001],steps=20,sides=16,limb=limb,pivot=ap,mask=A,tile=3)
    hp=(0,forward-.10,height*.81)
    m.loft('Cervical_column',[(0,forward,height*.78,w*.42,w*.35),(0,forward-.16,height*.89,w*.32,w*.36)],
           axis='Z',steps=20,sides=28,limb=6,pivot=hp,mask=P,tile=0)
    head(m,(0,forward-.25,height*.89),(w*.69,w*(1.35 if pred else .95),height*.085),hp,
         kind='predator' if pred else 'grazer',openjaw=pose in ('leap','claw_combo'),crest=.2 if alt else 0)
    tp=(0,.2,hip*1.1)
    m.tube('Counterweight_tail',[tp,(0,.68,hip*.90),(0,1.3 if pred else .95,hip*.62),(.16,1.8 if pred else 1.12,hip*.52)],
           [w*.47,w*.33,w*.14,.001],limb=5,pivot=tp,mask=P,tile=0,steps=45,sides=28)
    for i in range(6):
        zz=height*(.53+i*.055)
        m.loft('Dorsal_keel'+str(i),[(0,.22,zz,w*.6,w*.05),(0,.37,zz+height*.025,w*.7,w*.11),
                    (0,.51 if alt else .43,zz-.04,.001,.001)],steps=14,sides=28,mask=S if alt else P,tile=2)
    return m,dict(heightBand=[1.6,2.6],designHeight=height,hip=hip,role='stalker' if pred else 'herd')

def flyer(which,pose):
    m=Mesh(); pred=which=='predator'; alt=which=='1'
    span=4.9 if pred else (3.65 if alt else 2.65); b=span/2; w=span*.075
    m.loft('Flight_thorax',[(0,.62,0,.01,.01),(0,.33,0,w*.65,w*.70),(0,0,0,w,w*.9),
                (0,-.30,.05,w*.78,w*.85),(0,-.49,.06,w*.35,w*.38)],steps=51,sides=40,mask=bodymask,tile=0,sculpt=.8)
    hp=(0,-.40,.08); hz=.17 if pose=='screech' else .05
    head(m,(0,-.50,hz),(w*.56,w*1.15,w*.49),hp,'predator' if pred else 'grazer',pose=='screech',crest=.3 if alt else 0)
    if pred:
        m.tube('Raptor_rostrum',[(0,-.50-w*1.03,hz),(0,-.50-w*1.60,hz+.04),(0,-.50-w*1.65,hz-w*.25)],
               [w*.22,w*.10,.001],steps=14,sides=16,limb=6,pivot=hp,mask=A,tile=3)
    def wing(t):
        sweep=(.32*span if pose=='dive' else .24*span) if pred else (.7 if pose=='dive' else 0)
        leading=-.13-(.16*span if pred else .34)*math.sin(math.pi*t)+sweep*t**1.6
        chord=(.24+span*(.15 if pred else .23)*math.sin(math.pi*t)**.60)*(1-.7*t)
        return leading,chord
    for s in [-1,1]:
        pivot=(s*w*.72,-.12,.04); limb=7 if s<0 else 8
        start=len(m.v); nu=55; nv=27
        for side in [-1,1]:
            for i in range(nu):
                t=i/(nu-1); x=s*(w*.72+(b-w*.72)*t)
                leading,chord=wing(t)
                for j in range(nv):
                    v=j/(nv-1)
                    scallop=(.055*span*math.sin(5*math.pi*t)**2)*v**6
                    y=leading+chord*v-scallop
                    z=.06+span*.055*math.sin(math.pi*t)-span*.035*t+(span*.15*t if pose=='screech' else 0)
                    z+=.035*span*math.sin(math.pi*v)*math.sin(math.pi*t)+side*.008*span*math.sin(math.pi*v)*math.sin(math.pi*t)
                    band=.75 if v>.72 or (.40<t<.45) else .08
                    mask=(1-band,band*.7,band*.3,.85+.15*(1-v))
                    m.vertex((x,y,z),((1+.04+.92*t)/4,(2+.04+.92*v)/4),mask,limb,pivot)
        for layer in range(2):
            off=start+layer*nu*nv
            for i in range(nu-1):
                for j in range(nv-1):
                    a=off+i*nv+j; face=(a,a+nv,a+nv+1,a+1)
                    m.f.append(face if layer==0 else face[::-1])
        # Seam the upper/lower membrane surfaces at their contour.
        contour=list(range(nv))+[i*nv+nv-1 for i in range(1,nu)]+[(nu-1)*nv+j for j in reversed(range(nv-1))]+[i*nv for i in reversed(range(1,nu-1))]
        for a,c in zip(contour,contour[1:]+contour[:1]): m.f.append((start+a,start+c,start+c+nu*nv,start+a+nu*nv))
        m.parts['Membrane_'+str(s)]=(start,len(m.v))
        for k,t in enumerate([.23,.46,.69,.88]):
            x=s*(w*.72+(b-w*.72)*t); leading,chord=wing(t)
            zz=.06+span*.055*math.sin(math.pi*t)-span*.035*t+(span*.15*t if pose=='screech' else 0)
            m.tube('Wing_digit'+str(s)+str(k),[pivot,(x,leading,zz),(x,leading+chord*.9,zz)],
                   [w*.13,w*.07,.002],steps=21,sides=12,limb=limb,pivot=pivot,mask=A,tile=2)
        if pred:
            for k,t in enumerate([.61,.70,.79,.87]):
                x=s*(w*.72+(b-w*.72)*t); leading,chord=wing(t)
                zz=.06+span*.055*math.sin(math.pi*t)-span*.035*t+(span*.15*t if pose=='screech' else 0)
                m.loft('Primary_vane'+str(s)+str(k),[(x,leading+chord*.55,zz,.075,.015),
                            (x+s*.05,leading+chord*.95,zz,.10,.025),
                            (x+s*.20,leading+chord+.31,zz-.02,.002,.002)],steps=14,sides=12,limb=limb,pivot=pivot,mask=A,tile=2)
        foot=(s*w*.55,-.26 if pose=='dive' else .28,-w*.9)
        m.tube('Tarsus'+str(s),[(s*w*.6,.18,0),foot],[w*.12,w*.09],steps=13,sides=16,limb=1 if s<0 else 2,pivot=(s*w*.6,.18,0),mask=P)
        for k in range(3):
            p=Vector(foot)+Vector(((k-1)*w*.16,0,0))
            m.tube('Talon'+str(s)+str(k),[p,p+Vector((0,-w*(.75 if pred else .45),-w*.12)),p+Vector((0,-w*(.8 if pred else .48),-w*(.65 if pred else .40)))],
                   [w*.08,w*.06,.001],steps=13,sides=12,limb=1 if s<0 else 2,pivot=(s*w*.6,.18,0),mask=A,tile=3)
    m.tube('Steering_tail',[(0,.35,0),(0,.75,-.02),(0,1.05,-.06)],[w*.4,w*.2,.002],steps=29,sides=24,limb=5,pivot=(0,.35,0),mask=P)
    return m,dict(span=span,role='diver' if pred else 'herd')

def radial_panel(m,name,angle,r0,r1,z,width,tile=0,raised=0):
    start=len(m.v)
    sides,steps=(8,5) if name.startswith('Heat_sink') else ((12,10) if name.startswith('Thermal') else (20,17))
    m.loft(name,[(0,r0,z,width*.60,.04),(0,r0+(r1-r0)*.16,z+.1,width,.12),
                  (0,(r0+r1)*.5,z+.16+raised,width*.98,.16),(0,r1-.1,z+raised,width*.72,.08),(0,r1,z+raised,.005,.005)],
           sides=sides,steps=steps,tile=tile)
    rot=Matrix.Rotation(angle,3,'Z')
    for i in range(start,len(m.v)): m.v[i]=tuple(rot@Vector(m.v[i]))

def construct(stem,phase):
    m=Mesh(); big=stem=='outpost_overseer'; radius=11.8 if big else 1.22; unit=radius/1.22
    # Geometry authored at the drone scale, then the pad machine receives its
    # own radial deck, phase vents, dome cage, and multi-laser perimeter.
    if not big:
        m.loft('Pressure_shell',[(0,.81,0,.05,.05),(0,.65,.02,.65,.30),(0,.12,.05,.85,.42),
                    (0,-.48,.08,.65,.35),(0,-.85,.04,.31,.20),(0,-.96,.02,.01,.01)],steps=63,sides=48,tile=0,sculpt=.25)
        for s in [-1,1]:
            for j in range(3):
                start=len(m.v); yy=.42-j*.39
                m.loft('Lapped_shell_'+str(s)+str(j),[(s*.54,yy+.22,.22,.10,.04),(s*.79,yy,.28,.29,.13),
                         (s*.91,yy-.22,.17,.21,.06),(s*.91,yy-.26,.16,.001,.001)],steps=26,sides=28,tile=1 if j==1 else 0)
            # Open triangular chassis members under the shell, with clear negative space.
            for j in range(3):
                a=(s*.45,.5-j*.4,-.19); b=(s*1.13,.3-j*.4,-.30); c=(s*.55,.1-j*.4,-.19)
                m.tube('Lattice_A'+str(s)+str(j),[a,b],[.055,.045],steps=13,sides=12,tile=5)
                m.tube('Lattice_B'+str(s)+str(j),[b,c],[.045,.055],steps=13,sides=12,tile=5)
            # Duct has an authored rolled rim, throat and recessed stator.
            m.loft('Hover_duct'+str(s),[(s*.98,.23,-.31,.22,.22),(s*.98,.22,-.23,.29,.29),
                      (s*.98,.22,.05,.26,.26),(s*.98,.22,.1,.22,.22)],axis='Z',steps=30,sides=40,tile=3)
            for k in range(9):
                a=TAU*k/9
                m.tube('Stator'+str(s)+str(k),[(s*.98,.22,-.32),(s*.98+.23*math.cos(a),.22+.23*math.sin(a),-.32)],
                       [.018,.026],steps=9,sides=8,tile=5)
        m.loft('Crystal_sensor_frame',[(0,-.72,.25,.3,.12),(0,-.82,.29,.27,.14),(0,-.92,.27,.18,.08)],steps=20,sides=12,tile=2)
        m.loft('Crystal_sensor_window',[(0,-.925,.28,.16,.065),(0,-.96,.28,.14,.05)],steps=10,sides=12,tile=4)
        muzzle=(0,-1.33,-.18)
        m.loft('Pulse_laser_shroud',[(0,-.32,-.15,.22,.18),(0,-.55,-.18,.19,.16),(0,-1.17,-.18,.12,.12),
                    (0,-1.29,-.18,.14,.14),(0,-1.33,-.18,.09,.09)],steps=42,sides=32,tile=3,ribs=1)
        m.loft('Pulse_laser_aperture',[(0,-1.335,-.18,.085,.085),(0,-1.34,-.18,.065,.065)],steps=8,sides=24,tile=14)
        for j in range(8):
            y=.45-j*.085
            m.loft('Cooling_gill_'+str(j),[(0,y,.4,.19,.01),(0,y-.03,.43,.20,.035),(0,y-.055,.4,.17,.01)],steps=9,sides=24,tile=5)
        return m,dict(longestTarget=2.6,muzzles=[muzzle])
    # Pad-scale shell, twelve overlapping sectors, lateral lattice and four lasers.
    m.loft('Central_core_casing',[(0,0,-1.8,2.5,2.5),(0,0,-1.4,3.0,3.0),(0,0,.5,3.15,3.15),
                 (0,0,1.0,2.6,2.6)],axis='Z',steps=36,sides=40,tile=3)
    for k in range(12):
        a=TAU*k/12
        radial_panel(m,'Lapped_deck_'+str(k),a,2.3,11.8,-.3,2.5,tile=1 if k%3==0 else 0)
        for side in [-1,1]:
            rot=Matrix.Rotation(a,3,'Z')
            p=rot@Vector((0,3,-1.4)); q=rot@Vector((side*1.6,8.7,-1.7)); r=rot@Vector((0,11,-.35))
            m.tube('Underframe_'+str(k)+str(side),[p,q,r],[.18,.13,.15],steps=12,sides=12,tile=5)
        # Hinged thermal petals give the core phase a changed contour and expose
        # the copper-orange core; closed petals overlap the mouth of the casing.
        radial_panel(m,'Thermal_petal_'+str(k),a,.25 if phase!='core' else 2.7,5.5 if phase=='core' else 3.8,1.05,.81,
                     tile=1 if k%2==0 else 0,raised=1.4 if phase=='core' else 0)
        for j in range(3):
            radial_panel(m,'Heat_sink_'+str(k)+'_'+str(j),a,4.3+j*.48,4.57+j*.48,.0,1.02,tile=3)
    muzzles=[]
    for k in range(4):
        a=TAU*k/4+math.pi/4; rot=Matrix.Rotation(a,3,'Z'); start=len(m.v)
        m.loft('Laser_housing_'+str(k),[(0,6.1,.2,.9,.5),(0,7.5,.5,1.05,.65),(0,9,.4,.7,.44),
                  (0,10.7,.3,.35,.35),(0,11.5,.3,.28,.28)],steps=24,sides=24,tile=0,ribs=1)
        m.loft('Laser_aperture_'+str(k),[(0,11.51,.3,.22,.22),(0,11.55,.3,.18,.18)],steps=8,sides=20,tile=14)
        for i in range(start,len(m.v)): m.v[i]=tuple(rot@Vector(m.v[i]))
        muzzles.append(tuple(rot@Vector((0,11.55,.3))))
    if phase=='core':
        m.loft('Exposed_core',[(0,0,-.4,1.8,1.8),(0,0,1.5,1.7,1.7),(0,0,2.9,1.25,1.25),
                    (0,0,3.4,.6,.6)],axis='Z',steps=32,sides=40,tile=2,ribs=1)
    if phase=='dome':
        for k in range(12):
            a=TAU*k/12
            points=[(math.cos(a)*10.4*math.cos(t),math.sin(a)*10.4*math.cos(t),.1+6.5*math.sin(t)) for t in np.linspace(0,math.pi/2,7)]
            m.tube('Dome_rib_'+str(k),points,[.14,.13,.12,.11,.1,.09,.04],steps=25,sides=12,tile=5)
    return m,dict(longestTarget=24,muzzles=muzzles)

def refs():
    c=collection('REF'); c.hide_render=True
    v=[(x,y,0) for x in range(-10,11) for y in range(-10,11)]; e=[]
    for x in range(21):
        for y in range(21):
            n=x*21+y
            if x<20:e.append((n,n+21))
            if y<20:e.append((n,n+1))
    me=bpy.data.meshes.new('REF_Grid_mesh'); me.from_pydata(v,e,[]); o=bpy.data.objects.new('REF_Grid',me); c.objects.link(o)
    # Human scale silhouette, arms held out, exact feet and crown.
    outline=[(-.13,0),(-.2,.75),(-.19,.99),(-.58,1.18),(-.56,1.28),(-.24,1.4),(-.19,1.51),
             (-.12,1.55),(-.13,1.77),(-.08,1.85),(.08,1.85),(.13,1.77),(.12,1.55),(.19,1.51),
             (.24,1.4),(.56,1.28),(.58,1.18),(.19,.99),(.2,.75),(.13,0),(.045,0),(.04,.7),(-.04,.7),(-.045,0)]
    me=bpy.data.meshes.new('REF_Biped_mesh'); me.from_pydata([(x,0,z) for x,z in outline],[],[tuple(range(len(outline)))])
    o=bpy.data.objects.new('REF_Biped',me); c.objects.link(o)

def collider(coll,name,obj):
    coords=np.asarray([v.co[:] for v in obj.data.vertices]); lo=coords.min(0); hi=coords.max(0)
    verts=[(x,y,z) for x in [lo[0],hi[0]] for y in [lo[1],hi[1]] for z in [lo[2],hi[2]]]
    me=bpy.data.meshes.new(name+'_mesh'); me.from_pydata(verts,[],[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)])
    o=bpy.data.objects.new(name,me); coll.objects.link(o); o.display_type='WIRE'; o.hide_render=True

def main(stem):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version=0
    sc=bpy.context.scene; sc.unit_settings.system='METRIC'; sc.unit_settings.scale_length=1
    sc.render.threads_mode='FIXED'; sc.render.threads=2; sc.render.engine='CYCLES'; sc.cycles.device='CPU'
    refs()
    with bpy.data.libraries.load(str(ROOT/'assets/blend/_library.blend'),link=True) as (src,dst):
        candidates=[n for n in src.materials if n.startswith('LIB_')]
        assert candidates,src.materials
        dst.materials=['LIB_Chitin' if 'LIB_Chitin' in candidates else sorted(candidates)[0]]
    for m in dst.materials:
        if m: bpy.data.objects['REF_Biped'].data.materials.append(m)
    family='constructs' if stem.startswith('outpost') else 'creatures'
    mat=atlas(stem,family=='constructs'); root=collection(stem); records=[]
    for suffix in INVENTORY[stem]:
        vid=stem+('_'+suffix if suffix else '')
        vc=collection(vid,root) if vid!=stem else root
        lod=collection(vid+'_LOD0',vc)
        if family=='constructs': m,notes=construct(stem,suffix)
        else:
            which,*parts=suffix.split('_'); pose='_'.join(parts)
            m,notes=quadruped(stem,which,pose) if stem.startswith('quad') else (biped(which,pose) if stem=='biped' else flyer(which,pose))
            if stem!='flyer':
                # The interpolation of a hoof lip can extend below its control
                # sole by millimetres. Flatten the contact surface, not the rig.
                m.v=[(x,y,max(0,z)) for x,y,z in m.v]
        o=m.object('Anatomy_'+suffix if family=='creatures' else 'Assembly_'+(suffix or 'closed'),lod,mat,family=='creatures')
        # Single box outside LOD0; for the base Overseer a nested unnamed folder
        # is unnecessary: its collider belongs to the asset root by stock schema.
        if stem!='outpost_overseer' or not suffix:
            collider(vc,'COL_Body' if family=='constructs' else 'COL_'+suffix,o)
        if family=='constructs' and (stem!='outpost_overseer' or not suffix):
            for i,p in enumerate(notes['muzzles']):
                e=bpy.data.objects.new('Muzzle_pulse' if stem=='outpost_drone' else 'Muzzle_laser_'+(suffix or 'closed')+'_'+str(i),None); vc.objects.link(e); e.location=p
        if stem=='outpost_overseer' and suffix=='dome':
            glass=bpy.data.materials.new('Glass'); glass.use_nodes=True; bs=glass.node_tree.nodes.get('Principled BSDF')
            bs.inputs['Base Color'].default_value=(.025,.055,.09,.22); bs.inputs['Roughness'].default_value=.12
            bs.inputs['Alpha'].default_value=.16; glass.surface_render_method='DITHERED'
            dm=Mesh(); stations=[]
            for t in np.linspace(0,math.pi/2,24): stations.append((0,0,.1+6.5*math.sin(t),10.4*math.cos(t),10.4*math.cos(t)))
            dm.loft('Shield_membrane',stations,axis='Z',steps=28,sides=64,tile=4)
            dm.object('Shield_optical_surface',lod,glass,False)
        sc.view_layers[0].update()
        tris=sum(len(p.vertices)-2 for obj in lod.objects if obj.type=='MESH' for p in obj.data.polygons)
        bbox=np.asarray(m.v); notes.update(variant=vid,triangles=tris,min=bbox.min(0).tolist(),max=bbox.max(0).tolist())
        records.append(notes)
        print(json.dumps(notes),flush=True)
    path=ROOT/'assets/blend'/family/(stem+'.blend'); path.parent.mkdir(exist_ok=True)
    for lib in bpy.data.libraries: lib.filepath='//../_library.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True,relative_remap=False)
    (HERE/'reports'/('authored-'+stem+'.json')).write_text(json.dumps(records,indent=2)+'\n')

if __name__=='__main__': main(sys.argv[sys.argv.index('--')+1])
