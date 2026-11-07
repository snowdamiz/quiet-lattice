"""One-time edit of the recovered canonical Lark. Export never calls this file."""
import bpy, bmesh, math, json, hashlib, sys
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[5]
SRC=ROOT/'assets/blend/hulls/lark.blend'
assert hashlib.sha256(SRC.read_bytes()).hexdigest()=='6669a881185017e20d35ac923939fc7586ee4e0bd11c200b598ab6fbc026b3a0', 'Author only the recovered canonical source'
bpy.ops.wm.open_mainfile(filepath=str(SRC))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene; scene.render.threads_mode='FIXED';scene.render.threads=2
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import lods, scene as S, rules as R
rules=R.load()

def select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]

def relocate(o,c,parent=None):
    bpy.context.view_layer.update()
    mw=o.matrix_world.copy()
    for old in list(o.users_collection):old.objects.unlink(o)
    c.objects.link(o);o.parent=parent;o.matrix_world=mw
    return o

def join(objs,name,parent=None):
    if not objs:return None
    select(objs);bpy.ops.object.join();o=bpy.context.object;o.name=name
    mw=o.matrix_world.copy();o.parent=parent;o.matrix_world=mw
    return o

def finish(o,name,c,mat,parent=None,bevel=0):
    o.name=name;relocate(o,c,parent)
    if mat:o.data.materials.append(mat)
    select([o]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        md=o.modifiers.new('Crafted_edge','BEVEL');md.width=bevel;md.segments=3
        bpy.ops.object.modifier_apply(modifier=md.name)
    for f in o.data.polygons:f.use_smooth=True
    return o

def block(name,loc,size,c,mat,parent=None,bevel=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=size
    return finish(o,name,c,mat,parent,bevel)

def tube(name,a,b,r,c,mat,parent=None,vertices=20):
    v=Vector(b)-Vector(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=v.length,location=(Vector(a)+Vector(b))*.5)
    o=bpy.context.object;o.rotation_euler=v.to_track_quat('Z','Y').to_euler()
    return finish(o,name,c,mat,parent,.008)

def ring(name,loc,major,minor,c,mat,rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=48,minor_segments=10,location=loc,rotation=rot)
    return finish(bpy.context.object,name,c,mat)

def empty(name,loc,c,parent=None):
    o=bpy.data.objects.new(name,None);c.objects.link(o);o.location=loc;o.parent=parent;return o

def skin(parts,pivots,name,c,parent=None):
    """Rigid weights preserve exact part boundaries; engine-facing names become glTF joints."""
    arm=bpy.data.armatures.new(name);rig=bpy.data.objects.new(name,arm);c.objects.link(rig);rig.parent=parent
    select([rig]);bpy.ops.object.mode_set(mode='EDIT')
    for semantic,pos in pivots.items():
        b=arm.edit_bones.new(semantic);b.head=pos;b.tail=Vector(pos)+Vector((0,.25,0))
    bpy.ops.object.mode_set(mode='OBJECT')
    for semantic,objects in parts.items():
        for o in objects:
            mw=o.matrix_world.copy();o.parent=None;o.matrix_world=mw
            select([o]);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
            vg=o.vertex_groups.new(name=semantic);vg.add(list(range(len(o.data.vertices))),1,'REPLACE')
    mesh=join([o for obs in parts.values() for o in obs],name+'Mesh',rig)
    md=mesh.modifiers.new('Rigid_semantic_joints','ARMATURE');md.object=rig
    mesh['rigid_skin_contract']='Each vertex belongs to exactly one semantic joint; no blended hinges.'
    return rig,mesh

variants=[('lark',''),('lark_damaged','_dmg'),('lark_husked','_husk')]
# Replace only the lower LODs of this asset, deriving them from the revised hero after UV/bake authoring.
for c in list(bpy.data.collections):
    if c.name.startswith('lark') and any(c.name.endswith('_LOD'+str(i)) for i in (1,2,3)):
        for o in list(c.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.collections.remove(c)

paint_receipts=[]
for vid,suffix in variants:
    c=bpy.data.collections[vid+'_LOD0'];body=bpy.data.objects['Body'+suffix]
    mats={m.get('engine_name'):m for m in body.data.materials}
    dark=mats['Dark'];trim=mats['Trim'];hull=mats['Hull']
    interior=bpy.data.objects['CockpitInterior'+suffix]
    static=bpy.data.objects['CockpitInteriorMesh'+suffix]
    # Continuous shell seat, six padded ribs, side consoles, harness and foot wells at the retained pilot position.
    additions=[]
    additions.append(block('SeatPan',(0,.88,.48),(.55,.53,.13),c,dark,bevel=.065))
    back=block('SeatShell',(0,.56,.94),(.64,.17,1.03),c,dark,bevel=.09);back.rotation_euler.x=math.radians(-9);additions.append(back)
    for i in range(6):
        additions.append(block('SeatCushionRib',(0,.67,.63+i*.12),(.46,.105,.085),c,trim,bevel=.035))
    additions.append(block('HeadCradle',(0,.48,1.49),(.42,.22,.22),c,dark,bevel=.07))
    for side in (-1,1):
        additions.append(tube('Harness', (side*.18,.72,1.35),(side*.19,1.05,.55),.035,c,trim))
        additions.append(block('ConsoleShell',(side*.54,1.41,.78),(.24,1.05,.30),c,dark,bevel=.07))
        for i in range(5):
            additions.append(block('RecessedSwitch',(side*.54,1.12+i*.14,.94),(.11,.07,.035),c,trim,bevel=.01))
        for y in (1.5,1.75):
            additions.append(block('HeelRest',(side*.20,y,.25),(.22,.18,.07),c,dark,bevel=.025))
        additions.append(tube('IngressHandhold',(side*.82,1.05,1.17),(side*.82,1.70,1.17),.035,c,trim))
    # Instrument bezels follow the live screen anchors instead of covering their surfaces.
    for screen in ('ScreenLeft','ScreenCenter','ScreenRight'):
        marker=bpy.data.objects[screen+suffix];center=marker.matrix_world.translation
        width=.34 if screen!='ScreenCenter' else .31
        for dx in (-width/2,width/2):additions.append(tube('ScreenBezel',center+Vector((dx,0,-.12)),center+Vector((dx,0,.12)),.016,c,trim))
    static=join([static]+additions,'CockpitInteriorMesh'+suffix,interior)
    # Keep contact polish and upholstery colour in the atlas while reducing this assembly to one material.
    for o in (static,bpy.data.objects['CockpitStick_grip'+suffix],bpy.data.objects['CockpitThrottle_lever'+suffix]):
        for p in o.data.polygons:p.material_index=0
        o.data.materials.clear();o.data.materials.append(dark)
    stick=bpy.data.objects['CockpitStick'+suffix];throttle=bpy.data.objects['CockpitThrottle'+suffix]
    pivots={'CockpitShell':(0,0,0),'CockpitStick':tuple(stick.matrix_world.translation),'CockpitThrottle':tuple(throttle.matrix_world.translation)}
    parts={'CockpitShell':[static],'CockpitStick':list(stick.children),'CockpitThrottle':list(throttle.children)}
    rig,cockpit=skin(parts,pivots,'CockpitMechanism'+suffix,c,interior)
    for o in (stick,throttle):bpy.data.objects.remove(o,do_unlink=True)
    # Rigid gear skin: each original hinge retains its name and its own fully weighted vertices.
    gp={};gparts={};gear_empty=empty('GearAssembly'+suffix,(0,0,0),c)
    for g in ('GearFront','GearLeft','GearRight'):
        pivot=bpy.data.objects[g+suffix];gp[g]=tuple(pivot.matrix_world.translation);gparts[g]=list(pivot.children)
    # Port boarding ladder, shaped handrails and contact rungs, moving with port gear on stow.
    a=Vector((-3.0,.95,-1.95));b=Vector((-.92,.95,1.08))
    for side in (-1,1):
        off=Vector((0,side*.34,0));gparts['GearLeft'].append(tube('BoardingStringer',a+off,b+off,.045,c,dark))
        gparts['GearLeft'].append(tube('BoardingHandrail',a+off+Vector((-.1,0,.4)),b+off+Vector((-.1,0,.4)),.032,c,dark))
    for i in range(11):
        p=a.lerp(b,(i+.5)/11)
        gparts['GearLeft'].append(tube('BoardingRung',p+Vector((0,-.34,0)),p+Vector((0,.34,0)),.045,c,dark))
    gearrig,gear=skin(gparts,gp,'LandingMechanism'+suffix,c,gear_empty)
    for g in ('GearFront','GearLeft','GearRight'):bpy.data.objects.remove(bpy.data.objects[g+suffix],do_unlink=True)
    # Mounts: circular socket, keyed insert, saddled fairing and paired locking jaws centered on the actual HPs.
    add=[]
    for side in (-1,1):
        x=side*1.72;y=2.78;z=-.62
        add.append(block('MountSaddle',(x,y,z+.16),(.66,.86,.28),c,dark,bevel=.10))
        add.append(ring('MountCollar',(x,y,z),.24,.045,c,trim))
        add.append(ring('MountKeyedSocket',(x,y,z-.015),.15,.035,c,dark))
        for sign in (-1,1):
            add.append(block('MountLockJaw',(x+sign*.25,y,z-.06),(.12,.40,.15),c,trim,bevel=.025))
        add.append(tube('MountConduit',(x,y-.40,z+.14),(x+side*.28,y-1.0,z+.35),.035,c,dark))
    # Three elongated service covers follow the shell rib flow, with recessed perimeter lips.
    for side in (-1,1):
        for y in (-2.5,-1.4):
            add.append(block('ServiceLip',(side*2.65,y,.52),(.46,.78,.075),c,dark,bevel=.09))
            add.append(block('ServiceCover',(side*2.65,y,.566),(.38,.68,.035),c,trim,bevel=.075))
    body=join([body]+add,'Body'+suffix)
    # Author impact deformation on a broad starboard dorsal patch, preserving the leading outline.
    if vid=='lark_damaged':
        for v in body.data.vertices:
            x,y,z=v.co
            w=math.exp(-((x-2.30)/1.20)**2-((y+.45)/1.60)**2)*max(0,min(1,(z+.1)*2))
            v.co.z-=.43*w;v.co.x+=.12*w
        body['impact_center']=[2.3,-.45,.9];body['impact_displacement_m']=.43
    for o in c.objects:
        if o.type!='MESH':continue
        # Painted control fields sampled on the actual LOD0 surface, saved editable as vertex colour layers.
        colors=[];orm=[];world=o.matrix_world
        for poly in o.data.polygons:
            m=o.data.materials[poly.material_index];semantic=m.get('engine_name',m.name)
            base={'Hull':(.67,.62,.49),'Accent':(.027,.27,.23),'Trim':(.055,.13,.17),'Dark':(.035,.047,.052)}.get(semantic)
            for li in poly.loop_indices:
                p=world@o.data.vertices[o.data.loops[li].vertex_index].co;x,y,z=p
                if base is None:color=(1,1,1);rough=.4;metal=0
                else:
                    color=np.array(base);rough=.39 if semantic in ('Hull','Accent') else .48;metal=.65 if semantic in ('Dark','Trim') else 0
                    # Specific brushed contact bands: leading rim, nacelle intake lips, port ingress and service lips.
                    rim=math.exp(-((y-4.35)/.35)**2)*math.exp(-((abs(x)-1.25)/1.5)**2)
                    intake=math.exp(-((y-1.15)/.23)**2)*math.exp(-((abs(x)-4.45)/.9)**2)
                    ingress=math.exp(-((x+.9)/.16)**2)*math.exp(-((y-1.35)/.75)**4)*max(0,min(1,z))
                    service=max(math.exp(-((abs(x)-2.65)/.28)**4-((y-q)/.44)**4) for q in (-2.5,-1.4))
                    foot=1 if 'Boarding' in o.name else math.exp(-((x+2)/.8)**2-((y-.95)/.40)**2)*max(0,min(1,-z))
                    wear=min(.85,.6*rim+.55*intake+.8*ingress+.28*service+.5*foot)
                    streak=.5+.5*math.sin(31*x+4*y)*math.sin(11*y+2*x)
                    wear*=.55+.45*streak
                    color=color*(1-wear)+np.array((.19,.22,.20))*wear;rough+=.22*wear;metal=max(metal,.7*wear)
                    salt=math.exp(-((z+.45)/.20)**2)*math.exp(-((abs(x)-3.4)/1.4)**2)*.18
                    color=color*(1-salt)+np.array((.43,.46,.38))*salt
                    if 'Cockpit' in o.name:
                        if .60<z<1.30 and abs(x)<.25 and y<.85:color=np.array((.16,.23,.21));rough=.75;metal=0
                        if abs(x)>.44 and z>.9:color=np.array((.20,.25,.22));rough=.3;metal=.7
                    if vid=='lark_damaged':
                        impact=math.exp(-((x-2.3)/1.35)**2-((y+.45)/1.9)**2)*max(0,min(1,(z+.1)*3))
                        trail=math.exp(-((x-2.6)/.6)**2-((y+2)/2.0)**2)*max(0,min(1,z*3))*.6
                        scorch=min(.97,impact*1.25+trail)
                        color=color*(1-scorch)+np.array((.014,.009,.006))*scorch;rough+=.35*scorch;metal*=1-scorch
                    if vid=='lark_husked':
                        rust=service*.6+math.exp(-((y+4.2)/.6)**2)*.2
                        color=np.array((.009,.012,.014))*(1-rust)+np.array((.105,.040,.018))*rust
                        rough=.66+.16*rust;metal=.6
                colors.extend((*color,1));orm.extend((1,min(.95,rough),metal,1))
        for name,values in [('PaintColor',colors),('PaintORM',orm)]:
            old=o.data.color_attributes.get(name)
            if old:o.data.color_attributes.remove(old)
            attr=o.data.color_attributes.new(name=name,type='FLOAT_COLOR',domain='CORNER');attr.data.foreach_set('color',values)
    # Remove noisy legacy node graphs. The painted field is the sole base/roughness/metallic driver.
    used={s.material for o in c.objects if o.type=='MESH' for s in o.material_slots if s.material}
    for m in used:
        semantic=m.get('engine_name',m.name)
        if semantic not in ('Hull','Accent','Trim','Dark'):continue
        nt=m.node_tree;nt.nodes.clear();bs=nt.nodes.new('ShaderNodeBsdfPrincipled');out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
        paint=nt.nodes.new('ShaderNodeVertexColor');paint.layer_name='PaintColor';nt.links.new(paint.outputs['Color'],bs.inputs['Base Color'])
        params=nt.nodes.new('ShaderNodeVertexColor');params.layer_name='PaintORM';sep=nt.nodes.new('ShaderNodeSeparateColor');nt.links.new(params.outputs['Color'],sep.inputs['Color']);nt.links.new(sep.outputs['Green'],bs.inputs['Roughness']);nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
        bevel=nt.nodes.new('ShaderNodeBevel');bevel.inputs['Radius'].default_value=.009;bevel.samples=3;nt.links.new(bevel.outputs['Normal'],bs.inputs['Normal'])
        m['round3_paint']='Localized leading rim, intake lips, port ingress, maintenance covers, contact rungs; no global noise'
    # One nonoverlapping LOD0 UV atlas across all PBR materials and moving assemblies.
    meshes=[o for o in c.objects if o.type=='MESH' and any(s.material.get('engine_name') in ('Hull','Accent','Trim','Dark') for s in o.material_slots if s.material)]
    select(meshes);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.003,area_weight=.6,correct_aspect=True,scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    paint_receipts.append({'variant':vid,'atlas_source':'actual revised LOD0 geometry','meshes':[o.name for o in meshes],'uv_method':'single global non-overlapping Smart UV atlas','damage':'starboard impact deformation and colocated painted scorch' if suffix=='_dmg' else None})
    # Generate source-owned LODs now. These share the future packed baked maps, never get baked independently.
    for k,ratio in ((1,.30),(2,.10),(3,.032)):
        lc=bpy.data.collections.new(vid+'_LOD'+str(k));bpy.data.collections['lark'].children.link(lc)
        obs=lods._copy_subtree(list(c.objects),lc)
        rendered=[o for o in obs if o.type=='MESH']
        target=int(sum(S.tri_count(o) for o in c.objects if o.type=='MESH')*ratio)
        lods._decimate(rendered,target)
    print('AUTHORED',vid,flush=True)

# Markers are aligned to the new access route and the preserved small-hardpoint sockets.
root=bpy.data.collections['lark']
empty('Interact',(-3.25,.95,-1.05),root)
empty('BoardingFoot',(-3,.95,-1.95),root)
empty('BoardingSill',(-.92,.95,1.08),root)
empty('PilotSeat',(0,1.15,1.52),root)
# Retained collider envelope plus a cockpit shell collider and the actual ladder envelope, bounded to <512 tris.
block('COL_Cockpit',(0,1.2,.55),(1.70,3.1,2.05),root,None,bevel=0)
# The collider overlay should show the hull, not mark the deliberately clear ladder route as a solid obstacle.
# Preserve and index five existing palette choices as exported asset metadata.
liveries=[{'id':'thalune','Hull':'#EDE6D6','Accent':'#2E8F84','Trim':'#1F4E5F'}, {'id':'compact','Hull':'#F4F4F0','Accent':'#22406A','Trim':'#F28C28'}, {'id':'working','Hull':'#9A968C','Accent':'#3A3B3D','Trim':'#E3B341'}]
root['liveries']=json.dumps(liveries)
body=bpy.data.objects['Body'];body['livery_index']=json.dumps(liveries)
scene['lark_round3']='CPU authoring unit; current-parent source; full GPU/engine review pending'
scene['lark_lod_source']='LOD1-3 derived from revised LOD0 and share its UV atlas/maps'
scene['lark_round3_paint']=json.dumps(paint_receipts)
# Purge orphaned legacy noise images; the authoring fields remain editable in the source.
bpy.ops.outliner.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
(ROOT/'assets/renders/hulls/lark-round3-current/authoring.json').write_text(json.dumps({'paint':paint_receipts,'liveries':liveries,'source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest()},indent=2)+'\n')
