"""One-time viewmodel authoring. Saved .blends are the editable source of truth.

Never imported by export.py. Derives arms, skin maps and proportions from pinned
accepted local bodies, authors fitted tool surfaces, then saves NEW sources only.
Blender -b --factory-startup -t 2 --python-exit-code 1 -P .../author.py -- PEOPLE
"""
from pathlib import Path
import hashlib
import json
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[5]
PEOPLE = sys.argv[sys.argv.index('--') + 1]
PIN = {
    'thalune': 'd1fc6986ad5fc164279e12a299aa6bc62b499084a6e8afee1b87315832c8d74b',
    'ixari': '9779f0a9dc8b3a69257124bb962b0e51c526f9b80501d35833c02674e3fa2f0c',
    'ulgani': '06fe606bd2f5d964423f6f69bf1da31ae38acc8052c53cd763b487cdc501a38b',
}
source = ROOT / f'assets/blend/characters/{PEOPLE}.blend'
output = ROOT / f'assets/blend/characters/viewmodels/fp_{PEOPLE}.blend'
assert hashlib.sha256(source.read_bytes()).hexdigest() == PIN[PEOPLE]
assert not output.exists(), 'Edit the saved source; authoring is deliberately non-overwriting'
bpy.ops.wm.open_mainfile(filepath=str(source))
scene = bpy.context.scene
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.unit_settings.system = 'METRIC'
prefix = {'thalune': 'TH', 'ixari': 'IX', 'ulgani': 'UL'}[PEOPLE]
oldrig = bpy.data.objects[f'RIG_{PEOPLE}']
body = bpy.data.objects[f'{prefix}_Body_head1_L0']
# Copy all data before deriving anything. No saved accepted source is modified.
arm = body.copy()
arm.data = body.data.copy()
arm.name = f'{PEOPLE}_arms'
arm.parent = None
arm.matrix_world = Matrix.Identity(4)
arm.modifiers.clear()
if arm.data.shape_keys:
    arm.shape_key_clear()
arm.animation_data_clear()
refs = [o for c in bpy.data.collections if c.name == 'REF' for o in c.all_objects]
keep = {arm, oldrig, *refs}
for obj in list(bpy.data.objects):
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)
for coll in list(bpy.data.collections):
    if coll.name != 'REF':
        bpy.data.collections.remove(coll)
asset = bpy.data.collections.new(f'fp_{PEOPLE}')
asset['asset_class'] = 'viewmodel'
scene.collection.children.link(asset)
lod = bpy.data.collections.new(f'fp_{PEOPLE}_LOD0')
asset.children.link(lod)
lod.objects.link(arm)
if oldrig.name not in scene.objects:
    lod.objects.link(oldrig)
# Arm-only crop retains accepted skin UVs, crystal growth and web membranes.
arm_names = {b.name for b in oldrig.data.bones if any(b.name.startswith(s) for s in
    ('upperarm', 'lowerarm', 'hand_', 'index_', 'middle_', 'ring_', 'thumb_'))}
weights = {}
for v in arm.data.vertices:
    ws = {arm.vertex_groups[g.group].name: g.weight for g in v.groups if arm.vertex_groups[g.group].name in arm_names}
    if sum(ws.values()) > .995 and abs(v.co.x) > .29:
        weights[v.index] = ws
bm = bmesh.new()
bm.from_mesh(arm.data)
bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in weights], context='VERTS')
bm.to_mesh(arm.data)
bm.free()
weights = [{arm.vertex_groups[g.group].name: g.weight for g in v.groups if arm.vertex_groups[g.group].name in arm_names} for v in arm.data.vertices]
rest = {b.name: b.matrix_local.copy() for b in oldrig.data.bones if b.name in arm_names}
heads = {b.name: b.head_local.copy() for b in oldrig.data.bones if b.name in arm_names}
tails = {b.name: b.tail_local.copy() for b in oldrig.data.bones if b.name in arm_names}
parents = {b.name: b.parent.name if b.parent and b.parent.name in arm_names else None for b in oldrig.data.bones if b.name in arm_names}
target = {}

def frame(direction, across):
    d = Vector(direction).normalized()
    a = Vector(across)
    a = (a - d * a.dot(d)).normalized()
    return Matrix((d, a, d.cross(a))).transposed()

for side in ('R', 'L'):
    name = f'hand_{side}'
    old_frame = frame(tails[name] - heads[name], (0, -1, 0))
    direction = (0, .8, .6) if side == 'R' else (.85, .42, .22)
    across = (0, -.6, .8) if side == 'R' else (.08, -.55, .83)
    rotation = frame(direction, across) @ old_frame.transposed()
    wrist = Vector((.235, .40, -.285) if side == 'R' else (-.075, .52, -.32))
    transform = rotation.to_4x4()
    transform.translation = wrist - rotation @ heads[name]
    for n in arm_names:
        if n.endswith('_' + side):
            target[n] = transform @ rest[n]
    # Elbow and forearm follow a continuous transition into the authored wrist.
    elbow = Vector((.35, .17, -.43) if side == 'R' else (-.32, .24, -.45))
    fore = f'lowerarm_{side}'
    upper = f'upperarm_{side}'
    fore_rotation = (wrist - elbow).normalized().rotation_difference((tails[fore] - heads[fore]).normalized()).inverted().to_matrix()
    tm = fore_rotation.to_4x4()
    tm.translation = elbow - fore_rotation @ heads[fore]
    target[fore] = tm @ rest[fore]
    target[f'lowerarm_twist_{side}'] = tm @ rest[f'lowerarm_twist_{side}']
    # Upper arm exits the bottom corners; no cut wrist or open palm seam.
    shoulder = elbow + Vector((.12 if side == 'R' else -.15, -.18, -.14))
    ur = (tails[upper] - heads[upper]).normalized().rotation_difference((elbow - shoulder).normalized()).to_matrix()
    ut = ur.to_4x4(); ut.translation = elbow - ur @ tails[upper]
    target[upper] = ut @ rest[upper]
    target[f'upperarm_twist_{side}'] = ut @ rest[f'upperarm_twist_{side}']
    axis = Vector(across).normalized()
    for digit in ('index', 'middle', 'ring', 'thumb'):
        # Species proportions remain intact. Flexion is baked into this NEW bind
        # profile, while every phalanx retains its own editable deform joint.
        bend = (22, 48, 70) if digit != 'thumb' else (-12, -27, -42)
        for j, degrees in enumerate(bend, 1):
            n = f'{digit}_{j:02}_{side}'
            parent = parents[n]
            base = target[parent] @ rest[parent].inverted() @ rest[n]
            pivot = base.translation.copy()
            q = Quaternion(axis, math.radians(degrees if side == 'R' else -degrees))
            rot = q.to_matrix().to_4x4()
            rot.translation = pivot - rot.to_3x3() @ pivot
            target[n] = rot @ base
# Apply exact bind-relative deformation, then build the dedicated view rig.
for vertex, ws in zip(arm.data.vertices, weights):
    p = vertex.co.copy()
    vertex.co = sum((((target[n] @ rest[n].inverted()) @ p) * w for n, w in ws.items()), Vector()) / sum(ws.values())
if arm.data.has_custom_normals:
    bpy.context.view_layer.objects.active = arm
    with bpy.context.temp_override(object=arm, active_object=arm):
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
arm.data.update()
rig_data = bpy.data.armatures.new(f'VM_{PEOPLE}')
rig = bpy.data.objects.new(f'RIG_fp_{PEOPLE}', rig_data)
lod.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
root = rig_data.edit_bones.new('vm_root'); root.head = (0, 0, 0); root.tail = (0, 0, .05)
for name in sorted(arm_names):
    b = rig_data.edit_bones.new('vm_' + name)
    b.matrix = target[name]
    b.length = (tails[name] - heads[name]).length
for name in arm_names:
    rig_data.edit_bones['vm_' + name].parent = rig_data.edit_bones['vm_' + parents[name]] if parents[name] else root
bpy.ops.object.mode_set(mode='OBJECT')
for group in arm.vertex_groups:
    group.name = 'vm_' + group.name
modifier = arm.modifiers.new('ViewmodelSkin', 'ARMATURE'); modifier.object = rig
arm.parent = rig
bpy.data.objects.remove(oldrig, do_unlink=True)
# A single subdivision resolves wrist creases and web folds at arm's length.
sub = arm.modifiers.new('WristSurface', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
bpy.context.view_layer.objects.active = arm
bpy.ops.object.modifier_apply(modifier=sub.name)
# Downsample only copies of maps used by this new source. Pack every image.
used = {m for m in arm.data.materials}
for mat in used:
    mat.name = f'VM_{PEOPLE}_' + mat.name
    for node in mat.node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            node.image.scale(2048, 2048)
            node.image.pack()
# Material atlas: authored panels, contact polish, cavity grime, growth lines.
N = 2048
y, x = np.mgrid[0:N, 0:N].astype(np.float32)
u = (x % 512) / 511; v = (y % 512) / 511
cell = (y // 512).astype(int) * 4 + (x // 512).astype(int)
palettes = {
 'thalune': ['EDE6D6','2E8F84','1F4E5F','637F76','D2C9AD','E07A5F','FFE7C2','314C4D'],
 'ixari': ['3B4252','7A4FD0','B9A6FF','242A36','545369','796D99','B9A6FF','343D50'],
 'ulgani': ['D9962B','F2EAD3','5B4636','787458','CFC4A8','A8AE7B','C7F06A','736552'],
}
colors = np.array([[int(c[i:i+2],16)/255 for i in (0,2,4)] for c in palettes[PEOPLE]],np.float32)
base = np.ones((N,N,4),np.float32); base[:,:,:3] = colors[cell % 8]
edge = np.minimum.reduce([u, v, 1-u, 1-v])
contact = np.exp(-((u-.52)/.32)**4 - ((v-.5)/.4)**6) * ((cell % 8) == 3)
seam = np.exp(-edge*95)
# Marked contact paths and rim wear; deliberately no all-over noise layer.
wear = np.exp(-((v-.08)/.018)**2) * (np.sin(u*33+cell)**8) * (cell%8!=6)
base[:,:,:3] *= (1-.23*seam+.09*wear+.06*contact)[:,:,None]
orm = np.ones((N,N,4),np.float32)
orm[:,:,0] = 1-.25*seam
roughness = {'thalune':[.29,.54,.68,.72,.43,.55,.38,.76], 'ixari':[.73,.32,.19,.78,.59,.44,.25,.7], 'ulgani':[.49,.65,.73,.76,.70,.66,.61,.78]}[PEOPLE]
orm[:,:,1] = np.clip(np.array(roughness)[cell%8] + .12*seam - .13*contact-.06*wear,.22,.9)
orm[:,:,2] = 0
normal = np.ones((N,N,4),np.float32); normal[:,:,:3] = [.5,.5,1]
# Fine directional contact grooves only on the grip region, following its long axis.
normal[:,:,0] += .055*np.sin(u*120)*((cell%8)==3)*np.sin(v*math.pi)**4
emission = np.ones((N,N,4),np.float32); emission[:,:,:3] = 0
emission[:,:,:3] = base[:,:,:3] * ((cell%8)==6)[:,:,None] * .32

def atlas_image(suffix, pixels, space):
    im = bpy.data.images.new(f'VM_{PEOPLE}_{suffix}',N,N,alpha=False)
    im.colorspace_settings.name = space
    im.pixels.foreach_set(np.ascontiguousarray(pixels).ravel())
    im.pack()
    return im
mat = bpy.data.materials.new(f'VM_{PEOPLE}_Tool'); mat.use_nodes=True
nodes = mat.node_tree.nodes; nodes.clear(); links=mat.node_tree.links
bsdf=nodes.new('ShaderNodeBsdfPrincipled'); out=nodes.new('ShaderNodeOutputMaterial'); links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
for suffix,data,space in [('base',base,'sRGB'),('orm',orm,'Non-Color'),('normal',normal,'Non-Color'),('emissive',emission,'sRGB')]:
    tex=nodes.new('ShaderNodeTexImage'); tex.image=atlas_image(suffix,data,space)
    if suffix=='base': links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    elif suffix=='orm':
        sep=nodes.new('ShaderNodeSeparateColor'); links.new(tex.outputs['Color'],sep.inputs[0]); links.new(sep.outputs['Green'],bsdf.inputs['Roughness']); links.new(sep.outputs['Blue'],bsdf.inputs['Metallic'])
        group=bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
        if not group.interface.items_tree: group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
        ao=nodes.new('ShaderNodeGroup'); ao.node_tree=group; links.new(sep.outputs['Red'],ao.inputs['Occlusion'])
    elif suffix=='normal':
        nm=nodes.new('ShaderNodeNormalMap'); links.new(tex.outputs['Color'],nm.inputs['Color']); links.new(nm.outputs['Normal'],bsdf.inputs['Normal'])
    else: links.new(tex.outputs['Color'],bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value=.35

objects=[]
def mesh(name, verts, faces, uv, tile=0, smooth=True):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); lod.objects.link(ob); me.materials.append(mat)
    layer=me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        poly.use_smooth=smooth
        for li in poly.loop_indices:
            s,t=uv[me.loops[li].vertex_index]
            layer.data[li].uv=((tile%4+.04+.92*s)/4,(tile//4+.04+.92*t)/4)
    objects.append(ob)
    return ob

def tube(name, path, radii, tile, segments=24, squash=1, smooth=True):
    verts=[];uv=[];faces=[]
    for i,pt in enumerate(path):
        p=Vector(pt); direction=Vector(path[min(i+1,len(path)-1)])-Vector(path[max(0,i-1)])
        d=direction.normalized(); a=d.cross(Vector((0,0,1)))
        if a.length<.01:a=d.cross(Vector((0,1,0)))
        a.normalize(); b=d.cross(a).normalized()
        for j in range(segments+1):
            ang=2*math.pi*j/segments
            verts.append(tuple(p+radii[i]*(a*math.cos(ang)+b*math.sin(ang)*squash))); uv.append((j/segments,i/(len(path)-1)))
    for i in range(len(path)-1):
        for j in range(segments):
            k=i*(segments+1)+j; faces.append((k,k+1,k+segments+2,k+segments+1))
    faces.extend([tuple(range(segments,-1,-1)),tuple((len(path)-1)*(segments+1)+j for j in range(segments+1))])
    return mesh(name,verts,faces,uv,tile,smooth)

def shell(name, y0, length, width, height, tile, samples=32, rings=28, center=(.20,-.16), faceted=False):
    path=[];r=[]
    for i in range(rings):
        t=i/(rings-1); path.append((center[0]+.008*math.sin(t*math.pi), y0+t*length,center[1])); r.append(width*(.20+.80*math.sin(math.pi*t)**.55))
    return tube(name,path,r,tile,samples,height/width,not faceted)

# Tool stock fits between the curled fingers and thumb; forward is Blender +Y.
tube('Tool_Grip',[(.211,.458,-.31),(.211,.475,-.28),(.211,.50,-.23),(.211,.52,-.18)],[.024,.029,.03,.025],3,32)
tube('Tool_PalmSeat',[(.201,.49,-.25),(.205,.51,-.22),(.20,.53,-.185)],[.028,.034,.031],7,28)
if PEOPLE=='thalune':
    shell('Tool_TidalShell',.48,.36,.083,.052,0,48,36)
    shell('Tool_LappedBelly',.50,.31,.077,.025,1,40,28,center=(.20,-.185))
    for k in range(7):
        t=k/7
        yy=.54+t*.23; w=.076*math.sin(math.pi*((yy-.48)/.36))**.55
        pts=[(.20+math.cos(a)*w, yy+.013*math.sin(a),-.16+math.sin(a)*.052) for a in np.linspace(.08,math.pi-.08,25)]
        tube(f'Tool_ShellRib{k}',pts,[.0035]*len(pts),4,12)
    shell('Tool_NacreThroat',.774,.062,.031,.025,6,40,16)
    tube('Tool_ScrollReturn',[(.25,.51,-.17),(.28,.49,-.18),(.29,.46,-.21),(.27,.44,-.24),(.245,.45,-.245)],[.009,.011,.011,.01,.007],1,20)
elif PEOPLE=='ixari':
    shell('Tool_SlateSocket',.49,.24,.063,.048,0,8,12,faceted=True)
    for k,(xx,yy,zz,rr,ll) in enumerate([(.20,.57,-.125,.037,.31),(.158,.59,-.16,.026,.23),(.24,.60,-.15,.022,.19)]):
        path=[(xx,yy,zz),(xx+.008,yy+.06,zz+.004),(xx+.005,yy+ll*.70,zz+.013),(xx-.008,yy+ll,zz+.02)]
        tube(f'Tool_GrownPrism{k}',path,[rr*.8,rr,rr*.70,.002],2 if k==0 else 1,6,1,False)
        tube(f'Tool_SocketCollar{k}',path[:2],[rr*1.25,rr*1.08],7,8,1,False)
        tube(f'Tool_Fracture{k}',[(xx+rr*.47,yy+.055,zz+rr*.75),(xx+rr*.34,yy+ll*.62,zz+rr*.56),(xx,yy+ll*.85,zz+rr*.25)],[.0025,.0018,.001],6,6)
    for k in range(3):
        shell(f'Tool_GrowthTerrace{k}',.60+k*.045,.022,.046-k*.004,.018,1,6,4,center=(.20,-.135),faceted=True)
else:
    # Open triangulated cage with inset membrane sails and visible breathing gills.
    for k in range(5):
        a=2*math.pi*k/5
        pts=[(.20+math.cos(a)*r,yy,-.16+math.sin(a)*r*.8) for yy,r in ((.50,.035),(.59,.070),(.71,.060),(.84,.025))]
        tube(f'Tool_ChitinSpar{k}',pts,[.010,.009,.007,.006],0,20)
        b=2*math.pi*(k+1)/5
        tube(f'Tool_FusedBrace{k}',[pts[1],(.20+math.cos(b)*.060,.71,-.16+math.sin(b)*.048)],[.006,.006],2,16)
        if k in (0,1,3):
            verts=[pts[1],pts[2],(.20+math.cos(b)*.060,.71,-.16+math.sin(b)*.048),(.20+math.cos(b)*.07,.59,-.16+math.sin(b)*.056)]
            sail=mesh(f'Tool_Membrane{k}',verts,[(0,1,2,3)],[(0,0),(0,1),(1,1),(1,0)],1)
            sol=sail.modifiers.new('MembraneThickness','SOLIDIFY');sol.thickness=.002
    shell('Tool_SporeCore',.57,.24,.027,.026,4,28,26)
    for k in range(9):
        yy=.60+k*.018
        shell(f'Tool_BreathingGill{k}',yy,.008,.036-k*.0015,.027-k*.001,2,20,4)
    for k in range(7):
        a=k*2.399
        tube(f'Tool_SporePoint{k}',[(.20+math.cos(a)*.018,.816,-.16+math.sin(a)*.015),(.20+math.cos(a)*.018,.825,-.16+math.sin(a)*.015)],[.004,.002],6,12)
# A short cuff gives the off-screen cut an authored edge without hiding biology.
for side in ('R','L'):
    fore='lowerarm_'+side
    start=target[fore].translation; end=target['hand_'+side].translation
    pts=[start.lerp(end,t) for t in (.06,.11,.19,.24)]
    cuff=tube(f'Cuff_{side}',pts,[.046,.049,.046,.044],1 if PEOPLE!='ixari' else 0,32,1)
    cuff['rig_bone']='vm_'+fore
# Bind tool and cuff meshes rigidly to their owning bones, retaining all grip geometry.
for ob in objects:
    bone=ob.get('rig_bone','vm_hand_R')
    vg=ob.vertex_groups.new(name=bone);vg.add(list(range(len(ob.data.vertices))),1,'REPLACE')
    mod=ob.modifiers.new('ViewmodelSkin','ARMATURE');mod.object=rig;ob.parent=rig
# Tool attachment markers share the exact same hand transform as its skin.
for name,position in [('Muzzle',(.20,.85,-.16)),('Grip_R',(.211,.49,-.25)),('Grip_L',(.11,.62,-.23))]:
    ob=bpy.data.objects.new(name,None);lod.objects.link(ob)
    ob.parent=rig;ob.parent_type='BONE';ob.parent_bone='vm_hand_R'
    bpy.context.view_layer.update();ob.matrix_world=Matrix.Translation(Vector(position))
scene['viewmodel_people']=PEOPLE
scene['viewmodel_source_body_sha256']=PIN[PEOPLE]
scene['viewmodel_contract']='vm_local_bind_v1; no shared-body clips; +Y forward, eye origin, metres'
scene['viewmodel_authoring']='accepted arm anatomy and packed maps; separately authored fitted tool'
scene.world=bpy.data.worlds.new('VM_World')
scene.world.color=(.12,.12,.12)
# Drop unrelated packed body images and old mesh datablocks from this NEW file.
bpy.ops.outliner.orphans_purge(do_recursive=True)
output.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)
print('SAVED_VIEWMODEL',PEOPLE,output,flush=True)
