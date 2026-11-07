"""T04 sculpting session. Writes editable sources; the stock exporter never imports this module.

Explicit branching and organ arrangements are the designs. Mesh helpers only tessellate those
arrangements. Each organ remains selectable through a named vertex group in the saved source.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[4]
TAU = math.tau
UP = Vector((0, 0, 1))
KINDS = {
    "round": ["Tidal oak / low buttressed crown", "Forked upland alder / upright twin crown", "Storm oak / swept crown and broken leader"],
    "conifer": ["Spire fir / descending feather boughs", "Coastal cedar / open umbrella whorls", "Weeping spruce / asymmetric hanging skirts"],
    "palm": ["Tidal feather palm / leaning scarred stem", "Bottle fan palm / radial pleated fans"],
    "mushroom": ["Moor parasol / rolled lip and radial gills", "Bellcap / tall folded bell and collar", "Shelf crown / three attached offset caps"],
    "spiral": ["Ascending crozier / open helical stem with pinnae", "Twin fiddlehead / bifurcating unfurling crowns"],
    "coral": ["Antler coral / broad planar branching fan", "Cup coral / ascending hollow growth mouths"],
    "blob": ["Bladder grove / fused lobed fluted column", "Lantern bole / forked hanging seed chambers"],
    "cactus": ["Ribbed candelabrum / unequal elbow branches", "Paddle cactus / jointed flattened pads and fruit"]
}


def curve(points, count):
    p = [Vector(x) for x in points]
    out = []
    for t in np.linspace(0, len(p) - 1, count):
        i = min(int(t), len(p) - 2)
        u = t - i
        a, b, c, d = p[max(i - 1, 0)], p[i], p[i + 1], p[min(i + 2, len(p) - 1)]
        out.append((2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u*u + (-a + 3*b - 3*c + d)*u*u*u) * .5)
    return out


class Sculpt:
    def __init__(self, lod):
        self.lod = lod
        self.v, self.f, self.uv, self.weights, self.groups = [], [], [], [], []

    def part(self, label, verts, faces, uv, region):
        start = len(self.v)
        self.v.extend([tuple(x) for x in verts])
        self.f.extend([tuple(start + i for i in f) for f in faces])
        # Four authored trim regions. Repeated botanical organs share their organ's trim;
        # no geometry AO bake depends on these intentionally shared UVs.
        ox, oy = [(0, .5), (0, 0), (.5, 0), (.5, .5)][region]
        self.uv.extend([(ox + .012 + u*.476, oy + .012 + v*.476) for u,v in uv])
        w = [(1,0,0), (0,1,0), (0,0,1), (.18,.12,.70)][region]
        for x in verts:
            ao = .68 + .30 * (1 - math.exp(-max(0, x[2]) / 1.5))
            self.weights.append((*w, ao))
        self.groups.append((label, start, len(self.v)))

    def tube(self, label, controls, radii, region=1, sides=12, rings=20, ribs=0, depth=.05):
        sides = max(3, int(sides * [1,.70,.45,.28][self.lod]))
        rings = max(len(controls), int(rings * [1,.65,.4,.22][self.lod]))
        p = curve(controls, rings)
        vs, uv, fs = [], [], []
        for i,c in enumerate(p):
            t = i/(rings-1)
            tangent = (p[min(i+1,rings-1)] - p[max(i-1,0)]).normalized()
            side = tangent.cross(Vector((0,1,0))).normalized()
            if side.length < .01:
                side = tangent.cross(Vector((1,0,0))).normalized()
            cross = tangent.cross(side).normalized()
            r = float(np.interp(t, np.linspace(0,1,len(radii)), radii))
            for j in range(sides+1):
                u = j/sides
                a = TAU*u
                rr = r*(1 + depth*math.cos(ribs*a + .8*t) if ribs else 1)
                vs.append(c + (side*math.cos(a) + cross*math.sin(a))*rr)
                uv.append((u,t))
            if i:
                for j in range(sides):
                    k = i*(sides+1)+j
                    fs.append((k-sides-1,k-sides,k+1,k))
        fs.append(tuple(reversed(range(sides))))
        fs.append(tuple((rings-1)*(sides+1)+j for j in range(sides)))
        self.part(label,vs,fs,uv,region)
        return p[-1]

    def shell(self,label,center,profile,region=0,sides=32,lobes=5,flute=.06,stretch=(1,1,1),tilt=0):
        sides = max(5,int(sides*[1,.72,.4,.20][self.lod]))
        # Profile points are deliberately retained: cap lips and bladder waists survive LODs.
        prof = profile if self.lod < 3 else profile[::2] + ([profile[-1]] if len(profile)%2 == 0 else [])
        vs,uv,fs = [],[],[]
        center=Vector(center)
        for i,(r,z) in enumerate(prof):
            for j in range(sides+1):
                a=TAU*j/sides
                rr=r*(1+flute*math.cos(lobes*a + 1.4*i/max(1,len(prof)-1)))
                x=rr*math.cos(a)*stretch[0]
                y=rr*math.sin(a)*stretch[1]
                zz=z*stretch[2] + .035*r*math.sin(3*a)
                vs.append(center+Vector((x*math.cos(tilt)+zz*math.sin(tilt),y,zz*math.cos(tilt)-x*math.sin(tilt))))
                uv.append((j/sides,i/max(1,len(prof)-1)))
                if i and j:
                    k=i*(sides+1)+j
                    fs.append((k-sides-2,k-sides-1,k,k-1))
        fs.append(tuple(reversed(range(sides))))
        fs.append(tuple((len(prof)-1)*(sides+1)+j for j in range(sides)))
        self.part(label,vs,fs,uv,region)

    def leaf(self,label,base,tip,width,region=0,fold=.16,segments=5):
        base,tip=Vector(base),Vector(tip)
        d=tip-base
        side=d.cross(UP).normalized()
        if side.length < .01: side=Vector((1,0,0))
        n=max(2,int(segments*[1,.75,.55,.35][self.lod]))
        vs,uv,fs=[],[],[]
        for i in range(n+1):
            t=i/n
            c=base+d*t+UP*(math.sin(math.pi*t)*fold)
            w=width*math.sin(math.pi*t)**.8 + .002
            for j in (-1,0,1):
                vs.append(c+side*(w*j)-UP*(abs(j)*fold*.6*math.sin(math.pi*t)))
                uv.append(((j+1)/2,t))
            if i:
                k=i*3
                fs.extend([(k-3,k-2,k+1,k),(k-2,k-1,k+2,k+1)])
        self.part(label,vs,fs,uv,region)

    def roots(self,r=0.5,n=5):
        for i in range(n):
            a=TAU*i/n+.22
            d=Vector((math.cos(a),math.sin(a),0))
            self.tube('Root_buttress_%02d'%i,[d*r*.25+UP*.8,d*r*1.3+UP*.28,d*r*2.8+UP*.035],[r*.42,r*.24,.025],sides=10,rings=10,ribs=3,depth=.10)

    def object(self,name,collection,material):
        me=bpy.data.meshes.new(name+'_editable')
        me.from_pydata(self.v,[],self.f)
        me.update()
        o=bpy.data.objects.new(name,me)
        collection.objects.link(o)
        me.materials.append(material)
        uv=me.uv_layers.new(name='BotanicalTrim')
        ca=me.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
        ca.data.foreach_set('color',np.array(self.weights,np.float32).ravel())
        me.color_attributes.active_color=ca
        for p in me.polygons:
            p.use_smooth=True
            for li in p.loop_indices: uv.data[li].uv=self.uv[me.loops[li].vertex_index]
        for label,a,b in self.groups:
            g=o.vertex_groups.new(name=label)
            g.add(list(range(a,b)),1,'REPLACE')
        o['mask_contract']='R leaf/cap; G bark/stem; B flower/gill/fruit; A authored occlusion'
        return o


def round_tree(s,v):
    # A broad oak, upright forked alder, and storm-bent oak have different skeletons.
    cfg=[(4.1,.58,.25,3.25,1.15),(5.2,.40,-.45,2.05,1.85),(3.5,.52,1.8,3.35,.70)][v]
    h,r,lean,span,up=cfg
    s.roots(r)
    end=s.tube('Fluted_bole',[(0,0,0),(-.15,0,h*.32),(lean*.45,.12,h*.7),(lean,0,h)],[r*1.5,r,r*.68,r*.45],rings=30,sides=20,ribs=7,depth=.11)
    sites=[(-.9,-.5,.1),(.8,-.6,.25),(.65,.7,.5),(-.65,.6,.8),(0,.1,1.1)]
    if v==1: sites=[(-.65,-.15,.2),(.55,.12,.6),(-.25,.55,1.25),(.1,-.35,1.65)]
    for k,(x,y,z) in enumerate(sites):
        target=end+Vector((x*span+(v==2)*.6,y*span,z*up+1.1))
        start=end-UP*(.65+.15*k)
        s.tube('Crown_limb_%02d'%k,[start,start.lerp(target,.43)-UP*.15,target],[r*.48,.19,.035],sides=12,rings=18,ribs=3)
        if s.lod==3:
            s.shell('Crown_mass_%02d'%k,target,[(.05,-.45),(1.3,-.2),(1.5,.35),(.95,.9),(.03,1.25)],sides=25,lobes=5,stretch=(1,1,.85))
            continue
        # Each spray has a woody rachis, with alternating folded leaves; no disconnected foliage ball.
        sprays=[8,7,5][s.lod]
        for j in range(sprays):
            a=TAU*j/sprays+k*.8
            d=Vector((math.cos(a),math.sin(a),.10+.12*math.sin(j)))
            tip=target+d*(1.75+.20*math.sin(j*2))+UP*.25
            mid=target.lerp(tip,.5)+UP*(1.05+.22*math.sin(j*2.4))
            s.tube('Leaf_rachis', [target,mid,tip],[.065,.035,.008],sides=5,rings=9)
            leaves=[8,5,3][s.lod]
            for q in range(leaves):
                t=.15+.78*q/max(1,leaves-1)
                b=curve([target,mid,tip],31)[int(t*30)]
                side=Vector((-d.y,d.x,0))*(1 if q%2 else -1)
                s.leaf('Lanceolate_leaf',b,b+d*.65+side*.85+UP*(.14+.35*math.sin(q*2.3+j)),.36,segments=5)
        if k<3:
            fp=target-UP*.7
            s.tube('Fruit_pedicel',[target,fp],[.025,.01],rings=5,sides=5)
            s.shell('Seed_nut',fp,[(.01,-.26),(.16,-.18),(.18,.02),(.06,.18)],region=2,sides=12,lobes=3)
    if v==2:
        s.tube('Broken_leader',[(.5,0,2.7),(.15,-.55,3.7),(-.7,-.72,4.1)],[.22,.13,.09],sides=12,rings=12)
        s.shell('Exposed_branch_scar',(-.7,-.72,4.1),[(.08,-.05),(.11,0),(.015,.04)],region=2,sides=12)


def conifer(s,v):
    h=[11.3,9.2,12.5][v]
    lean=[.1,.9,-.4][v]
    s.roots(.38,5)
    s.tube('Tapering_leader',[(0,0,0),(.05,.1,h*.4),(lean,0,h)],[.52,.28,.015],rings=35,sides=16,ribs=7)
    tiers=[8,5,7][v]
    for k in range(tiers):
        f=k/(tiers-1)
        z=h*(.22+.68*f)
        r=(1-f)*[2.6,3.4,2.4][v]+.38
        c=Vector((lean*z/h,0,z))
        if s.lod==3:
            s.shell('Whorl_envelope',c,[(.07,-.1),(r,-.25-r*.15),(r*.75,.10),(r*.12,.90)],sides=25,lobes=5,flute=.22)
            continue
        boughs=[6,5,4][s.lod]
        for j in range(boughs):
            a=TAU*j/boughs + k*.62
            d=Vector((math.cos(a),math.sin(a),0))
            e=c+d*r-UP*([.45,.12,.85][v]*r)
            s.tube('Whorled_bough',[c,c+d*r*.65+UP*.08,e],[.10,.045,.008],rings=11,sides=7)
            needles=[10,6,3][s.lod]
            for q in range(needles):
                t=.15+.8*q/needles
                b=c.lerp(e,t)+UP*(.15*math.sin(t*math.pi))
                for sign in (-1,1):
                    side=Vector((-d.y,d.x,0))*sign
                    s.leaf('Needle_spray',b,b+d*.62+side*(.85*(1-t)+.18)-UP*(.2 if v==2 else -.10),.28*(1-t)+.08,segments=5)
            if k<3 and j%3==0:
                s.shell('Cone_scales',e-UP*.12,[(.02,-.33),(.12,-.25),(.16,-.02),(.08,.16),(.01,.22)],region=2,sides=12,lobes=5,flute=.18)


def palm(s,v):
    h,lean=(8.5,1.95) if v==0 else (6.3,.35)
    s.roots(.32,7)
    pts=[(0,0,0),(.05,.1,h*.25),(lean*.45,0,h*.65),(lean,0,h)]
    top=s.tube('Leaf_scar_stem',pts,[.50,.33 if v==0 else .72,.24,.29],sides=20,rings=48,ribs=9,depth=.04)
    if s.lod<3:
        stalk=curve(pts,61)
        for j in range(9):
            t=.15+j*.082
            c=stalk[int(t*60)]
            r=float(np.interp(t,[0,1/3,2/3,1],[.50,.33 if v==0 else .72,.24,.29]))
            s.shell('Old_frond_attachment',c,[(r,-.04),(r*1.06,0),(r,.055)],region=1,sides=20,lobes=9,flute=.02)
    n=10 if v==0 else 9
    for k in range(n):
        a=TAU*k/n
        d=Vector((math.cos(a),math.sin(a),0))
        side=Vector((-d.y,d.x,0))
        e=top+d*(3.1 if v==0 else 2.4)+UP*(.2 if v else -1.1)
        mid=top.lerp(e,.45)+UP*1.15
        s.tube('Frond_rachis',[top,mid,e],[.10,.07,.012],rings=20,sides=8,region=0)
        if v==0:
            leaves=[18,10,6,2][s.lod]
            for q in range(leaves):
                t=.12+.85*q/max(1,leaves-1)
                b=curve([top,mid,e],51)[int(t*50)]
                for sign in (-1,1):
                    tip=b+side*(sign*(.8*math.sin(math.pi*t)+.14))+d*.35-UP*.35
                    s.leaf('Feather_pinna',b,tip,.11,segments=5)
        else:
            base=top.lerp(e,.52)+UP*.7
            ribs=[13,9,5,3][s.lod]
            for j in range(ribs):
                f=(j/(ribs-1)-.5)*1.6
                tip=e+side*(f*1.0)+UP*(.7*(1-abs(f)))
                s.leaf('Pleated_fan',base,tip,.22,fold=.12,segments=6)
    if s.lod<3:
        for k in range(4):
            a=TAU*k/4
            c=top+Vector((.32*math.cos(a),.32*math.sin(a),-.38))
            s.shell('Attached_fruit',c,[(.02,-.33),(.25,-.2),(.29,.1),(.05,.35)],region=2,sides=16,lobes=3,flute=.03)


def cap(s,label,c,r,bell=False):
    profile= [(0.06,-.18),(r*.65,-.28),(r,-.12),(r*1.02,.05),(r*.96,.20),(r*.75,r*.35),(r*.36,r*.57),(.04,r*.61)]
    if bell: profile=[(.06,-.1),(r*.75,-.25),(r,-.15),(r*.95,.05),(r*.72,r*.65),(r*.45,r*1.05),(.1,r*1.22),(.025,r*1.25)]
    if s.lod<3:
        profile=[(max(.015,p.x),p.z) for p in curve([(x,0,z) for x,z in profile],22)]
    s.shell(label,c,profile,sides=64,lobes=9,flute=.025)
    if s.lod<3:
        n=[44,24,12][s.lod]
        for j in range(n):
            a=TAU*j/n
            d=Vector((math.cos(a),math.sin(a),0))
            b=Vector(c)+d*r*.16-UP*.15
            s.leaf('Radial_gill',b,Vector(c)+d*r*.96-UP*.14,.045,region=3,fold=-.12,segments=7)
    # The lip is grown tissue, visibly rolled instead of a razor thin cut hemisphere.
    if s.lod<2:
        for j,a in enumerate([.3,1.1,2.7,3.9,5.3]):
            cc=Vector(c)+Vector((math.cos(a)*r*.55,math.sin(a)*r*.55,r*.43))
            s.shell('Cap_scale',cc,[(.01,-.03),(.18,0),(.12,.075),(.015,.11)],region=2,sides=12,lobes=4)


def mushroom(s,v):
    s.roots(.65,6)
    h=[5.2,6.5,4.0][v]
    end=s.tube('Fibrous_stipe',[(0,0,0),(.12,-.08,h*.3),(-.22,.1,h*.7),(.25,0,h)],[.85,.58,.46,.55],sides=28,rings=35,ribs=11,depth=.065)
    if v<2:
        cap(s,'Parasol_cap' if v==0 else 'Bell_cap',end,[3.4,2.15][v],v==1)
        s.shell('Torn_veil_collar',(0,0,h*.65),[(.4,-.15),(.9,-.10),(1.05,0),(.7,.13),(.43,.22)],region=3,sides=36,lobes=7,flute=.15)
    else:
        for k,(x,y,z,r) in enumerate([(-1.55,-.15,4.4,2.35),(1.5,.3,5.6,2.15),(.15,.1,7.15,1.7)]):
            c=Vector((x,y,z))
            s.tube('Attached_shelf_stipe',[(.1,0,2.8),c*.72,c],[.38,.32,.30],sides=16,rings=18,ribs=7)
            cap(s,'Shelf_cap_%d'%k,c,r)


def spiral(s,v):
    s.roots(.48,6)
    if v==0:
        pts=[]
        for t in np.linspace(0,1,19):
            a=t*TAU*1.65
            r=.95*math.sin(t*math.pi*.8)
            pts.append((r*math.sin(a),r*math.cos(a),t*8.8))
        s.tube('Open_helical_stem',pts,[.65,.38,.25,.10],region=1,sides=22,rings=110,ribs=7,depth=.10)
        for k in range(12):
            t=.17+.78*k/12
            b=Vector(pts[min(18,int(t*18))])
            a=t*TAU*1.65
            d=Vector((math.sin(a+1),math.cos(a+1),.38))
            s.leaf('Spiral_lamina',b,b+d*(1.45-.55*t),.48,region=0,fold=.38,segments=14)
        s.shell('Apical_spore_pod',pts[-1],[(.03,-.2),(.37,.03),(.26,.4),(.03,.62)],region=2,sides=26,lobes=7,flute=.10)
    else:
        s.tube('Braided_base',[(0,0,0),(.15,0,2),(-.1,0,3.8)],[.75,.45,.32],sides=24,rings=30,ribs=5,depth=.18)
        for k,sign in enumerate((-1,1)):
            pts=[(-.1,0,3.3),(sign*.8,.12,4.8),(sign*1.8,0,6.6)]
            for t in np.linspace(0,1,20):
                a=t*TAU*1.15
                rr=1.3*(1-t)+.15
                pts.append((sign*(1.8+rr*math.sin(a)),.14*math.sin(a),6.6+rr*(1-math.cos(a))+.35*k))
            s.tube('Unfurling_crozier',pts,[.35,.28,.17,.025],sides=20,rings=90,ribs=5,depth=.08)
            for j in range(6):
                b=Vector(pts[2+j*2])
                s.leaf('Crozier_lamina',b,b+Vector((sign*.75,(-1)**j*.55,.4)),.30,fold=.22,segments=12)
            s.shell('Spore_eye',pts[-1],[(.01,-.12),(.22,0),(.12,.21),(.01,.27)],region=2,sides=22,lobes=5)


def coral(s,v):
    s.roots(.6,6)
    s.tube('Anchored_coral_bole',[(0,0,0),(.1,0,1.4),(0,0,2.6)],[.85,.55,.38],sides=26,rings=30,ribs=8,depth=.07)
    ends=[]
    if v==0:
        forks=[(-2.9,.1,5.2),(-1.3,-.2,6.8),(.65,.2,7.3),(2.5,-.1,5.9)]
    else: forks=[(-1.7,-1.1,5.2),(1.5,-.7,6.0),(1.0,1.2,5.3),(-.8,1.0,6.8)]
    for k,p in enumerate(forks):
        e=Vector(p)
        b=Vector((0,0,1.6+.2*k))
        controls=[b,b.lerp(e,.5)-UP*.5,e]
        s.tube('Primary_antler',controls,[.44,.30,.13],region=0,sides=20,rings=24,ribs=6,depth=.065)
        for j in range(3):
            t=.5+j*.18
            mid=curve(controls,101)[int(t*100)]
            tip=mid+Vector(((-1 if k<2 else 1)*(.8-j*.15),(.2 if v==0 else (-1)**j*.7),1.3+j*.2))
            s.tube('Secondary_antler',[mid,mid.lerp(tip,.55),tip],[.20,.14,.045],region=0,sides=14,rings=16,ribs=5)
            ends.append(tip)
        ends.append(e)
    for p in ends:
        if v==1:
            s.shell('Hollow_polyp_cup',p,[(.04,-.2),(.20,-.05),(.34,.25),(.32,.34),(.23,.31),(.14,.10),(.02,.06)],region=2,sides=20,lobes=6,flute=.12)
        elif s.lod<3:
            s.shell('Budding_tip',p,[(.05,-.1),(.15,0),(.12,.16),(.01,.22)],region=2,sides=12,lobes=4)


def blob(s,v):
    s.roots(.65,7)
    if v==0:
        # One continuous profile with a broad root neck and constricted lobe junctions.
        profile=[(.5,0),(.9,.3),(1.35,1.1),(1.4,1.7),(.72,2.3),(.65,2.5),(1.25,3.1),(1.35,3.7),(.65,4.3),(.55,4.5),(1.02,5.1),(.95,5.8),(.45,6.3),(.35,6.5),(.70,7),(.5,7.5),(.02,7.8)]
        s.shell('Continuous_bladder_column',(0,0,0),profile,sides=88,lobes=9,flute=.13)
        for k,z in enumerate([1.3,3.4,5.3]):
            for j in range(4 if s.lod<2 else 2):
                a=j*TAU/4+k*.4
                b=Vector((math.cos(a),math.sin(a),z))
                s.leaf('Breathing_lappet',b,b+Vector((math.cos(a)*.55,math.sin(a)*.55,.7)),.27,region=3,fold=.2,segments=12)
        s.shell('Apical_vent',(0,0,7.5),[(.15,-.1),(.34,.15),(.3,.32),(.16,.3),(.12,.1)],region=2,sides=32,lobes=6)
    else:
        s.tube('Fluted_lantern_bole',[(0,0,0),(-.2,0,2.2),(.3,0,4.5),(0,0,6.4)],[.85,.6,.42,.28],sides=32,rings=45,ribs=8,depth=.13)
        for k,(x,y,z) in enumerate([(-1.6,-.4,4.4),(1.6,.2,5.1),(.2,.4,7.2)]):
            c=Vector((x,y,z))
            attach=Vector((0,0,z-.7))
            s.tube('Arched_pod_branch',[attach, c+UP*.8,c+UP*.45],[.25,.16,.12],sides=18,rings=24,region=1)
            s.shell('Pendulous_seed_chamber',c,[(.05,-1.1),(.6,-.8),(.95,-.15),(.72,.5),(.12,.72)],sides=48,lobes=7,flute=.18)
            s.shell('Basal_spore_valve',c-UP*.95,[(.03,-.15),(.23,0),(.15,.14),(.02,.20)],region=2,sides=22,lobes=6)


def cactus(s,v):
    if v==0:
        s.tube('Rooted_ribbed_column',[(0,0,0),(.05,0,1.8),(-.05,.08,3.7),(0,0,4.8)],[.55,.48,.42,.04],region=0,sides=40,rings=30,ribs=10,depth=.13)
        tips=[]
        for k,(sign,z,reach,top) in enumerate([(-1,1.7,1.3,3.8),(1,2.3,1.0,4.2),(-1,3.1,.65,4.7)]):
            p=[(0,0,z),(sign*reach*.65,.1,z+.1),(sign*reach,.05,z+.55),(sign*reach,0,top)]
            s.tube('Elbowed_branch',p,[.30,.29,.26,.025],region=0,sides=28,rings=20,ribs=7,depth=.13)
            tips.append(Vector(p[-1]))
        tips.append(Vector((0,0,4.8)))
    else:
        pads=[((0,0,.85),(.55,.20,.85),0),((-.55,0,1.8),(.52,.18,.8),-.4),((.55,0,1.9),(.48,.17,.8),.35),((-1.15,.04,2.9),(.52,.17,.75),-.25),((.95,0,3.1),(.55,.17,.85),.25),((.08,.1,3.0),(.38,.16,.65),-.15)]
        tips=[]
        for k,(c,scale,tilt) in enumerate(pads):
            profile=[(.02,-1),(.65,-.8),(1,-.2),(.94,.5),(.56,.9),(.02,1)]
            s.shell('Jointed_paddle',c,profile,sides=26,lobes=3,flute=.015,stretch=scale,tilt=tilt)
            if k>2: tips.append(Vector(c)+UP*scale[2])
        s.tube('Corked_root_neck',[(0,0,0),(0,0,.45)],[.28,.20],sides=16,rings=10,region=1,ribs=5)
    for k,p in enumerate(tips):
        s.shell('Flower_calyx',p,[(.03,-.12),(.22,0),(.24,.17),(.05,.20)],region=2,sides=18,lobes=7,flute=.22)
        if s.lod<2:
            for j in range(7):
                a=TAU*j/7
                s.leaf('Bloom_petal',p,p+Vector((.3*math.cos(a),.3*math.sin(a),.28)),.09,region=2,fold=.13)
    # Sparse, placed areoles; tiny needles are left to the normal map at distance.
    if s.lod==0:
        for k in range(48 if v==0 else 24):
            a=(k%8)*TAU/8
            z=.65+(k//8)*.57
            if v==0:
                p=Vector((.49*math.cos(a),.49*math.sin(a),z))
                s.tube('Areole_spine',[p,p+Vector((math.cos(a)*.10,math.sin(a)*.10,.06))],[.018,.001],region=2,sides=4,rings=2)


BUILDERS={'round':round_tree,'conifer':conifer,'palm':palm,'mushroom':mushroom,'spiral':spiral,'coral':coral,'blob':blob,'cactus':cactus}


def atlas(kind):
    library={'round':'LIB_ShellRib','conifer':'LIB_ShellRib','palm':'LIB_ShellRib','mushroom':'LIB_CapFlesh','spiral':'LIB_Chitin','coral':'LIB_Chitin','blob':'LIB_CapFlesh','cactus':'LIB_Chitin'}[kind]
    with bpy.data.libraries.load(str(ROOT/'assets/blend/_library.blend'),link=False) as (src,dst):
        assert library in src.materials
        dst.materials=[library]
    mat=dst.materials[0]
    mat.name='LIB_T04_'+kind
    mat['source_library_material']=library
    mat['atlas_note']='Painted organ trims: lower left bark, upper left lamina, lower right reproductive tissue, upper right gill. Packed base/ORM/normal/emission; geometry-specific occlusion in Color.A.'
    mat.use_nodes=True
    nt=mat.node_tree
    nt.nodes.clear()
    bs=nt.nodes.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Roughness'].default_value=.72
    out=nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
    size=1024
    yy,xx=np.mgrid[0:size,0:size]/size
    u=(xx*2)%1; v=(yy*2)%1
    palettes={
        'round':[(.12,.25,.13),(.24,.16,.10),(.57,.32,.12),(.27,.34,.18)],
        'conifer':[(.10,.22,.19),(.22,.16,.13),(.46,.28,.13),(.18,.27,.18)],
        'palm':[(.17,.30,.15),(.38,.27,.16),(.53,.36,.18),(.26,.36,.18)],
        'mushroom':[(.45,.25,.12),(.63,.56,.37),(.67,.65,.34),(.53,.57,.29)],
        'spiral':[(.23,.38,.31),(.27,.32,.23),(.67,.68,.32),(.38,.45,.30)],
        'coral':[(.48,.25,.27),(.28,.23,.25),(.67,.46,.33),(.46,.29,.30)],
        'blob':[(.35,.43,.24),(.31,.34,.21),(.66,.62,.29),(.44,.51,.28)],
        'cactus':[(.21,.34,.27),(.31,.24,.17),(.64,.34,.29),(.31,.43,.30)]}
    region=np.where(xx<.5,np.where(yy<.5,1,0),np.where(yy<.5,2,3))
    colors=np.array(palettes[kind],np.float32)[region]
    # Broad growth structures, a healed scar, sheltered dirt, waxy margins and leaf veins.
    scar=np.exp(-((u-.35)/.08)**2-((v-.42)/.15)**2)
    bark=np.sin(u*TAU*7+.35*np.sin(v*8))*.025 + scar*.13
    bark-=.06*np.exp(-v*7)
    veins=np.exp(-((u-.5)/.018)**2)*.035
    veins+=np.maximum(0,np.cos((v*9-np.abs(u-.5)*7)*TAU))**16*.014
    margin=np.clip((np.abs(u-.5)-.35)*5,0,1)
    leaf=veins-.018*margin+.02*np.sin(v*math.pi)
    gill=.035*np.cos(u*TAU*14)*(np.sin(v*math.pi)**2)
    reproductive=.045*np.sin(v*math.pi)*np.cos(u*TAU*5)
    height=np.choose(region,[leaf,bark,reproductive,gill])
    shade=1+height*3
    base=np.clip(colors*shade[:,:,None],.015,.8)
    rough=np.choose(region,[.63+margin*.12,.83-scar*.20,.48+.16*v,.74+.10*np.cos(u*TAU*14)])
    ao=np.clip(.88+height*.8-.15*np.exp(-v*9),.45,1)
    dy,dx=np.gradient(height)
    normal=np.stack([-dx*140,-dy*140,np.ones_like(dx)],axis=-1)
    normal/=np.linalg.norm(normal,axis=-1)[:,:,None]
    normal=normal*.5+.5
    emission=np.zeros_like(base)
    if kind in ('mushroom','spiral','coral','blob'):
        glow=(region==3)*np.maximum(0,np.cos(u*TAU*14))**20*np.exp(-((v-.55)/.2)**2)
        emission[:]=np.array((.25,.34,.08))*glow[:,:,None]
    arrays={'base':base,'orm':np.stack([ao,rough,np.zeros_like(ao)],axis=-1),'normal':normal,'emission':emission}
    nodes={}
    for key,arr in arrays.items():
        if key=='emission' and not np.any(arr): continue
        im=bpy.data.images.new('T04_'+kind+'_'+key,width=size,height=size,alpha=True)
        im.colorspace_settings.name='sRGB' if key in ('base','emission') else 'Non-Color'
        px=np.concatenate([arr,np.ones((size,size,1))],axis=-1).astype(np.float32)
        im.pixels.foreach_set(px.ravel())
        im.pack()
        tex=nt.nodes.new('ShaderNodeTexImage'); tex.image=im; tex.label=key
        nodes[key]=tex
    nt.links.new(nodes['base'].outputs['Color'],bs.inputs['Base Color'])
    sep=nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(nodes['orm'].outputs['Color'],sep.inputs[0])
    nt.links.new(sep.outputs['Green'],bs.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
    norm=nt.nodes.new('ShaderNodeNormalMap'); norm.inputs['Strength'].default_value=.45
    nt.links.new(nodes['normal'].outputs['Color'],norm.inputs['Color'])
    nt.links.new(norm.outputs['Normal'],bs.inputs['Normal'])
    grp=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
    grp.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
    g=nt.nodes.new('ShaderNodeGroup'); g.node_tree=grp
    nt.links.new(sep.outputs['Red'],g.inputs['Occlusion'])
    if 'emission' in nodes:
        nt.links.new(nodes['emission'].outputs['Color'],bs.inputs['Emission Color'])
        bs.inputs['Emission Strength'].default_value=.25
    mat.surface_render_method='DITHERED'
    mat.use_backface_culling=False
    return mat


def references():
    # Append the actual library scale references, including their mesh geometry.
    with bpy.data.libraries.load(str(ROOT/'assets/blend/_library.blend'),link=False) as (src,dst):
        dst.collections=['REF']
    ref=dst.collections[0]
    assert ref is not None
    bpy.context.scene.collection.children.link(ref)
    ref.hide_render=True


def author(kind):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.threads_mode='FIXED'; bpy.context.scene.render.threads=2
    bpy.context.scene.unit_settings.system='METRIC'
    material=atlas(kind)
    references()
    prefix='cactus' if kind=='cactus' else 'tree_'+kind
    root=bpy.data.collections.new(prefix)
    bpy.context.scene.collection.children.link(root)
    report=[]
    for v,design in enumerate(KINDS[kind]):
        name=f'{prefix}_{v}'
        # The internal variant node has its own name so the leaf mesh can retain the
        # consumer's exact name without colliding with an exporter-created empty.
        variant=f'{prefix}_form_{v}'
        s=Sculpt(0); BUILDERS[kind](s,v)
        coll=bpy.data.collections.new(variant+'_LOD0'); root.children.link(coll)
        o=s.object(name,coll,material)
        o['design']=design; o['source_session']='P1.E14.T04'
        o.data.calc_loop_triangles()
        t0=len(o.data.loop_triangles)
        # Preserve authored topology where sufficient, refine curved surfaces when below class floor.
        if kind!='cactus' and t0<3400:
            md=o.modifiers.new('Curvature_refinement','SUBSURF'); md.subdivision_type='SIMPLE'; md.levels=1
            with bpy.context.temp_override(object=o,active_object=o): bpy.ops.object.modifier_apply(modifier=md.name)
        o.data.calc_loop_triangles(); t0=len(o.data.loop_triangles)
        if t0>14500 or (kind=='cactus' and t0>5800):
            md=o.modifiers.new('Surface_economy','DECIMATE'); md.ratio=(14000 if kind!='cactus' else 5600)/t0; md.use_collapse_triangulate=True
            with bpy.context.temp_override(object=o,active_object=o): bpy.ops.object.modifier_apply(modifier=md.name)
        o.data.calc_loop_triangles(); t0=len(o.data.loop_triangles)
        counts=[t0]
        for lod,ratio in [(1,.48),(2,.17),(3,.038)]:
            c=bpy.data.collections.new(f'{variant}_LOD{lod}'); root.children.link(c)
            if lod==3:
                simplified=Sculpt(3); BUILDERS[kind](simplified,v)
                obj=simplified.object(name+f'_lod{lod}',c,material)
                obj.data.calc_loop_triangles()
                ratio=min(1,t0*.038/len(obj.data.loop_triangles))
            else:
                obj=o.copy(); obj.data=o.data.copy(); obj.name=name+f'_lod{lod}'; c.objects.link(obj)
            if ratio<1:
                md=obj.modifiers.new('Silhouette_reduction','DECIMATE'); md.ratio=ratio; md.use_collapse_triangulate=True
                with bpy.context.temp_override(object=obj,active_object=obj): bpy.ops.object.modifier_apply(modifier=md.name)
            obj.data.calc_loop_triangles(); counts.append(len(obj.data.loop_triangles))
            obj.hide_render=True
            obj.hide_set(True)
        report.append({'name':name,'variant':variant,'design':design,'triangles':counts})
    bpy.context.scene['authorship']='T04: saved editable control geometry and named organ vertex groups; exporter only reads this file.'
    bpy.context.scene['palette']='Botanical local palette, independent of peoples livery. Runtime uses COLOR_0 weights and planet palette.'
    bpy.context.scene['revision']='01'
    bpy.context.preferences.filepaths.save_version=0
    path=ROOT/'assets/blend/flora'/f'tree_{kind}_t04.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    print('T04_AUTHOR',json.dumps({'source':str(path.relative_to(ROOT)),'variants':report}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('kind',choices=KINDS)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    author(args.kind)
