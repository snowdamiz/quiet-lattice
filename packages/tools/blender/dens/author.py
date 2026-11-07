"""P1.E14.T10 initial sculpt session. Run once, never from the exporter.

The saved meshes, named part vertex groups, painted Wear colour attribute and UVs are
editable source. Re-running refuses existing files; revisions edit those files.
Blender -b -t 2 --factory-startup --python-exit-code 1 -P .../dens/author.py
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / "assets/blend/sites"
TAU = math.tau
EARTH = (0.16, 0.105, 0.061)
BARK = (0.24, 0.145, 0.075)
WORN = (0.43, 0.31, 0.17)
STONE = (0.235, 0.26, 0.24)
MOSS = (0.14, 0.225, 0.105)
REED = (0.36, 0.26, 0.125)
IVORY = (0.54, 0.47, 0.33)


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def mesh(name, verts, faces, color, coll=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    (coll or LOD).objects.link(ob)
    if color:
        ob.data.materials.append(MAT)
        paint = data.color_attributes.new(name="Wear", type="FLOAT_COLOR", domain="CORNER")
        for poly in data.polygons:
            poly.use_smooth = True
            for li in poly.loop_indices:
                p = data.vertices[data.loops[li].vertex_index].co
                # Lichen on upper/sheltered shoulders; rubbed, lighter edges on
                # exposed crests. Broad strokes are spatial, not random noise.
                crest = max(0, poly.normal.z) * 0.22
                damp = max(0, 1 - abs(p.z - 0.35) / 0.45) * 0.21
                brush = 0.04 * math.sin(p.x * 3 + p.z * 2)
                paint.data[li].color = tuple(max(0.015, v * (0.82 + crest + brush) + MOSS[k] * damp) for k, v in enumerate(color)) + (1,)
        group = ob.vertex_groups.new(name=name)
        group.add(list(range(len(verts))), 1, "REPLACE")
    return ob


def sweep(name, controls, radii, color=BARK, sides=12, steps=7, flat=1):
    """An editable swept sculpt from explicitly placed Catmull-Rom handles."""
    pts = [Vector(p) for p in controls]
    path, rr = [], []
    for i in range(len(pts) - 1):
        a, b, c, d = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        for j in range(steps):
            t = j / steps
            path.append((2*b + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t) / 2)
            rr.append(radii[i] * (1-t) + radii[i+1]*t)
    path.append(pts[-1]); rr.append(radii[-1])
    vs, fs = [], []
    side = Vector((0, 0, 1))
    for i, (p, r) in enumerate(zip(path, rr)):
        tangent = (path[min(i+1, len(path)-1)] - path[max(0, i-1)]).normalized()
        side = side - tangent * side.dot(tangent)
        if side.length < 0.01:
            side = Vector((1, 0, 0)) - tangent * tangent.x
        side.normalize()
        up = tangent.cross(side).normalized()
        for j in range(sides):
            a = TAU*j/sides
            flute = 1 + 0.085*math.cos(5*a + i*0.13)
            vs.append(p + r*flute*(side*math.cos(a) + up*math.sin(a)*flat))
    for i in range(len(path)-1):
        for j in range(sides):
            a=i*sides+j; b=i*sides+(j+1)%sides
            fs.append((a,b,b+sides,a+sides))
    fs.extend([tuple(reversed(range(sides))), tuple((len(path)-1)*sides+j for j in range(sides))])
    return mesh(name, vs, fs, color)


def stone(name, pos, size, color=STONE, turn=0, sides=24, rings=16):
    """Weathered boulder with pinched base, cleaved shoulder and eroded strata."""
    vs, fs = [], []
    for i in range(rings+1):
        t = math.pi*i/rings
        z = math.cos(t)
        for j in range(sides):
            a = TAU*j/sides
            profile = math.sin(t) * (1 + .065*math.sin(3*a+0.9) + .035*math.cos(7*a+3*t))
            x = profile*math.cos(a)*size[0]
            y = profile*math.sin(a)*size[1]
            vs.append((pos[0]+x*math.cos(turn)-y*math.sin(turn)+.08*size[0]*z,
                       pos[1]+x*math.sin(turn)+y*math.cos(turn),
                       pos[2]+size[2]*(z+.025*math.sin(t*7+a))))
    for i in range(rings):
        for j in range(sides):
            a=i*sides+j; b=i*sides+(j+1)%sides
            fs.append((a,b,b+sides,a+sides))
    return mesh(name,vs,fs,color)


def leaf(name, start, end, width, color=MOSS):
    a,b=Vector(start),Vector(end)
    along=b-a
    side=along.cross(Vector((0,0,1))).normalized()
    vs,fs=[],[]
    for i in range(17):
        t=i/16
        p=a+along*t+Vector((0,0,math.sin(t*math.pi)*width*.45))
        w=width*math.sin(t*math.pi)**.7
        for j in range(5):
            u=(j-2)/2
            vs.append(p+side*w*u+Vector((0,0,-abs(u)*width*.14+math.sin(t*math.pi*8)*w*.04)))
    for i in range(16):
        for j in range(4):
            k=i*5+j; fs.append((k,k+1,k+6,k+5))
    ob=mesh(name,vs,fs,color)
    md=ob.modifiers.new("LeafThickness","SOLIDIFY"); md.thickness=.014
    with bpy.context.temp_override(object=ob,active_object=ob):
        bpy.ops.object.modifier_apply(modifier=md.name)


def fern(name, x,y,z=0, scale=1):
    for i in range(5):
        a=.45+i*1.25
        end=(x+math.cos(a)*.8*scale,y+math.sin(a)*.8*scale,z+(.6+.12*i)*scale)
        leaf(f"{name}_frond{i}",(x,y,z),end,.12*scale)


def collider(name, lo, hi):
    vs=[(x,y,z) for z in (lo[2],hi[2]) for y in (lo[1],hi[1]) for x in (lo[0],hi[0])]
    fs=[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
    ob=mesh("COL_"+name,vs,fs,None,ASSET)
    ob.hide_render=True; ob.display_type="WIRE"


def arc(name, radius, z, start, stop, color, thickness=.11, offset=(0,0), rise=0):
    aa=[start+(stop-start)*i/10 for i in range(11)]
    sweep(name,[(offset[0]+radius*math.sin(a),offset[1]+radius*math.cos(a),z+rise*math.sin(a*.7)) for a in aa],
          [thickness*.6]+[thickness]*9+[thickness*.35],color,sides=10,steps=3)


def bedding(radius, count=18):
    for i in range(count):
        a=TAU*i/count
        r=radius*(.58+.12*math.sin(i*2.4))
        leaf(f"Bedding_{i}",(math.sin(a)*r,math.cos(a)*r,.04),
             (math.sin(a+.25)*radius*.25,math.cos(a+.25)*radius*.25,.1),.18+radius*.04,REED)


def burrow_root():
    # Open southern entrance, root mass concentrated round the rear haunch.
    for i,(x,y,sx,sy,h) in enumerate([(-2.25,.3,1.1,1.9,1.35),(2.2,.65,1.15,1.6,1.3),(-.35,2.15,2.0,.95,1.6)]):
        stone(f"EarthHaunch{i}",(x,y,h*.72),(sx,sy,h),EARTH)
    for i,y in enumerate([-1.1,-.4,.4,1.15]):
        sweep(f"VaultRoot{i}",[(-2.5,y,.05),(-2.0,y-.12,1.5),(-.8,y+.1,2.65),(1.0,y+.2,2.5),(2.3,y,.1)],
              [.35,.32,.38,.3,.2],BARK,sides=18,steps=9)
    for i,x in enumerate([-2.7,-2.25,2.25,2.7]):
        sweep(f"ExposedRoot{i}",[(x,1.5,.5),(x,.1,.4),(x*.9,-1.5,.15),(x*.67,-2.6,.04)], [.18,.23,.13,.015],WORN)
    fern("ShoulderFern",-2.1,1.0,2.1,.8); fern("BackFern",.6,2.0,2.1,.7)
    bedding(1.1,12)
    collider("LeftBank",(-3.0,-1.2,-.05),(-1.65,1.6,1.85))
    collider("RightBank",(1.65,-.9,-.05),(3.0,1.7,1.7))
    collider("RearBank",(-1.9,1.65,-.1),(1.8,2.8,2.3))
    collider("Vault",(-1.7,-1.3,2.4),(1.7,1.4,2.9))


def burrow_shale():
    # Long, offset triangular mouth below a slipped ledge; no copy of root vault.
    for i,(p,s,t) in enumerate([
        ((-2.05,.25,.75),(1.25,1.8,.95),-.3),((2.25,.9,.65),(.75,1.7,.9),.25),
        ((-.3,2.1,1.1),(1.8,1.0,1.4),.1),((-.4,.5,2.55),(2.4,1.9,.45),-.2),
        ((-1.1,1.3,3.0),(1.55,1.35,.26),-.3)]):
        stone(f"SlippedShale{i}",p,s,STONE,t,sides=32,rings=14)
    for i in range(7):
        x=-2.2+i*.65
        sweep(f"LedgeStratum{i}",[(x,-.6,2.55),(x-.1,.6,2.95),(x-.3,1.8,2.8)], [.035,.055,.02],WORN,steps=5)
    fern("ShadedFern",-2.45,-1.1,.2,.7); fern("CrackFern",1.5,1.9,1.9,.8)
    for i in range(5):
        stone(f"Spoil{i}",(-2+i*.9,-2.1+math.sin(i)*.2,.12),(.25,.28,.19),EARTH,sides=16,rings=10)
    bedding(.9,12)
    collider("LeftShale",(-2.9,-1.0,0),(-1.25,1.5,1.55))
    collider("RightShale",(1.65,-.5,0),(2.75,2.0,1.35))
    collider("BackShale",(-1.6,1.6,0),(1.6,2.8,2.3))
    collider("RoofShale",(-2.2,-1.1,2.2),(1.8,2.1,2.9))


def nest_cup():
    # A broken crescent woven from branch courses. The front gap stays walkable.
    for i in range(10):
        arc(f"WovenCourse{i}",3.2+.16*math.sin(i*.4),.13+i*.16,-2.45,2.3,REED if i%3 else BARK,.10+i*.003,rise=.10)
    for i in range(17):
        a=-2.4+i*4.7/16
        x,y=math.sin(a),math.cos(a)
        sweep(f"CrossWicker{i}",[(x*3.0,y*3.0,.08),(x*3.5,y*3.5,.85),(x*3.1,y*3.1,1.75)], [.09,.12,.035],WORN,sides=10,steps=6)
    for i,(p,e) in enumerate([((-3.5,-.6,0),(-2.0,2.8,3.1)),((3.5,.4,0),(.5,3.6,3.3)),((-1.6,3.4,0),(1.1,2.8,4.1))]):
        sweep(f"CrownBough{i}",[p,(p[0]*1.05,p[1],1.3),e,(e[0]+.6,e[1]-.2,e[2]+.5)], [.35,.31,.16,.03],BARK,sides=16,steps=9)
    bedding(2.55,24)
    fern("CupFern",-3.65,1.8,0,1.1); fern("OuterFern",3.5,-.8,0,.9)
    for i in range(11):
        a=-2.25+i*4.5/10; x,y=3.25*math.sin(a),3.25*math.cos(a)
        collider(f"Rim{i}",(x-.34,y-.34,0),(x+.34,y+.34,1.6))


def nest_reed():
    # High asymmetric reed shelter above a low leafy dish, open to the south.
    for i in range(7):
        arc(f"DishWeave{i}",2.5+.17*i,.08+i*.13,-2.35,2.4,REED,.09,offset=(.4,.15))
    for i,(x,y,lean,h) in enumerate([(-3.4,.0,1.0,4.5),(2.5,1.9,-1.3,4.8),(-1,3.5,.6,5.25)]):
        sweep(f"ShelterStem{i}",[(x,y,0),(x*1.05,y,1.8),(x+lean,y*.9,h),(x+lean*2,y*.8,h-.2)], [.3,.26,.18,.025],BARK,sides=18,steps=9)
        for j in range(5):
            leaf(f"ShelterBlade{i}_{j}",(x+lean,y*.9,h-.25),
                 (x+lean+(j-2)*.65,y-1.8,h-.75-abs(j-2)*.25),.38,REED)
    bedding(2.6,25)
    fern("NestFern",-3.2,-.9,0,1); fern("BackFern",1.1,3.3,0,1.15)
    for i in range(9):
        a=-2.1+i*4.2/8; x,y=.4+3.25*math.sin(a),.15+3.25*math.cos(a)
        collider(f"Rim{i}",(x-.35,y-.35,0),(x+.35,y+.35,.8))
    collider("StemWest",(-3.7,-.35,0),(-3.1,.35,2.3))
    collider("StemEast",(2.1,1.5,0),(2.8,2.3,3.5))
    collider("StemRear",(-1.35,3.1,0),(-.65,3.8,3.5))


def roost_snag():
    sweep("AncientSnag",[(-1.0,1.1,-.1),(-1.15,1.3,1.5),(-.8,1.2,3.6),(-1.1,1.4,5.4),(-.35,1.1,7.6)], [.95,.72,.54,.39,.08],BARK,sides=28,steps=12)
    for i,(end,base) in enumerate([((2.7,1.0,5.9),3.1),((-3,1.5,4.9),2.5),((.8,-1.7,6.4),4.3),((-2.6,.0,7.0),5.3)]):
        sweep(f"PerchBough{i}",[(-.9,1.2,base),((end[0]-.9)/2,(end[1]+1.2)/2,base+.8),end,(end[0]+.3,end[1]-.2,end[2]+.25)], [.34,.3,.16,.025],WORN,sides=16,steps=9)
    for i in range(9):
        a=TAU*i/9
        sweep(f"ButtressRoot{i}",[(-1,1.2,.7),(-1+1.3*math.cos(a),1.2+1.3*math.sin(a),.25),(-1+2.4*math.cos(a),1.2+2.4*math.sin(a),.02)], [.3,.19,.015],BARK,steps=7)
    for i in range(6):
        arc(f"PerchNest{i}",.7+.06*i,5.5+i*.095,0,TAU,REED,.085,offset=(2.1,1.1))
    fern("SnagFern",-2.0,1.8,.2,1.15)
    fern("SnagMoss",-.9,1.35,5.2,.65)
    collider("TrunkLow",(-1.65,.55,-.05),(-.4,1.9,2.6))
    collider("TrunkMid",(-1.5,.7,2.6),(-.35,1.8,5.1))
    collider("TrunkHigh",(-1.45,.9,5.1),(-.2,1.7,7.4))
    collider("PerchEast",(.5,.75,4.75),(2.7,1.4,5.9))
    collider("PerchWest",(-3,1.15,3.9),(-1.4,1.85,4.9))


def roost_fan():
    # Three blade-like, layered stones; ledges wear dark below occupied perches.
    for i,(x,y,h,w,t) in enumerate([(-2.1,1.25,4.8,.95,-.3),(.2,2.2,7.15,1.1,.1),(2.25,1.3,5.8,.9,.35)]):
        stone(f"FanStone{i}",(x,y,h*.48),(w,.85,h*.52),STONE,t,sides=24,rings=24)
        for j in range(4):
            z=1.4+j*(h-1.8)/4
            stone(f"PerchShelf{i}_{j}",(x-.15,y-.5,z),(w*1.13,1.0,.22),WORN,t,sides=24,rings=10)
        collider(f"StandingStone{i}",(x-w*.7,y-.6,0),(x+w*.7,y+.6,h*.85))
    for i in range(6):
        arc(f"StoneNest{i}",.72+i*.055,4.55+i*.08,0,TAU,REED,.09,offset=(-2.25,.7))
    fern("FanFern",2.7,.2,.1,.85); fern("FootFern",-2.8,1.9,0,1)
    stone("FallenShard",(-2.3,-.6,.25),(.8,1.3,.38),STONE,.8)
    collider("FallenShard",(-2.8,-1.5,0),(-1.8,.3,.5))


def apex_lair():
    # Fossilised root cage, broken on one side, wrapping a clear pack-sized arena.
    for i,(x,y,sx,sy,h) in enumerate([(-5.8,1,1.8,3.3,2.5),(5.7,2,2,2.5,2),(-3,5.7,2.6,1.5,2.9),(2.1,5.9,2.7,1.3,2.4)]):
        stone(f"LairButtress{i}",(x,y,h*.68),(sx,sy,h),STONE,sides=32,rings=18)
        collider(f"Buttress{i}",(x-sx*.7,y-sy*.75,-.05),(x+sx*.7,y+sy*.75,h*1.35))
    for i,y in enumerate([-1.1,.25,1.6,3.0]):
        sweep(f"FossilRib{i}",[(-5.4,y,0),(-4.7,y-.35,3.2),(-2.4,y+.3,5.8),(.2,y+.5,6.6),(2.7,y+.35,5.5),(4.8,y,2.9),(5.5,y,.1)],
              [.7,.55,.43,.32,.38,.49,.65],IVORY,sides=22,steps=9)
        collider(f"HighRib{i}",(-2.6,y-.3,5.7),(2.6,y+.7,6.85))
    sweep("BrokenSpine",[(-.6,-2.3,6.6),(0,.5,6.7),(.2,3.5,6.3),(-.3,5.8,4.2)], [.22,.38,.44,.06],WORN,sides=18,steps=10)
    # Splintered roots and occupation marks, confined to the shoulders.
    for i in range(6):
        x=-5.8+i*.19
        sweep(f"ClawScoring{i}",[(x,-1.2,.65),(x+.12,-1.15,1.4),(x+.4,-1.0,2.0)], [.025,.04,.015],EARTH,sides=8,steps=5)
    bedding(3.45,28)
    fern("LairFernW",-6,3,2.5,1.7); fern("LairFernE",5.8,2.7,1.8,1.5)
    fern("LairFernRear",1,5.4,2,1.5)
    for i in range(5):
        sweep(f"DiscardedQuill{i}",[(3.9+i*.2,-2.8,.08),(4.4+i*.2,-2.2,.3),(4.2+i*.25,-1.6,.12)], [.035,.085,.015],IVORY,sides=10,steps=5)


def material(name):
    # Append, then localise the shared organic material; library file stays untouched.
    with bpy.data.libraries.load(str(ROOT/"assets/blend/_library.blend"), link=False) as (src,dst):
        dst.materials=["LIB_Chitin"]
    m=dst.materials[0]; m.name=f"Den_{name}_Organic"; m["source_library"]="LIB_Chitin"
    if "engine_name" in m: del m["engine_name"]
    nt=m.node_tree; nt.nodes.clear()
    out=nt.nodes.new("ShaderNodeOutputMaterial")
    bs=nt.nodes.new("ShaderNodeBsdfPrincipled"); nt.links.new(bs.outputs["BSDF"],out.inputs["Surface"])
    bs.inputs["Metallic"].default_value=0
    at=nt.nodes.new("ShaderNodeVertexColor"); at.layer_name="Wear"
    noise=nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value=19; noise.inputs["Detail"].default_value=2
    mix=nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type="MULTIPLY"; mix.inputs[0].default_value=.15
    nt.links.new(at.outputs["Color"],mix.inputs[1]); nt.links.new(noise.outputs["Fac"],mix.inputs[2]); nt.links.new(mix.outputs[0],bs.inputs["Base Color"])
    ramp=nt.nodes.new("ShaderNodeMapRange"); ramp.inputs["To Min"].default_value=.62; ramp.inputs["To Max"].default_value=.93
    nt.links.new(noise.outputs["Fac"],ramp.inputs["Value"]); nt.links.new(ramp.outputs[0],bs.inputs["Roughness"])
    bump=nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value=.24; bump.inputs["Distance"].default_value=.045
    nt.links.new(noise.outputs["Fac"],bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"],bs.inputs["Normal"])
    return m


def references():
    ref=collection("REF")
    vs=[(x,y,0) for x in range(-10,11) for y in range(-10,11)]
    edges=[]
    for x in range(21):
        for y in range(21):
            k=x*21+y
            if x<20: edges.append((k,k+21))
            if y<20: edges.append((k,k+1))
    d=bpy.data.meshes.new("REF_Grid"); d.from_pydata(vs,edges,[])
    o=bpy.data.objects.new("REF_Grid",d); ref.objects.link(o)
    # Flat A-pose silhouette, exactly 1.85 m. A scale reference, never den geometry.
    outline=[(-.14,0,0),(-.19,0,.8),(-.3,0,1.21),(-.6,0,.99),(-.65,0,1.08),(-.27,0,1.48),(-.13,0,1.5),(-.13,0,1.74),(-.08,0,1.85),(.08,0,1.85),(.13,0,1.74),(.13,0,1.5),(.27,0,1.48),(.65,0,1.08),(.6,0,.99),(.3,0,1.21),(.19,0,.8),(.14,0,0),(.04,0,0),(0,0,.75),(-.04,0,0)]
    mesh("REF_Biped",outline,[tuple(reversed(range(len(outline))))],None,ref)
    ref.hide_render=True


ASSETS=[("den_burrow_0",4,burrow_root),("den_burrow_1",4,burrow_shale),
        ("den_nest_0",6,nest_cup),("den_nest_1",6,nest_reed),
        ("den_roost_0",5,roost_snag),("den_roost_1",5,roost_fan),
        ("den_apex_lair_0",10,apex_lair)]


def main():
    global LOD,ASSET,MAT
    OUT.mkdir(parents=True,exist_ok=True)
    for name,radius,sculpt in ASSETS:
        path=OUT/(name+".blend")
        if path.exists():
            raise RuntimeError(f"Refusing to regenerate authored source {path}; edit the saved mesh")
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene=bpy.context.scene
        scene.unit_settings.system="METRIC"; scene.unit_settings.scale_length=1
        scene.render.threads_mode="FIXED"; scene.render.threads=2
        scene.render.engine="CYCLES"; scene.cycles.device="CPU"
        ASSET=collection(name); ASSET["planner_radius_m"]=radius
        LOD=collection(name+"_LOD0",ASSET); MAT=material(name)
        sculpt()
        obs=list(LOD.objects)
        bpy.ops.object.select_all(action="DESELECT")
        for o in obs: o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0]
        bpy.ops.object.join()
        ob=bpy.context.object; ob.name=name+"_Sculpt"
        # One atlas across every disconnected authored part, not overlapping
        # per-part UVs. Part vertex groups remain available for later editing.
        bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=.00001)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.012)
        bpy.ops.object.mode_set(mode="OBJECT")
        for mark,pos in [("Interact_Spawn",(0,0,0)),("Spawn",(0,0,0))]:
            e=bpy.data.objects.new(mark,None); e.location=pos; e.empty_display_type="ARROWS"; ASSET.objects.link(e)
        references()
        scene["task"]="P1.E14.T10"
        scene["authoring"]="Explicit sculpt handles and part groups; saved source is authoritative, export never models"
        scene["planner_radius_m"]=radius
        scene["spawn_approach"]="Local south (-Y Blender / +Z glTF) through the open centre"
        bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
        print(f"AUTHORED {name}: {len(ob.data.polygons)} faces",flush=True)


if __name__=="__main__":
    main()
