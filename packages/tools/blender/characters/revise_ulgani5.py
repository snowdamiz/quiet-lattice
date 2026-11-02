"""Fifth Ulgani saved-source sculpt; never imports/runs the authoring generator.

Blender -b --factory-startup -t 2 --python-exit-code 1 -P this.py --
    before.blend checkpoint.blend report.json

Only Ulgani is loaded. Unique mesh data are edited once. LOD0 topology, UVs,
weights, morph inventory and rig are retained; only authored cap/fan surfaces are
restored in lower head LODs. New material masks remain SOURCE-ONLY until Skin,
SuitA and SuitB are rebaked. No bake/export/render/browser operation is present.
"""
from pathlib import Path
import datetime, hashlib, json, math, os, sys
import bmesh
import bpy
import numpy as np

EXPECTED = 'd0ab87a61e5b50ccb336c03b14a1553b7b2b063c7935af334ba12218bc013bc7'
before, output, report_path = map(lambda x: Path(x).resolve(), sys.argv[sys.argv.index('--') + 1:])
assert hashlib.sha256(before.read_bytes()).hexdigest() == EXPECTED
assert before != output and not output.exists() and not report_path.exists()
assert '.claude/pause/characters-resume/ulgani5/' in str(output)
bpy.ops.wm.open_mainfile(filepath=str(before))
assert {o.name for o in bpy.data.objects if o.type == 'ARMATURE'} == {'RIG_ulgani'}
scene = bpy.context.scene
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
rig = bpy.data.objects['RIG_ulgani']
assert len(rig.data.bones) == 69
S = 1.023
report = {'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pid': os.getpid(), 'pgid': os.getpgrp(), 'threads': 2, 'before_sha256': EXPECTED, 'scope': 'Fifth Ulgani source-only sculpt from the saved fourth source;no generator,bake,export or render.', 'mesh_edits': [], 'lod_caps': [], 'bake_required': ['UL_Skin:base/roughness/normal/AO', 'UL_SuitA:base/roughness/normal/AO', 'UL_SuitB:base/roughness/normal/AO'], 'maps_reused_pending_verification': ['UL_Eye', 'UL_Frond'], 'visual_validation_pending': True}
report_path.parent.mkdir(parents=True, exist_ok=True)

def checkpoint_report(phase):
    report['phase'] = phase
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print('ULGANI5_PATCH_PHASE', phase, flush=True)

def coords(points):
    a = np.empty(len(points) * 3, np.float32)
    points.foreach_get('co', a)
    return a.reshape(-1, 3).astype(np.float64)

def field(me, name):
    a = np.zeros(len(me.vertices), np.float32)
    attr = me.attributes.get(name)
    if attr and attr.domain == 'POINT' and attr.data_type == 'FLOAT':
        attr.data.foreach_get('value', a)
    return a.astype(np.float64)

def attribute(me, name, values):
    attr = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT')
    attr.data.foreach_set('value', np.asarray(values, np.float32))

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def gaussian(P, center, radii):
    return np.exp(-np.sum(((P - np.asarray(center)) / np.asarray(radii)) ** 2, axis=1) * 2)

def segment(P, A, B, width):
    A, B = np.asarray(A), np.asarray(B)
    d = B - A
    t = np.clip((P - A) @ d / max(d @ d, 1e-12), 0, 1)
    return np.exp(-np.sum((P - A - t[:, None] * d) ** 2, axis=1) / width ** 2)

def normals(me):
    n = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3).astype(np.float64)

def signature(obj):
    me = obj.data
    h = hashlib.sha256()
    for values, key, width, dtype in ((me.loops, 'vertex_index', 1, np.int32), (me.polygons, 'loop_total', 1, np.int32)):
        a = np.empty(len(values) * width, dtype)
        values.foreach_get(key, a)
        h.update(a.tobytes())
    uv = {}
    for layer in me.uv_layers:
        a = np.empty(len(layer.data) * 2, np.float32)
        layer.data.foreach_get('uv', a)
        uv[layer.name] = hashlib.sha256(a.tobytes()).hexdigest()
    weights = [[(obj.vertex_groups[g.group].name, round(g.weight, 8)) for g in v.groups] for v in me.vertices]
    return {'vertices': len(me.vertices), 'topology': h.hexdigest(), 'uv': uv, 'weights': hashlib.sha256(json.dumps(weights).encode()).hexdigest(), 'morphs': [k.name for k in me.shape_keys.key_blocks] if me.shape_keys else []}

def rig_signature():
    return {b.name: {'parent': b.parent.name if b.parent else None, 'matrix': [list(r) for r in b.matrix_local]} for b in rig.data.bones}

original_rig = rig_signature()
lod0_before = {o.name: signature(o) for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_L0')}
body_reference = bpy.data.objects['UL_Body_head1_L0'].data
body_reference_coordinates = coords(body_reference.vertices)
torso_candidates = body_reference_coordinates[field(body_reference, 'p_torso') > .5]
vent_strokes = []
for side in (-1, 1):
    candidates = torso_candidates[torso_candidates[:, 0] * side > 0]
    for z in (1.31, 1.23, 1.15, 1.07):
        points = []
        for guess in ([side * .143, -.064, z + .023], [side * .158, -.098, z - .025]):
            points.append(candidates[np.argmin(np.sum((candidates - guess) ** 2, axis=1))].copy())
        vent_strokes.append(points)

def laplacian(me, P, mask, strength=.24, iterations=3):
    edges = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get('vertices', edges)
    a, b = edges.reshape(-1, 2).T
    count = np.bincount(np.r_[a, b], minlength=len(P))
    result = P.copy()
    for _ in range(iterations):
        sums = np.zeros_like(P)
        np.add.at(sums, a, result[b])
        np.add.at(sums, b, result[a])
        average = sums / np.maximum(count[:, None], 1)
        delta = (average - result) * (mask * strength)[:, None]
        length = np.linalg.norm(delta, axis=1)
        delta *= np.minimum(1, .0015 / np.maximum(length, 1e-12))[:, None]
        result += delta
    return result

def apply_positions(me, P, repair):
    old = coords(me.vertices)
    delta = P - old
    if me.shape_keys:
        for key in me.shape_keys.key_blocks:
            key.data.foreach_set('co', np.asarray(coords(key.data) + delta, np.float32).ravel())
    me.vertices.foreach_set('co', np.asarray(P, np.float32).ravel())
    me.update()
    # Recompute changed surface normals, retaining the original matched neck seam.
    if repair.any():
        old_n = np.empty(len(me.loops) * 3, np.float32)
        me.corner_normals.foreach_get('vector', old_n)
        old_n = old_n.reshape(-1, 3)
        clean = me.copy()
        if clean.attributes.get('custom_normal'):
            clean.attributes.remove(clean.attributes['custom_normal'])
        sharp = clean.attributes.get('sharp_edge')
        if sharp:
            clean.attributes.remove(sharp)
        clean.update()
        fresh = np.empty(len(clean.loops) * 3, np.float32)
        clean.corner_normals.foreach_get('vector', fresh)
        fresh = fresh.reshape(-1, 3)
        indices = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get('vertex_index', indices)
        selected = repair[indices] > .05
        old_n[selected] = fresh[selected]
        me.normals_split_custom_set(old_n.tolist())
        bpy.data.meshes.remove(clean)
    return delta

def body_sculpt(me, P):
    N = normals(me)
    hand = np.maximum.reduce([field(me, n) for n in ('p_hand', 'p_finger', 'p_thumb')])
    toe = field(me, 'p_toe')
    joint = np.zeros(len(P))
    pad = np.zeros(len(P))
    Q = P.copy()
    for suffix in ('_L', '_R'):
        for name in ('index', 'middle', 'ring', 'thumb'):
            for number in (1, 2, 3):
                b = rig.data.bones[f'{name}_0{number}{suffix}']
                joint = np.maximum(joint, gaussian(P, b.head_local, [.022, .022, .022]))
                if number == 1:
                    pad += gaussian(P, b.head_local, [.028, .023, .028]) * (.0048 if name == 'thumb' else .0032)
        # Use the preserved left-toe construction axes, then mirror exactly.
        b = rig.data.bones['ball_L']
        direction = np.array(b.tail_local) - np.array(b.head_local)
        direction /= np.linalg.norm(direction)
        side = 1 if suffix == '_L' else -1
        options = []
        for dx, length, radius in ((.026, .076, .0135), (0, .084, .0142), (-.025, .070, .013)):
            angle = math.radians(15) * np.sign(dx)
            d = np.array([direction[0] * math.cos(angle) - direction[1] * math.sin(angle), direction[0] * math.sin(angle) + direction[1] * math.cos(angle), direction[2]])
            base = np.array(b.head_local) + np.array([dx * .9 * S, 0, -.004 * S])
            tip = base + d * length * S + np.array([0, 0, -.007 * S])
            base *= np.array([side, 1, 1])
            tip *= np.array([side, 1, 1])
            axis = tip - base
            t = (P - base) @ axis / (axis @ axis)
            distance = np.linalg.norm(P - base - np.clip(t, 0, 1)[:, None] * axis, axis=1)
            options.append((distance, t, base, tip, radius))
        chosen = np.argmin(np.stack([o[0] for o in options]), axis=0)
        for i, (_, t, base, tip, radius) in enumerate(options):
            axis = (tip - base) / np.linalg.norm(tip - base)
            center = tip - axis * radius * .55
            q = P - center
            along = q @ axis
            radial = q - along[:, None] * axis
            metric = np.sqrt((along / (radius * 1.05)) ** 2 + np.sum(radial ** 2, axis=1) / radius ** 2)
            rounded = center + q / np.maximum(metric[:, None], .1)
            weight = toe * smooth(.64, .88, t) * (chosen == i) * (P[:, 0] * side > 0)
            Q += (rounded - P) * (weight * .8)[:, None]
            joint = np.maximum(joint, segment(P, base, base + (tip - base) * .25, radius * 1.5) * toe)
            pad += gaussian(P, base + (tip - base) * .56, [radius * 1.2, radius * 1.7, radius]) * toe * .003
    Q = laplacian(me, Q, np.clip(joint * np.maximum(hand, toe), 0, 1))
    Q += N * (pad * np.maximum(hand, toe))[:, None]
    core = np.zeros(len(P))
    rim = np.zeros(len(P))
    for A, B in vent_strokes:
        core = np.maximum(core, segment(P, A, B, .0075))
        rim = np.maximum(rim, segment(P, A, B, .017))
    vent = np.clip(rim - core * .8, 0, 1) * field(me, 'p_torso')
    Q += N * ((vent * .009 - core * .0025) * field(me, 'p_torso'))[:, None]
    Q[:, 2] = np.maximum(Q[:, 2], -.0011)
    repair = np.clip(np.maximum(hand, toe) + vent, 0, 1) * (P[:, 2] < 1.40)
    surface_repair = np.maximum.reduce([joint * np.maximum(hand, toe), toe * .95, field(me, 'p_hand') * .55])
    attribute(me, 's5_surface_repair', np.clip(surface_repair, 0, 1))
    attribute(me, 's5_warm', np.clip(vent * .5 + gaussian(P, [0, .06, 1.25], [.20, .20, .22]) * .28, 0, .7))
    attribute(me, 's5_vent_rim', vent * .55)
    attribute(me, 's5_vent_core', core * field(me, 'p_torso') * .8)
    return Q, repair

def components(me):
    parent = np.arange(len(me.vertices))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in me.edges:
        a, b = e.vertices
        parent[find(a)] = find(b)
    result = {}
    for i in range(len(parent)):
        result.setdefault(int(find(i)), []).append(i)
    return list(result.values())

def head_sculpt(obj, P):
    me = obj.data
    Q = P.copy()
    number = int(obj.name.split('_')[1][4:])
    skin = field(me, 'free')
    gp = field(me, 'gpart')
    jaw = gaussian(P, [0, -.060, 1.535], [.14, .10, .055]) * (np.abs(P[:, 0]) > .022)
    jaw *= (gp < .1) * (field(me, 'm_lip') < .1) * (P[:, 2] > 1.477)
    if number in (3, 6):
        Q = laplacian(me, Q, jaw, .3, 4)
    for ids in components(me):
        ids = np.asarray(ids)
        if gp[ids].mean() < 1.5:
            continue
        c = P[ids].mean(0)
        # Broader connected leaf/fan surfaces, not a regenerated crest.
        factor = 1.18 if number in (2, 3, 5, 6) else 1.08
        if np.mean(gp[ids] >= 3.5) > .9:
            factor = 1.22 if number in (2, 3, 4, 5, 6) else 1.08
        Q[ids, 0] = c[0] + (Q[ids, 0] - c[0]) * factor
        Q[ids, 1] = c[1] + (Q[ids, 1] - c[1]) * factor
    attribute(me, 's5_surface_repair', smooth(.1, .4, jaw) if number in (3, 6) else np.zeros(len(P)))
    attribute(me, 's5_warm', gaussian(P, [0, .04, 1.51], [.14, .10, .07]) * .35 * (gp < .1))
    attribute(me, 's5_vent_rim', np.zeros(len(P)))
    attribute(me, 's5_vent_core', np.zeros(len(P)))
    return Q, np.maximum(jaw if number in (3, 6) else 0, (gp > 1.5).astype(float))

def suit_sculpt(me, P):
    kind = field(me, 'kind')
    edge = field(me, 'edge')
    fabric = (kind < .5) * (field(me, 'rib') < .5)
    chitin = ((kind > 5.5) & (kind < 7.6)) | (field(me, 'rib') > .6)
    joint = np.clip(field(me, 'fillet') + ((kind > 6.5) & (kind < 7.5)), 0, 1) * chitin
    wear = chitin * smooth(.12, .43, np.abs(field(me, 'mt') - .5))
    repair = np.zeros(len(P))
    folds = np.zeros(len(P))
    for side in (-1, 1):
        for A, B in (([side * .11, -.12, 1.34], [side * .045, -.15, 1.21]), ([side * .13, -.12, 1.02], [side * .06, -.13, .92]), ([side * .36, -.015, 1.22], [side * .46, -.04, 1.15]), ([side * .13, -.075, .60], [side * .145, -.07, .49])):
            ridge = segment(P, A, B, .008)
            trough = segment(P, np.asarray(A) + [0, .003, .012], np.asarray(B) + [0, .003, .012], .010)
            folds += ridge * .005 - trough * .003
        for C, R in (([side * .09, -.14, 1.25], [.045, .04, .055]), ([side * .12, -.10, .55], [.035, .04, .040])):
            repair = np.maximum(repair, gaussian(P, C, R))
    Q = P + normals(me) * (fabric * (folds + smooth(.55, .95, edge) * .004))[:, None]
    attribute(me, 's5_membrane', fabric.astype(float) * .65)
    attribute(me, 's5_patch', repair * fabric * .95)
    attribute(me, 's5_chitin', chitin.astype(float) * .20)
    attribute(me, 's5_weather', wear * .8)
    attribute(me, 's5_fused', joint * .85)
    return Q, fabric.astype(float)

seen = set()
for obj in list(bpy.data.objects):
    if obj.type != 'MESH' or not obj.name.startswith('UL_') or obj.data.as_pointer() in seen:
        continue
    seen.add(obj.data.as_pointer())
    me = obj.data
    P = coords(me.vertices)
    if obj.name.startswith('UL_Body_'):
        Q, repair = body_sculpt(me, P)
    elif obj.name.startswith('UL_Head'):
        Q, repair = head_sculpt(obj, P)
    elif obj.name.startswith('UL_Suit'):
        Q, repair = suit_sculpt(me, P)
    else:
        continue
    delta = apply_positions(me, Q, repair)
    entry = {'representative': obj.name, 'data': me.name, 'users': me.users, 'vertices_moved': int((np.linalg.norm(delta, axis=1) > 1e-7).sum()), 'max_displacement_m': float(np.linalg.norm(delta, axis=1).max())}
    if me.shape_keys:
        basis = coords(me.shape_keys.key_blocks['Basis'].data)
        lip = field(me, 'm_lip')
        ids = lip > .15
        assert ids.sum() > 20, obj.name
        zc = np.median(basis[ids, 2])
        up = smooth(-.001, .001, basis[:, 2] - zc)
        lower = 1 - up
        fv = me.shape_keys.key_blocks['vis_FV']
        values = coords(fv.data)
        values[:, 1] += lip * (-.001 * lower - .0018 * up)
        values[:, 2] += lip * (.0058 * lower + .0022 * up)
        fv.data.foreach_set('co', np.asarray(values, np.float32).ravel())
        mbp = coords(me.shape_keys.key_blocks['vis_MBP'].data)
        entry['fv_mbp_lip_mean_difference_m'] = float(np.linalg.norm(values[ids] - mbp[ids], axis=1).mean())
        entry['fv_mbp_lip_max_difference_m'] = float(np.linalg.norm(values[ids] - mbp[ids], axis=1).max())
        assert entry['fv_mbp_lip_mean_difference_m'] > .0015
    report['mesh_edits'].append(entry)
    checkpoint_report('sculpt ' + obj.name)

# Preserve the completed local sculpt independently of later LOD/material work.
scene['review5_material_bake_pending'] = True
scene['review5_status'] = 'Intermediate local sculpt;cap LOD and material-mask completion pending. Not export-ready.'
output.parent.mkdir(parents=True, exist_ok=True)
sculpt_checkpoint = output.with_name(output.stem + '.sculpt.blend')
assert not sculpt_checkpoint.exists()
bpy.ops.wm.save_as_mainfile(filepath=str(sculpt_checkpoint), compress=True)
report['sculpt_checkpoint'] = {'path': str(sculpt_checkpoint), 'sha256': hashlib.sha256(sculpt_checkpoint.read_bytes()).hexdigest()}
checkpoint_report('local sculpt saved;cap LOD replacement next')

def tris(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)

def subset_copy(obj, keep_caps):
    new = obj.copy()
    new.data = obj.data.copy()
    scene.collection.objects.link(new)
    new.parent = None
    new.matrix_world = obj.matrix_world.copy()
    new.hide_viewport = False
    new.hide_set(False)
    if new.data.shape_keys:
        new.shape_key_clear()
    mask = field(new.data, 'gpart') >= 3.5
    bm = bmesh.new()
    bm.from_mesh(new.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[vertex for vertex in bm.verts if bool(mask[vertex.index]) != keep_caps], context='VERTS')
    bm.to_mesh(new.data)
    bm.free()
    return new

def dissolve_caps(obj, angle, boundaries=False):
    modifier = obj.modifiers.new('review5 cap planar simplification', 'DECIMATE')
    modifier.decimate_type = 'DISSOLVE'
    modifier.angle_limit = math.radians(angle)
    modifier.delimit = {'MATERIAL', 'SEAM', 'UV'}
    modifier.use_dissolve_boundaries = boundaries
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
        bpy.ops.object.modifier_apply(modifier=modifier.name)

# Restore saved cap/fan topology rather than collapsing it with stalks.
for number in range(1, 7):
    high = bpy.data.objects[f'UL_Head{number}_head{number}_L0']
    for level in (1, 2, 3):
        target = bpy.data.objects[f'UL_Head{number}_head{number}_L{level}']
        assert np.allclose(np.array(high.matrix_world), np.array(target.matrix_world)), target.name
        users = [o for o in bpy.data.objects if o.type == 'MESH' and o.data == target.data]
        base = subset_copy(target, False)
        caps = subset_copy(high, True)
        if not len(caps.data.vertices):
            bpy.data.objects.remove(caps)
            bpy.data.objects.remove(base)
            report['lod_caps'].append({'head': number, 'lod': level, 'users_updated': 0, 'protected_cap_fan_triangles': 0, 'restored': False, 'reason': 'No authored gpart4 cap/fan surface. Head2 uses filament stalks and gpart3 nodules;this operation does not restore its terminal clusters.'})
            checkpoint_report(f'head{number} LOD{level}:no gpart4 surface;no empty temporary retained')
            continue
        if level == 3:
            dissolve_caps(caps, 20)
            # Keep cap outlines while removing coplanar interiors, within the
            # strict whole-variant LOD3 budget. No LOD0/1/2 cap is collapsed.
            limits = []
            for collection in bpy.data.collections:
                if collection.name.endswith('_LOD3') and target in collection.objects[:]:
                    high_collection = bpy.data.collections[collection.name[:-5] + '_LOD0']
                    high_count = sum(tris(o) for o in high_collection.objects if o.type == 'MESH')
                    other_count = sum(tris(o) for o in collection.objects if o.type == 'MESH' and o != target)
                    limits.append(int(high_count * .049) - other_count - tris(base))
            assert limits and min(limits) > 0, (target.name, limits)
            for angle in (35, 55):
                if tris(caps) <= min(limits):
                    break
                dissolve_caps(caps, angle, boundaries=True)
            assert tris(caps) <= min(limits), ('Cap LOD3 budget unresolved;local sculpt checkpoint retained', target.name, tris(caps), limits)
        before_count, cap_count = tris(target), tris(caps)
        bpy.ops.object.select_all(action='DESELECT')
        base.select_set(True)
        caps.select_set(True)
        bpy.context.view_layer.objects.active = base
        bpy.ops.object.join()
        data = base.data
        data.name = target.data.name + '_review5_caps'
        for user in users:
            user.data = data
        bpy.data.objects.remove(base)
        exact = False
        if level == 2:
            original_caps = coords(high.data.vertices)[field(high.data, 'gpart') >= 3.5]
            restored_caps = coords(target.data.vertices)[field(target.data, 'gpart') >= 3.5]
            assert original_caps.shape == restored_caps.shape
            order = lambda values: np.round(values, 6)[np.lexsort(np.round(values, 6).T[::-1])]
            assert np.array_equal(order(original_caps), order(restored_caps)), ('LOD2 cap shape changed', target.name)
            exact = True
        report['lod_caps'].append({'head': number, 'lod': level, 'users_updated': len(users), 'old_triangles': before_count, 'new_triangles': tris(target), 'protected_cap_fan_triangles': cap_count, 'lod2_source_caps_exact': exact})
        checkpoint_report(f'head{number} LOD{level} caps preserved')

def linear(hexcode):
    rgb = [int(hexcode[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb) + (1,)

def paint(material_name, treatments):
    material = bpy.data.materials[material_name]
    nt = material.node_tree
    principled = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    color = principled.inputs['Base Color'].links[0].from_socket
    rough = principled.inputs['Roughness'].links[0].from_socket
    for name, hexcode, roughness in treatments:
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.attribute_name = name
        attr.label = name + ' authored review5 mask'
        mix = nt.nodes.new('ShaderNodeMixRGB')
        mix.inputs[2].default_value = linear(hexcode)
        nt.links.new(attr.outputs['Fac'], mix.inputs[0])
        nt.links.new(color, mix.inputs[1])
        color = mix.outputs[0]
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1
        nt.links.new(attr.outputs['Fac'], inv.inputs[1])
        old = nt.nodes.new('ShaderNodeMath'); old.operation = 'MULTIPLY'
        nt.links.new(rough, old.inputs[0]); nt.links.new(inv.outputs[0], old.inputs[1])
        new = nt.nodes.new('ShaderNodeMath'); new.operation = 'MULTIPLY'; new.inputs[0].default_value = roughness
        nt.links.new(attr.outputs['Fac'], new.inputs[1])
        add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
        nt.links.new(old.outputs[0], add.inputs[0]); nt.links.new(new.outputs[0], add.inputs[1])
        rough = add.outputs[0]
    nt.links.new(color, principled.inputs['Base Color'])
    nt.links.new(rough, principled.inputs['Roughness'])
    material['review5_bake_pending'] = True

paint('UL_Skin', [('s5_warm', '#CFC4A8', .70), ('s5_vent_rim', '#E8E1CF', .61), ('s5_vent_core', '#785F44', .38), ('s5_surface_repair', '#DAD0B9', .65)])
nt = bpy.data.materials['UL_Skin'].node_tree
normal = next(n for n in nt.nodes if n.type == 'NORMAL_MAP')
attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 's5_surface_repair'
inverse = nt.nodes.new('ShaderNodeMath'); inverse.operation = 'SUBTRACT'; inverse.inputs[0].default_value = 1
nt.links.new(attr.outputs['Fac'], inverse.inputs[1]); nt.links.new(inverse.outputs[0], normal.inputs['Strength'])
for name in ('UL_SuitA', 'UL_SuitB'):
    paint(name, [('s5_membrane', '#C8B692', .76), ('s5_patch', '#EAE0C9', .85), ('s5_chitin', '#BF8738', .40), ('s5_weather', '#8E8B85', .69), ('s5_fused', '#4E3B2C', .58)])

assert original_rig == rig_signature(), 'Rig hierarchy/rest changed'
assert lod0_before == {o.name: signature(o) for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_L0')}, 'LOD0 topology/UV/weights/morph inventory changed'
report['lod0_invariants_pass'] = True
report['rig_rest_invariants_pass'] = True
report['variants'] = {}
for kind, count in (('head', 6), ('suit', 4)):
    for number in range(1, count + 1):
        variant = f'ulgani_{kind}{number}'
        totals = [sum(tris(o) for o in bpy.data.collections[f'{variant}_LOD{level}'].objects if o.type == 'MESH') for level in range(4)]
        report['variants'][variant] = totals
        assert 60000 <= totals[0] <= 150000, (variant, totals)
        assert totals[3] < totals[0] * .05, ('LOD3 budget needs correction before saving', variant, totals)
scene['review5_material_bake_pending'] = True
scene['review5_status'] = 'Saved-source sculpt checkpoint; Skin/SuitA/SuitB PBR rebake, export, renders, native-distance/dialogue review and fifth independent grade pending.'
text = bpy.data.texts.get('review5_source_patch.py') or bpy.data.texts.new('review5_source_patch.py')
text.clear(); text.write(Path(__file__).read_text())
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
report.update(completed_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(), output=str(output), output_sha256=hashlib.sha256(output.read_bytes()).hexdigest(), status='SOURCE_SAVED_PENDING_BAKE_AND_VISUAL_REVIEW')
report_path.write_text(json.dumps(report, indent=2) + '\n')
assert hashlib.sha256(before.read_bytes()).hexdigest() == EXPECTED
print('ULGANI5_SOURCE_SAVED', report['completed_utc'], report['output_sha256'], flush=True)
