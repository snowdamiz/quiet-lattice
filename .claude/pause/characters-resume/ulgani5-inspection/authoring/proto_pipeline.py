# Pipeline probe: does a skinned, multi-variant character with shared mesh data, shape keys and image materials survive
# validate -> export -> re-validate?  Writes <out>/characters/proto.blend
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'

def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or sc.collection).children.link(c)
    return c

ref = coll('REF')
me = bpy.data.meshes.new('REF_Grid')
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=20, y_segments=20, size=10)
bm.to_mesh(me); bm.free()
ref.objects.link(bpy.data.objects.new('REF_Grid', me))
me = bpy.data.meshes.new('REF_Biped')
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, vec=(0.4, 0.25, 1.85), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, 0, 0.925), verts=bm.verts)
bm.to_mesh(me); bm.free()
ref.objects.link(bpy.data.objects.new('REF_Biped', me))

asset = coll('proto')
# armature
arm = bpy.data.armatures.new('RIG_proto')
rig = bpy.data.objects.new('RIG_proto', arm)
asset.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
b0 = arm.edit_bones.new('Root'); b0.head = (0, 0, 0); b0.tail = (0, 0.2, 0)
b1 = arm.edit_bones.new('Spine'); b1.head = (0, 0, 0.9); b1.tail = (0, 0, 1.4); b1.parent = b0
b2 = arm.edit_bones.new('Head'); b2.head = (0, 0, 1.4); b2.tail = (0, 0, 1.85); b2.parent = b1
bpy.ops.object.mode_set(mode='OBJECT')

def img(name, colour, size=256, noise=0.3, nonc=False):
    im = bpy.data.images.new(name, size, size)
    if nonc:
        im.colorspace_settings.name = 'Non-Color'
    px = np.random.default_rng(len(name)).random((size * size, 4)).astype(np.float32) * noise
    px[:, :3] += np.array(colour[:3], np.float32)
    px[:, 3] = 1
    im.pixels.foreach_set(px.ravel())
    im.file_format = 'JPEG'
    im.filepath_raw = os.path.join(out, name + '.jpg')
    im.save()
    im2 = bpy.data.images.load(os.path.join(out, name + '.jpg'))
    im2.name = name + '_f'
    if nonc:
        im2.colorspace_settings.name = 'Non-Color'
    im2.pack()
    return im2

grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
grp.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')

def material(name, col):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    base = nt.nodes.new('ShaderNodeTexImage'); base.image = img(name + '_base', col)
    orm = nt.nodes.new('ShaderNodeTexImage'); orm.image = img(name + '_orm', (0.8, 0.5, 0.0), nonc=True)
    nrm = nt.nodes.new('ShaderNodeTexImage'); nrm.image = img(name + '_nrm', (0.5, 0.5, 1.0), nonc=True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(base.outputs['Color'], p.inputs['Base Color'])
    nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], p.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], p.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = grp
    nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    return m

skin = material('PR_Skin', (0.3, 0.5, 0.45))
suit = material('PR_Suit', (0.2, 0.2, 0.25))

def tube(name, z0, z1, r, seg, rings, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=z1 - z0)
    bmesh.ops.translate(bm, vec=(0, 0, (z0 + z1) / 2), verts=bm.verts)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-4], cuts=rings, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            a = math.atan2(l.vert.co.y, l.vert.co.x)
            l[uv].uv = ((a / (2 * math.pi)) % 1.0, (l.vert.co.z - z0) / (z1 - z0) * 0.98 + 0.01)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    return me

def skinned(name, mesh, collection):
    o = bpy.data.objects.new(name, mesh)
    collection.objects.link(o)
    o.parent = rig
    md = o.modifiers.new('Armature', 'ARMATURE'); md.object = rig
    for bname in ('Root', 'Spine', 'Head'):
        if bname not in o.vertex_groups:
            o.vertex_groups.new(name=bname)
    co = np.array([v.co for v in mesh.vertices])
    vs = o.vertex_groups['Spine']; vh = o.vertex_groups['Head']
    for i, c in enumerate(co):
        w = min(1, max(0, (c[2] - 1.3) / 0.2))
        vh.add([i], w, 'REPLACE'); vs.add([i], 1 - w, 'REPLACE')
    return o

body = {n: tube(f'PR_Body_mesh_LOD{n}', 0, 1.5, 0.2, [128, 48, 24, 8][n], [210, 80, 30, 6][n], skin) for n in range(4)}
headm = {n: tube(f'PR_Head_mesh_LOD{n}', 1.5, 1.8, 0.12, [64, 24, 12, 6][n], [60, 20, 8, 2][n], skin) for n in range(4)}
suitm = {n: tube(f'PR_Suit_mesh_LOD{n}', 0.3, 1.4, 0.21, [96, 40, 16, 8][n], [120, 40, 16, 4][n], suit) for n in range(4)}
for v in ('a', 'b'):
    for n in range(4):
        c = coll(f'proto_{v}_LOD{n}', asset)
        skinned(f'PR_Body_{v}_LOD{n}', body[n], c)
        h = skinned(f'PR_Head_{v}_LOD{n}', headm[n], c)
        if n == 0 and v == 'a':
            h.shape_key_add(name='Basis')
            k = h.shape_key_add(name='jawOpen')
            for i, p in enumerate(k.data):
                if p.co.z < 1.6:
                    p.co.z -= 0.02
        if v == 'b':
            skinned(f'PR_Suit_{v}_LOD{n}', suitm[n], c)
txt = bpy.data.texts.new('SKELETON')
txt.write('probe')
os.makedirs(os.path.join(out, 'characters'), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'characters', 'proto.blend'))
print('saved')
