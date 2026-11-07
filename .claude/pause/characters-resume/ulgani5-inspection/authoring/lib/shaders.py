"""Authoring materials (procedural + hand masks) that the source bakes into the shared texture sets.  Each starts
from the library material's look (LIB_Skin_*, LIB_SuitWeave, LIB_GrownCrystal, LIB_CapFlesh, LIB_Membrane) and adds
the asset's own detail: anatomy-driven masks (countershading, regions from mesh attributes), cells, pores, seams,
wear where use goes.  Named sockets on a 'params' node group mirror the character-creation parameters."""
import bpy


def hexc(h, a=1.0):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), a)


class G:
    """Tiny node-graph builder."""

    def __init__(self, mat):
        self.m = mat
        self.nt = mat.node_tree
        self.x = 0

    def n(self, kind, **kw):
        node = self.nt.nodes.new(kind)
        node.location = (self.x, 0)
        self.x += 30
        for k, v in kw.items():
            if k.startswith('_'):
                setattr(node, k[1:], v)
            else:
                sock = node.inputs[k] if isinstance(k, str) else node.inputs[k]
                if hasattr(v, 'is_output') or (hasattr(v, 'node') and hasattr(v, 'links')):
                    self.nt.links.new(v, sock)
                else:
                    sock.default_value = v
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def math(self, op, a, b=None, c=None, clamp=False):
        node = self.nt.nodes.new('ShaderNodeMath')
        node.operation = op
        node.use_clamp = clamp
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if hasattr(v, 'links'):
                self.nt.links.new(v, node.inputs[i])
            else:
                node.inputs[i].default_value = v
        return node.outputs[0]

    def vmath(self, op, a, b=None):
        node = self.nt.nodes.new('ShaderNodeVectorMath')
        node.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if hasattr(v, 'links'):
                self.nt.links.new(v, node.inputs[i])
            else:
                node.inputs[i].default_value = v
        return node.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else node.outputs['Vector']

    def mix(self, fac, a, b, blend='MIX'):
        node = self.nt.nodes.new('ShaderNodeMix')
        node.data_type = 'RGBA'
        node.blend_type = blend
        for sock, v in ((node.inputs['Factor'], fac), (node.inputs[6], a), (node.inputs[7], b)):
            if hasattr(v, 'links'):
                self.nt.links.new(v, sock)
            else:
                sock.default_value = v
        return node.outputs[2]

    def mixf(self, fac, a, b):
        node = self.nt.nodes.new('ShaderNodeMix')
        node.data_type = 'FLOAT'
        for sock, v in ((node.inputs['Factor'], fac), (node.inputs[2], a), (node.inputs[3], b)):
            if hasattr(v, 'links'):
                self.nt.links.new(v, sock)
            else:
                sock.default_value = v
        return node.outputs[0]

    def ramp(self, fac, stops, interp='LINEAR'):
        node = self.nt.nodes.new('ShaderNodeValToRGB')
        cr = node.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = stops[0][1]
        for pos, col in stops[1:]:
            e = cr.elements.new(pos)
            e.color = col
        self.nt.links.new(fac, node.inputs['Fac'])
        return node.outputs['Color']

    def maprange(self, v, a, b, c=0.0, d=1.0, clamp=True, interp='LINEAR'):
        node = self.nt.nodes.new('ShaderNodeMapRange')
        node.interpolation_type = interp
        node.clamp = clamp
        self.nt.links.new(v, node.inputs['Value'])
        node.inputs['From Min'].default_value = a
        node.inputs['From Max'].default_value = b
        node.inputs['To Min'].default_value = c
        node.inputs['To Max'].default_value = d
        return node.outputs['Result']

    def attr(self, name):
        node = self.nt.nodes.new('ShaderNodeAttribute')
        node.attribute_name = name
        node.attribute_type = 'GEOMETRY'
        return node.outputs['Fac']

    def coords(self):
        tc = self.nt.nodes.new('ShaderNodeTexCoord')
        return tc

    def noise(self, vec, scale, detail=4.0, rough=0.55, dim='3D', distortion=0.0):
        node = self.nt.nodes.new('ShaderNodeTexNoise')
        node.noise_dimensions = dim
        self.nt.links.new(vec, node.inputs['Vector'])
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = rough
        node.inputs['Distortion'].default_value = distortion
        return node

    def voronoi(self, vec, scale, feature='F1', rnd=1.0, metric='EUCLIDEAN'):
        node = self.nt.nodes.new('ShaderNodeTexVoronoi')
        node.feature = feature
        node.distance = metric
        self.nt.links.new(vec, node.inputs['Vector'])
        node.inputs['Scale'].default_value = scale
        node.inputs['Randomness'].default_value = rnd
        return node

    def wave(self, vec, scale, kind='BANDS', dist=0.0, detail=2.0, direction='X'):
        node = self.nt.nodes.new('ShaderNodeTexWave')
        node.wave_type = kind
        if kind == 'BANDS':
            node.bands_direction = direction
        self.nt.links.new(vec, node.inputs['Vector'])
        node.inputs['Scale'].default_value = scale
        node.inputs['Distortion'].default_value = dist
        node.inputs['Detail'].default_value = detail
        return node

    def bump(self, h, strength, dist=0.002, normal=None):
        node = self.nt.nodes.new('ShaderNodeBump')
        self.nt.links.new(h, node.inputs['Height'])
        node.inputs['Strength'].default_value = strength
        node.inputs['Distance'].default_value = dist
        if normal is not None:
            self.nt.links.new(normal, node.inputs['Normal'])
        return node.outputs['Normal']


def new(name):
    m = bpy.data.materials.get(name)
    if m is not None:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m


def principled(g, base, rough, normal=None, metal=0.0, emission=None, estr=0.0, sss=0.0):
    out = g.nt.nodes.new('ShaderNodeOutputMaterial')
    p = g.nt.nodes.new('ShaderNodeBsdfPrincipled')
    g.link(p.outputs['BSDF'], out.inputs['Surface'])
    for k, v in (('Base Color', base), ('Roughness', rough), ('Metallic', metal)):
        if hasattr(v, 'links'):
            g.link(v, p.inputs[k])
        else:
            p.inputs[k].default_value = v
    if normal is not None:
        g.link(normal, p.inputs['Normal'])
    if emission is not None:
        if hasattr(emission, 'links'):
            g.link(emission, p.inputs['Emission Color'])
        else:
            p.inputs['Emission Color'].default_value = emission
        p.inputs['Emission Strength'].default_value = estr
    p.inputs['Subsurface Weight'].default_value = sss
    return p


# ---------------------------------------------------------------------------------------------- masks
def seg_mask(g, P, A, B, r0, r1, soft=0.5):
    """1 within the tapered capsule A(r0)..B(r1) around object-space point P, fading over soft*r."""
    A = tuple(float(x) for x in A)
    B = tuple(float(x) for x in B)
    BA = tuple(b - a for a, b in zip(A, B))
    L2 = sum(x * x for x in BA) or 1e-9
    PA = g.vmath('SUBTRACT', P, A)
    t = g.math('DIVIDE', g.vmath('DOT_PRODUCT', PA, BA), L2, clamp=False)
    t = g.math('MINIMUM', g.math('MAXIMUM', t, 0.0), 1.0)
    proj = g.vmath('MULTIPLY', (BA[0], BA[1], BA[2]), (1, 1, 1))
    sc = g.nt.nodes.new('ShaderNodeVectorMath')
    sc.operation = 'SCALE'
    g.link(proj, sc.inputs[0])
    g.link(t, sc.inputs['Scale'])
    Q = g.vmath('ADD', sc.outputs['Vector'], A)
    d = g.vmath('DISTANCE', P, Q)
    r = g.math('ADD', r0, g.math('MULTIPLY', t, r1 - r0))
    return g.math('SUBTRACT', 1.0, g.math('MINIMUM', g.math('MAXIMUM', g.math('DIVIDE', g.math('SUBTRACT', d, g.math('MULTIPLY', r, 1 - soft)),
                                                                               g.math('MULTIPLY', r, soft)), 0.0), 1.0))


# ---------------------------------------------------------------------------------------------- Thalune skin
def thalune_skin(name='AUTH_TH_Skin', cells=('#3FA79A', '#E3A04B', '#8A6AB8'), marks=()):
    """Smooth wet amphibian skin.  Countershaded (sea-green to deep teal over the back and the outer limbs, pale
    green-pearl belly, throat and inner limbs) with a soft, wandering boundary; dark dorsal blotches; a lateral line
    of pale spots along the flanks; clustered colour cells (teal, amber, dusk violet: the mood cells character
    creation drives); a dark stripe from the snout through each eye to the frills; fine speckle."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    obj = tc.outputs['Object']
    geo = g.nt.nodes.new('ShaderNodeNewGeometry')
    N = geo.outputs['Normal']
    back = g.vmath('DOT_PRODUCT', N, (0.0, 1.0, 0.25))
    up = g.vmath('DOT_PRODUCT', N, (0.0, 0.0, 1.0))
    sepn = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(N, sepn.inputs['Vector'])
    lat = g.math('ABSOLUTE', sepn.outputs['X'])
    dors = g.math('ADD', g.math('ADD', g.math('MULTIPLY', g.math('MAXIMUM', back, -0.3), 0.75), g.math('MULTIPLY', up, 0.45)), g.math('MULTIPLY', lat, 0.62))
    wob = g.noise(obj, 7.0, 3.0, 0.55)
    dors = g.math('ADD', dors, g.math('MULTIPLY', g.math('SUBTRACT', wob.outputs['Fac'], 0.5), 0.35))
    dmask = g.maprange(dors, 0.02, 0.42, interp='SMOOTHSTEP')
    mid = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', dors, 0.18)), 0.16, 0.0)
    ventral = hexc('#DCE5CB')
    flank = hexc('#7DB2A0')
    dorsal = hexc('#357A70')
    col = g.mix(g.maprange(dors, -0.1, 0.2, interp='SMOOTHSTEP'), ventral, flank)
    col = g.mix(dmask, col, dorsal)
    # dorsal blotches (irregular, darker): noise-shaped, not stamped discs
    bn = g.noise(g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 4.0, 2.0, 0.5).outputs['Color'], (0.05, 0.05, 0.05))), 8.0, 5.0, 0.6)
    blot = g.math('MULTIPLY', g.maprange(bn.outputs['Fac'], 0.56, 0.68), dmask)
    col = g.mix(g.math('MULTIPLY', blot, 0.5), col, hexc('#2A615B'))
    # ventral mottling: soft pale-green clouds on the belly, throat and inner limbs
    vm = g.noise(obj, 6.5, 4.0, 0.6)
    ven = g.math('SUBTRACT', 1.0, dmask)
    col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', g.maprange(vm.outputs['Fac'], 0.5, 0.7), ven), 0.55), col, hexc('#A9C6A6'))
    col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', g.maprange(vm.outputs['Fac'], 0.42, 0.3), ven), 0.4), col, hexc('#E4EEDC'))
    # (no scattered cells: the mood cells live in patches along the boundary, below)
    dot = g.maprange(dors, 9.0, 9.1)
    clus = dot
    # a band of larger mood cells along the countershading boundary (flanks, sides of the chest and limbs): the
    # pattern that reads from the front and in dialogue
    # (cells of mixed size crowd into irregular clusters: two cell scales, each cell its own size and a ragged edge)
    warp = g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 9.0, 3.0, 0.6).outputs['Color'], (0.03, 0.03, 0.03)))
    vf = g.voronoi(warp, 16.0, 'F1', 1.0)
    vs = g.voronoi(warp, 38.0, 'F1', 1.0)
    pickf = g.math('FRACT', g.math('MULTIPLY', g.vmath('DOT_PRODUCT', vf.outputs['Color'], (1.0, 0.37, 0.13)), 2.9))
    cellf = g.ramp(pickf, [(0.0, hexc(cells[0])), (0.33, hexc(cells[0])), (0.38, hexc(cells[1])), (0.72, hexc(cells[1])),
                           (0.76, hexc(cells[2])), (1.0, hexc(cells[2]))], 'CONSTANT')
    sz1 = g.math('ADD', 0.12, g.math('MULTIPLY', g.vmath('DOT_PRODUCT', vf.outputs['Color'], (0.2, 0.5, 0.3)), 0.4))
    sz2 = g.math('ADD', 0.2, g.math('MULTIPLY', g.vmath('DOT_PRODUCT', vs.outputs['Color'], (0.5, 0.2, 0.3)), 0.3))
    dotf = g.math('MAXIMUM', g.maprange(g.math('DIVIDE', vf.outputs['Distance'], sz1), 1.0, 0.8),
                  g.math('MULTIPLY', g.maprange(g.math('DIVIDE', vs.outputs['Distance'], sz2), 1.0, 0.75), 0.9))
    band = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', dors, 0.16)), 0.36, 0.08)
    patch = g.maprange(g.noise(obj, 2.6, 3.0, 0.6).outputs['Fac'], 0.48, 0.6)
    # no cells on the hands (a blot on the palm) or in a file down the breastbone
    sepc = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(obj, sepc.inputs['Vector'])
    hands = g.maprange(g.math('ADD', g.math('ADD', g.attr('p_hand'), g.attr('p_finger')), g.attr('p_thumb')), 0.2, 0.6)
    keel = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', sepc.outputs['X']), 0.045, 0.02),
                  g.maprange(sepc.outputs['Z'], 0.95, 1.05))
    patch = g.math('MULTIPLY', patch, g.math('SUBTRACT', 1.0, g.math('MAXIMUM', hands, keel)))
    cmf = g.math('MULTIPLY', dotf, g.math('MULTIPLY', band, patch))
    col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', band, patch), 0.3), col, hexc('#2C6A63'))
    col = g.mix(g.math('MULTIPLY', cmf, 0.92), col, cellf)
    # throat pleats: fine vertical folds on the pale throat (the gular pump that drives the gill-frills)
    sepo = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(obj, sepo.inputs['Vector'])
    oz, oy = sepo.outputs['Z'], sepo.outputs['Y']
    zt = g.math('MULTIPLY', g.maprange(oz, 1.505, 1.545), g.maprange(oz, 1.632, 1.6))
    thr = g.math('MULTIPLY', g.math('MULTIPLY', zt, g.maprange(oy, -0.015, -0.04)), g.math('SUBTRACT', 1.0, dmask))
    pw = g.wave(g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 20.0, 2.0, 0.5).outputs['Color'], (0.004, 0.004, 0.004))), 30.0, 'BANDS', 1.5, 1.0, 'X')
    pleat = g.math('MULTIPLY', g.maprange(pw.outputs['Fac'], 0.72, 0.97), thr)
    col = g.mix(g.math('MULTIPLY', pleat, 0.35), col, hexc('#86A985'))
    # facial marks (the eye stripe)
    for A, B, r0, r1 in marks:
        mk = seg_mask(g, obj, A, B, r0, r1, 0.6)
        col = g.mix(g.math('MULTIPLY', mk, 0.82), col, hexc('#173B39'))
    # fine speckle
    v2 = g.voronoi(obj, 300.0, 'F1', 1.0)
    sp = g.math('MULTIPLY', g.maprange(v2.outputs['Distance'], 0.2, 0.1), g.math('MULTIPLY', dmask, 0.3))
    col = g.mix(sp, col, hexc('#12302E'))
    rough = g.math('ADD', g.math('ADD', 0.47, g.math('MULTIPLY', g.math('SUBTRACT', g.noise(obj, 40.0, 3.0, 0.5).outputs['Fac'], 0.5), 0.1)),
                   g.math('MULTIPLY', dmask, -0.05))
    # (the pale belly, throat and inner limbs are matte, so the sky's reflection does not turn them teal at noon)
    rough = g.math('ADD', rough, g.math('MULTIPLY', g.math('SUBTRACT', 1.0, dmask), 0.24))
    col, rough = _regions(g, col, rough, '#5B2F3E', '#244A45', '#121C1B')
    # the lids are darker dorsal skin: a closed eye reads as an opaque fold of skin, an open one as a dark lid line
    lidm = g.maprange(g.attr('m_lid'), 0.15, 0.9)
    col = g.mix(g.math('MULTIPLY', lidm, 0.8), col, hexc('#2C6660'))
    rough = g.mixf(lidm, rough, 0.62)
    h = g.math('ADD', g.math('MULTIPLY', dot, g.math('MULTIPLY', clus, 0.35)), g.math('MULTIPLY', g.noise(obj, 200.0, 4.0, 0.55).outputs['Fac'], 0.45))
    h = g.math('ADD', h, g.math('MULTIPLY', cmf, 0.3))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', pleat, 1.2))
    nb = g.bump(h, 0.1, 0.0012)
    principled(g, col, rough, nb)
    m['auth'] = True
    return m


def eye_thalune(name='AUTH_TH_Eye'):
    """Large dark eyes: near-black iris field with a deep sea-green ring and a horizontal pupil; glossy cornea."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    uvv = tc.outputs['UV']
    c = g.vmath('SUBTRACT', uvv, (0.5, 0.5, 0.0))
    r = g.vmath('LENGTH', c)  # 0 at the pupil, 0.5 at the back of the eye
    sepn = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(c, sepn.inputs['Vector'])
    pupil = g.math('ADD', g.math('POWER', g.math('ABSOLUTE', g.math('MULTIPLY', sepn.outputs['X'], 1.0)), 2.0),
                   g.math('POWER', g.math('ABSOLUTE', g.math('MULTIPLY', sepn.outputs['Y'], 3.2)), 2.0))
    pm = g.maprange(pupil, 0.0042, 0.0028)
    ring = g.maprange(r, 0.2, 0.17)
    irisn = g.noise(g.vmath('MULTIPLY', c, (30.0, 30.0, 1.0)), 6.0, 4.0, 0.6)
    iris = g.mix(g.maprange(irisn.outputs['Fac'], 0.3, 0.75), hexc('#0B1716'), hexc('#1E4A43'))
    iris = g.mix(g.maprange(r, 0.13, 0.19), iris, hexc('#06100F'))
    col = g.mix(pm, iris, hexc('#020303'))
    col = g.mix(g.maprange(r, 0.24, 0.3), col, hexc('#2C3532'))   # back of the eye (hidden)
    rough = g.math('ADD', g.maprange(r, 0.2, 0.3, 0.035, 0.35), g.math('MULTIPLY', irisn.outputs['Fac'], 0.03))
    nb = g.bump(g.math('MULTIPLY', irisn.outputs['Fac'], g.maprange(r, 0.2, 0.16)), 0.25, 0.001)
    principled(g, col, rough, nb)
    m['auth'] = True
    return m


def thalune_fin(name='AUTH_TH_Fin', edge_cols=('#E07A5F', '#6A4C93')):
    """Gill-frill and fin membrane: skin-toned root, thin translucent-looking teal field between darker ribs, a
    coral-to-violet rim, fine veins along the rays, a few colour cells near the root; wet and glossy."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    uvv = tc.outputs['UV']
    sep = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(uvv, sep.inputs['Vector'])
    # v: 0 root .. 0.5 edge (top skin), 1 root .. 0.5 edge (bottom skin)
    v = g.math('MULTIPLY', g.math('SUBTRACT', 0.5, g.math('ABSOLUTE', g.math('SUBTRACT', sep.outputs['Y'], 0.5))), 2.0)
    rib = g.attr('rib')
    edge = g.attr('edge')
    obj = tc.outputs['Object']
    root = hexc('#4E8F7E')
    field = hexc('#7FB7AA')
    rim = g.mix(g.maprange(g.noise(obj, 6.0, 2.0, 0.5).outputs['Fac'], 0.4, 0.6), hexc(edge_cols[0]), hexc(edge_cols[1]))
    col = g.mix(g.maprange(edge, 0.0, 0.35), root, field)
    col = g.mix(g.maprange(edge, 0.62, 0.98), col, rim)
    col = g.mix(g.math('MULTIPLY', rib, 0.55), col, hexc('#24534C'))
    veins = g.wave(obj, 90.0, 'BANDS', 6.0, 3.0)
    vm = g.math('MULTIPLY', g.maprange(veins.outputs['Fac'], 0.85, 1.0), g.math('SUBTRACT', 1.0, rib))
    col = g.mix(g.math('MULTIPLY', vm, 0.35), col, hexc('#2E6A61'))
    v1 = g.voronoi(obj, 120.0, 'F1', 1.0)
    cells = g.math('MULTIPLY', g.maprange(v1.outputs['Distance'], 0.3, 0.18), g.maprange(edge, 0.35, 0.05))
    col = g.mix(g.math('MULTIPLY', cells, 0.6), col, hexc('#E3A04B'))
    rough = g.math('ADD', 0.34, g.math('MULTIPLY', rib, 0.14))
    h = g.math('ADD', g.math('MULTIPLY', rib, 0.6), g.math('MULTIPLY', vm, 0.3))
    nb = g.bump(h, 0.35, 0.001)
    # thin-membrane backlight: the field glows faintly with its own colour (rays and root stay opaque), so a frill
    # against the light reads as lit membrane rather than black
    emc = g.mix(g.math('ADD', g.math('MULTIPLY', rib, 0.8), g.maprange(edge, 0.25, 0.0)), col, hexc('#000000'))
    principled(g, col, rough, nb, emission=emc, estr=0.35)
    m['auth'] = True
    return m


SUIT_PAL = {
    'thalune': dict(fabric='#1F4E5F', panel='#15394A', plate='#EDE6D6', plate2='#D6CBB4', band='#15394A', fit='#4E8B76',
                    fit_metal='#9A7A52', accent='#E07A5F', grime='#2B3330', wear='#6E9AA0', salt='#E8EAE2'),
    'ixari': dict(fabric='#3B4252', panel='#2A2F3B', plate='#3B4252', plate2='#565E70', band='#7A4FD0', fit='#2C3038',
                  fit_metal='#8A8F96', accent='#B9A6FF', grime='#1C1D22', wear='#6A7285', salt='#4A4E58'),
    'ulgani': dict(fabric='#F2EAD3', panel='#D9962B', plate='#D9962B', plate2='#5B4636', band='#5B4636', fit='#5B4636',
                   fit_metal='#6E5844', accent='#C7F06A', grime='#4A4234', wear='#FFF8E6', salt='#C9C28F'),
}


def suit(people, name):
    """Suit fabric, plates, bands and fittings in one material (kind attribute picks the look).  Fabric: woven
    (LIB_SuitWeave's bands), two-tone panels by body region, seams with stitching, wear at knees/elbows/seat and at
    the cuffs, grime toward the feet, the people's own weathering (Thalune salt bloom and tide lines, Ixari soot,
    Ulgani lichen).  Plates: the people's shell/facet/chitin surface with edge wear.  Fittings: dull metal with
    verdigris (Thalune) / dark stone (Ixari) / chitin (Ulgani)."""
    P = SUIT_PAL[people]
    m = new(name)
    g = G(m)
    tc = g.coords()
    obj = tc.outputs['Object']
    kind = g.attr('kind')
    edge = g.attr('edge')
    part = g.attr('part')
    bs_ = g.attr('bs')
    bth = g.attr('bth')
    sep = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(obj, sep.inputs['Vector'])
    z = sep.outputs['Z']
    isfab = g.maprange(kind, 0.5, 0.1)
    isplate = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', kind, 1.0)), 0.5, 0.1)
    isband = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', kind, 2.0)), 0.5, 0.1)
    isfit = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', kind, 3.0)), 0.5, 0.1)
    istrim = g.maprange(kind, 3.5, 3.9)
    # ---- fabric: two-tone panels (flanks, under-arms, inner legs in the panel colour), weave, seams
    flank = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bth, 90.0)), 32.0, 22.0)  # torso sides (|th| ~ 90)
    under = g.maprange(bth, -55.0, -95.0)                                                 # under the arms / inner legs
    is_tor = g.maprange(g.math('ABSOLUTE', part), 0.5, 0.2)
    panel = g.math('MAXIMUM', g.math('MULTIPLY', flank, is_tor), g.math('MULTIPLY', under, g.math('SUBTRACT', 1.0, is_tor)))
    fabc = g.mix(panel, hexc(P['fabric']), hexc(P['panel']))
    weave = g.wave(obj, 420.0, 'BANDS', 0.0, 1.0)
    weave2 = g.wave(obj, 420.0, 'BANDS', 0.0, 1.0, 'Y')
    wv = g.math('MULTIPLY', g.math('ADD', weave.outputs['Fac'], weave2.outputs['Fac']), 0.5)
    fabc = g.mix(g.math('MULTIPLY', wv, 0.12), fabc, hexc('#000000'))
    # seams: where panels meet, at the waist and along the sleeves/legs
    seam_p = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', panel, 0.5)), 0.12, 0.02)
    seam_w = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.33)), 0.006, 0.0015), is_tor)
    seam = g.math('MAXIMUM', seam_p, seam_w)
    stitch = g.math('MULTIPLY', g.maprange(g.wave(obj, 260.0, 'BANDS', 0.0, 0.0, 'Z').outputs['Fac'], 0.75, 0.95), seam)
    fabc = g.mix(g.math('MULTIPLY', seam, 0.5), fabc, hexc(P['grime']))
    fabc = g.mix(g.math('MULTIPLY', stitch, 0.6), fabc, hexc(P['plate']))
    # ---- plates: shell / facet / chitin with a second tone in the ribs, edge wear
    pn = g.noise(obj, 9.0, 4.0, 0.6)
    platec = g.mix(g.maprange(pn.outputs['Fac'], 0.35, 0.7), hexc(P['plate']), hexc(P['plate2']))
    if people == 'thalune':
        # nacre: a pink-green sheen shift; the ribs (convex ridges) in LIB_ShellRib's sea-green grey
        nac = g.noise(obj, 22.0, 2.0, 0.5, distortion=2.0)
        platec = g.mix(g.math('MULTIPLY', g.maprange(nac.outputs['Fac'], 0.4, 0.75), 0.3), platec, hexc('#C9E3D5'))
        platec = g.mix(g.math('MULTIPLY', g.maprange(nac.outputs['Fac'], 0.3, 0.1), 0.25), platec, hexc('#E9D6D8'))
        gpt = g.nt.nodes.new('ShaderNodeNewGeometry')
        ribm = g.maprange(gpt.outputs['Pointiness'], 0.53, 0.6)
        platec = g.mix(g.math('MULTIPLY', ribm, 0.55), platec, hexc('#7FA89C'))
        # growth lines concentric to the hinge (along the plate's v)
        sv_ = g.attr('sv')
        gl = g.maprange(g.math('FRACT', g.math('MULTIPLY', g.attr('edge'), 1.0)), 0.0, 1.0)
        platec = g.mix(g.math('MULTIPLY', g.maprange(g.wave(obj, 70.0, 'RINGS', 2.0, 1.0).outputs['Fac'], 0.85, 1.0), 0.18), platec, hexc('#B9AE95'))
    platec = g.mix(g.math('MULTIPLY', edge, 0.65), platec, hexc(P['wear']))
    # ---- bands and fittings
    bandc = g.mix(g.math('MULTIPLY', wv, 0.15), hexc(P['band']), hexc('#000000'))
    fitn = g.noise(obj, 30.0, 3.0, 0.6)
    fitc = g.mix(g.maprange(fitn.outputs['Fac'], 0.3, 0.48), hexc(P['fit_metal']), hexc(P['fit']))
    col = g.mix(isplate, fabc, platec)
    col = g.mix(isband, col, bandc)
    col = g.mix(isfit, col, fitc)
    col = g.mix(istrim, col, bandc)
    # padding: diamond quilting on the fabric over the shoulders, elbows and knees, under the plates
    is_arm = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part, 1.0)), 0.5, 0.2)
    is_leg = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part, 3.0)), 0.5, 0.2)
    qa = g.math('MULTIPLY', is_arm, g.math('MAXIMUM', g.maprange(bs_, 0.22, 0.12),
                                         g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.48)), 0.1, 0.05)))
    qk = g.math('MULTIPLY', is_leg, g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.46)), 0.11, 0.06))
    qt = g.math('MULTIPLY', is_tor, g.math('MULTIPLY', g.maprange(bs_, 0.8, 0.86), g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bth, 90.0)), 60.0, 40.0)))
    quilt_m = g.math('MULTIPLY', g.math('MAXIMUM', g.math('MAXIMUM', qa, qk), qt), isfab)
    rq1 = g.nt.nodes.new('ShaderNodeMapping')
    g.link(obj, rq1.inputs['Vector'])
    rq1.inputs['Rotation'].default_value = (0.0, 0.0, 0.785)
    rq2 = g.nt.nodes.new('ShaderNodeMapping')
    g.link(obj, rq2.inputs['Vector'])
    rq2.inputs['Rotation'].default_value = (0.785, 0.0, 0.0)
    qline = g.math('MAXIMUM', g.maprange(g.wave(rq1.outputs['Vector'], 36.0, 'BANDS', 0.0, 0.0, 'Z').outputs['Fac'], 0.9, 0.99),
                   g.maprange(g.wave(rq2.outputs['Vector'], 36.0, 'BANDS', 0.0, 0.0, 'Z').outputs['Fac'], 0.9, 0.99))
    quilt = g.math('MULTIPLY', qline, quilt_m)
    col = g.mix(g.math('MULTIPLY', quilt, 0.5), col, hexc(P['grime']))
    # ---- wear where use goes: knees, elbows, seat, cuffs (edge), and grime toward the feet
    knees = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.5)), 0.08, 0.02),
                   g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part, 2.0)), 1.2, 0.8))
    wn = g.noise(obj, 18.0, 5.0, 0.65)
    wearm = g.math('MULTIPLY', g.math('ADD', knees, g.math('MULTIPLY', edge, 0.6)), g.maprange(wn.outputs['Fac'], 0.4, 0.7))
    col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', wearm, isfab), 0.8), col, hexc(P['wear']))
    # scuffs: pale abraded flecks over the worn patches of knees and elbows
    scuff = g.math('MULTIPLY', g.math('MULTIPLY', knees, isfab), g.maprange(g.noise(obj, 70.0, 4.0, 0.7).outputs['Fac'], 0.58, 0.68))
    col = g.mix(g.math('MULTIPLY', scuff, 0.7), col, hexc(P['salt']))
    low = g.maprange(z, 0.55, 0.05)
    gn = g.noise(obj, 6.0, 4.0, 0.6)
    grime = g.math('MULTIPLY', low, g.maprange(gn.outputs['Fac'], 0.35, 0.75))
    col = g.mix(g.math('MULTIPLY', grime, 0.45), col, hexc(P['grime']))
    if people == 'thalune':
        # salt bloom and a tide line on the lower legs
        tide = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', z, 0.36 + 0.0)), 0.03, 0.005)
        sb = g.math('MULTIPLY', g.maprange(g.noise(obj, 40.0, 5.0, 0.7).outputs['Fac'], 0.55, 0.75), g.math('ADD', low, tide))
        col = g.mix(g.math('MULTIPLY', sb, 0.6), col, hexc(P['salt']))
    # ---- roughness and normal
    rough = g.math('ADD', g.math('MULTIPLY', isfab, 0.72), g.math('ADD', g.math('MULTIPLY', isplate, 0.3 if people == 'thalune' else 0.38),
                   g.math('ADD', g.math('MULTIPLY', isband, 0.55), g.math('MULTIPLY', isfit, 0.45))))
    rough = g.math('ADD', rough, g.math('MULTIPLY', g.math('SUBTRACT', wn.outputs['Fac'], 0.5), 0.12))
    metal = g.math('MULTIPLY', isfit, g.maprange(fitn.outputs['Fac'], 0.42, 0.3, 0.0, 0.6))   # bare brass of the fittings only
    h = g.math('ADD', g.math('MULTIPLY', wv, g.math('MULTIPLY', isfab, 0.4)), g.math('MULTIPLY', seam, -0.8))
    h = g.math('ADD', h, g.math('MULTIPLY', stitch, 0.7))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', quilt, 0.9))
    h = g.math('ADD', h, g.math('MULTIPLY', quilt_m, 0.25))
    h = g.math('ADD', h, g.math('MULTIPLY', g.math('MULTIPLY', pn.outputs['Fac'], isplate), 0.3))
    nb = g.bump(h, 0.35, 0.0012)
    principled(g, col, rough, nb, metal=metal)
    m['auth'] = True
    return m


def suit_ulgani(name):
    """Ulgani suits (LIB_Membrane over LIB_Chitin, with LIB_SuitWeave's seams, padding and wear): amber membrane panels
    stretched between grown members, darker where they fuse into them, repaired with paler patches with torn
    borders, a fibre weave and stitching in the normal map, quilting over shoulders, elbows and knees, wear at knees
    and elbows, grime toward the feet; chitin members weathering from amber through brown to grey, darker at the fused
    fillets, growth rings, lichen in the sheltered knots; spore sacs paler and veined; the cartridge ports dark."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    obj = tc.outputs['Object']
    kind = g.attr('kind')
    edge = g.attr('edge')
    part = g.attr('part')
    bs_ = g.attr('bs')
    bth = g.attr('bth')
    fil = g.attr('fillet')
    mt = g.attr('mt')
    rib = g.attr('rib')
    sep = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(obj, sep.inputs['Vector'])
    z = sep.outputs['Z']
    ischit = g.maprange(kind, 5.5, 5.8)
    isport = g.maprange(kind, 8.6, 8.9)
    issac = g.math('MULTIPLY', g.maprange(kind, 7.6, 7.9), g.maprange(kind, 8.6, 8.3))
    isjoint = g.math('MULTIPLY', g.maprange(kind, 6.6, 6.9), g.maprange(kind, 7.4, 7.1))
    ischit = g.math('MAXIMUM', g.math('MULTIPLY', ischit, g.maprange(kind, 7.6, 7.3)), isjoint)
    isfab = g.math('MULTIPLY', g.maprange(kind, 0.5, 0.1), g.maprange(rib, 0.5, 0.2))
    isrib = g.maprange(rib, 0.4, 0.7)
    is_tor = g.maprange(g.math('ABSOLUTE', part), 0.5, 0.2)
    is_arm = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part, 1.0)), 0.5, 0.2)
    is_leg = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part, 3.0)), 0.5, 0.2)
    # ---- membrane (LIB_Membrane with LIB_SuitWeave's treatment): pale ivory-tan, mottled like grown skin, a fibre
    # weave in the normal map, darker where it fuses into the members along its edges, repaired with paler patches
    # whose borders are torn and fused, padded (quilted) over shoulders, elbows and knees, worn at knees and elbows
    mott = g.noise(obj, 4.0, 4.0, 0.6)
    memb = g.mix(g.maprange(mott.outputs['Fac'], 0.35, 0.7), hexc('#C69A5C'), hexc('#AE8148'))
    veins = g.voronoi(g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 7.0, 2.0, 0.5).outputs['Color'], (0.02, 0.02, 0.02))), 9.0,
                      'DISTANCE_TO_EDGE', 1.0)
    vm = g.maprange(veins.outputs['Distance'], 0.01, 0.003)
    memb = g.mix(g.math('MULTIPLY', vm, 0.35), memb, hexc('#A9844E'))
    fuse = g.maprange(edge, 0.25, 0.85)
    memb = g.mix(g.math('MULTIPLY', fuse, 0.55), memb, hexc('#7E5E36'))
    pw = g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 14.0, 3.0, 0.6).outputs['Color'], (0.03, 0.03, 0.03)))
    pc = g.voronoi(pw, 5.0, 'F1', 1.0)
    pick = g.maprange(g.math('FRACT', g.math('MULTIPLY', g.vmath('DOT_PRODUCT', pc.outputs['Color'], (1.0, 0.31, 0.17)), 7.3)), 0.72, 0.76)
    prad = g.math('ADD', 0.16, g.math('MULTIPLY', g.noise(obj, 30.0, 3.0, 0.6).outputs['Fac'], 0.12))
    patch = g.math('MULTIPLY', pick, g.maprange(g.math('DIVIDE', pc.outputs['Distance'], prad), 1.0, 0.9))
    pborder = g.math('MULTIPLY', pick, g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', g.math('DIVIDE', pc.outputs['Distance'], prad), 1.0)), 0.12, 0.02))
    memb = g.mix(g.math('MULTIPLY', patch, 0.85), memb, hexc('#E6D3AC'))
    memb = g.mix(g.math('MULTIPLY', pborder, 0.6), memb, hexc('#A07E52'))
    weave = g.math('MULTIPLY', g.maprange(g.wave(obj, 420.0, 'BANDS', 1.5, 1.0, 'Z').outputs['Fac'], 0.2, 0.8),
                   g.maprange(g.wave(obj, 420.0, 'BANDS', 1.5, 1.0, 'X').outputs['Fac'], 0.2, 0.8))
    qa = g.math('MULTIPLY', is_arm, g.math('MAXIMUM', g.maprange(bs_, 0.2, 0.12),
                                         g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.5)), 0.09, 0.05),
                                                g.maprange(g.math('ABSOLUTE', bth), 110.0, 140.0))))
    qk = g.math('MULTIPLY', is_leg, g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.5)), 0.1, 0.05),
                                         g.maprange(g.math('ABSOLUTE', bth), 75.0, 45.0)))
    quilt_m = g.math('MAXIMUM', qa, qk)
    rot = g.nt.nodes.new('ShaderNodeMapping')
    g.link(obj, rot.inputs['Vector'])
    rot.inputs['Rotation'].default_value = (0.0, 0.0, 0.785)
    q1 = g.wave(rot.outputs['Vector'], 34.0, 'BANDS', 0.0, 0.0, 'Z')
    rot2 = g.nt.nodes.new('ShaderNodeMapping')
    g.link(obj, rot2.inputs['Vector'])
    rot2.inputs['Rotation'].default_value = (0.785, 0.0, 0.0)
    q2 = g.wave(rot2.outputs['Vector'], 34.0, 'BANDS', 0.0, 0.0, 'Z')
    qline = g.math('MAXIMUM', g.maprange(q1.outputs['Fac'], 0.9, 0.99), g.maprange(q2.outputs['Fac'], 0.9, 0.99))
    quilt = g.math('MULTIPLY', qline, quilt_m)
    memb = g.mix(g.math('MULTIPLY', quilt, 0.45), memb, hexc('#A88A60'))
    dash = g.maprange(g.wave(obj, 230.0, 'BANDS', 0.0, 0.0, 'Z').outputs['Fac'], 0.7, 0.92)
    dash2 = g.maprange(g.wave(obj, 230.0, 'BANDS', 0.0, 0.0, 'X').outputs['Fac'], 0.7, 0.92)
    seam = g.math('MAXIMUM', g.maprange(fuse, 0.5, 0.9), pborder)
    stitch = g.math('MULTIPLY', g.math('MAXIMUM', dash, dash2), g.maprange(seam, 0.3, 0.8))
    memb = g.mix(g.math('MULTIPLY', stitch, 0.6), memb, hexc('#6E5236'))
    # ---- chitin: amber weathering to grey along the growth, darker fillets, growth rings, lichen in the knots
    # (weathered by exposure: greyest toward a member's ends and on the spans facing the sky, amber in the sheltered
    # middles and undersides)
    wn = g.noise(obj, 3.5, 3.0, 0.55)
    gch = g.nt.nodes.new('ShaderNodeNewGeometry')
    ends = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', mt, 0.5)), 0.12, 0.5)
    expo = g.maprange(g.vmath('DOT_PRODUCT', gch.outputs['Normal'], (0.0, 0.35, 0.94)), -0.2, 0.85)
    wfac = g.math('ADD', g.math('MULTIPLY', wn.outputs['Fac'], 0.5),
                  g.math('ADD', g.math('MULTIPLY', ends, 0.38), g.math('MULTIPLY', expo, 0.32)))
    wfac = g.math('ADD', wfac, g.math('MULTIPLY', g.noise(obj, 18.0, 3.0, 0.6).outputs['Fac'], 0.18))
    chit = g.ramp(g.maprange(wfac, 0.42, 1.05),
                  [(0.0, hexc('#DA972B')), (0.3, hexc('#C08A3C')), (0.6, hexc('#9C8466')), (1.0, hexc('#8E8B85'))])
    rings = g.maprange(g.math('FRACT', g.math('MULTIPLY', mt, 9.0)), 0.85, 1.0)
    chit = g.mix(g.math('MULTIPLY', rings, 0.25), chit, hexc('#6B5034'))
    chit = g.mix(g.math('MULTIPLY', fil, 0.75), chit, hexc('#4E3B2C'))
    lich = g.math('MULTIPLY', g.math('MAXIMUM', fil, isjoint), g.maprange(g.noise(obj, 60.0, 3.0, 0.6).outputs['Fac'], 0.52, 0.64))
    chit = g.mix(g.math('MULTIPLY', lich, 0.82), chit, hexc('#94A07A'))
    # ---- sacs: paler membrane, veined
    sacc = g.mix(g.math('MULTIPLY', vm, 0.6), hexc('#E6D3A6'), hexc('#9A7444'))
    col = memb
    col = g.mix(isrib, col, hexc('#B98134'))
    col = g.mix(ischit, col, chit)
    col = g.mix(issac, col, sacc)
    col = g.mix(isport, col, hexc('#2A2018'))
    # ---- wear where use goes, grime toward the feet
    knees = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.5)), 0.08, 0.02),
                   g.math('MAXIMUM', is_leg, is_arm))
    wn2 = g.noise(obj, 18.0, 5.0, 0.65)
    wearm = g.math('MULTIPLY', g.math('ADD', knees, g.math('MULTIPLY', edge, 0.7)), g.maprange(wn2.outputs['Fac'], 0.4, 0.7))
    col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', wearm, isfab), 0.55), col, hexc('#B09670'))
    low = g.maprange(z, 0.5, 0.04)
    grime = g.math('MULTIPLY', low, g.maprange(g.noise(obj, 6.0, 4.0, 0.6).outputs['Fac'], 0.35, 0.75))
    col = g.mix(g.math('MULTIPLY', grime, 0.5), col, hexc('#2E2A22'))
    # ---- roughness, normal
    rough = g.math('ADD', g.math('MULTIPLY', isfab, 0.62), g.math('ADD', g.math('MULTIPLY', ischit, 0.45), g.math('MULTIPLY', issac, 0.55)))
    rough = g.math('ADD', rough, g.math('MULTIPLY', isrib, 0.45))
    rough = g.math('ADD', rough, g.math('MULTIPLY', g.math('SUBTRACT', wn2.outputs['Fac'], 0.5), 0.1))
    rough = g.math('ADD', rough, g.math('MULTIPLY', wearm, 0.12))
    h = g.math('ADD', g.math('MULTIPLY', vm, g.math('MULTIPLY', isfab, 0.3)), g.math('MULTIPLY', seam, -0.7))
    h = g.math('ADD', h, g.math('MULTIPLY', stitch, 0.35))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', quilt, 0.9))
    h = g.math('ADD', h, g.math('MULTIPLY', g.math('MULTIPLY', weave, isfab), 0.3))
    h = g.math('ADD', h, g.math('MULTIPLY', g.math('MULTIPLY', rings, ischit), 0.25))
    h = g.math('ADD', h, g.math('MULTIPLY', g.noise(obj, 120.0, 3.0, 0.6).outputs['Fac'], 0.15))
    nb = g.bump(h, 0.35, 0.0012)
    principled(g, col, rough, nb, metal=g.math('MULTIPLY', kind, 0.0))
    m['auth'] = True
    return m


def suit_ixari(name):
    """Ixari suits: deep slate-violet fabric (LIB_SuitWeave: seams with stitching, a faint embossed hexagon weave,
    wear at knees and elbows, soot toward the feet); grown facet plates and prisms in a pale lilac-grey crystal-stone,
    each facet its own value, chips paler at the edges, clouding inside; slate socket collars (LIB_SlateStone) sooted
    round the crystal; light running in the seams where crystal meets collar and along the prisms' growth lines."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    obj = tc.outputs['Object']
    geo = g.nt.nodes.new('ShaderNodeNewGeometry')
    pnt = geo.outputs['Pointiness']
    kind = g.attr('kind')
    seam_a = g.attr('seam')
    edge = g.attr('edge')
    part = g.attr('part')
    bs_ = g.attr('bs')
    bth = g.attr('bth')
    sep = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(obj, sep.inputs['Vector'])
    z = sep.outputs['Z']
    isfab = g.maprange(kind, 0.5, 0.1)
    isfacet = g.math('MULTIPLY', g.maprange(kind, 8.5, 8.8), g.maprange(kind, 9.5, 9.2))
    iscol = g.maprange(kind, 9.5, 9.8)
    is_tor = g.maprange(g.math('ABSOLUTE', part), 0.5, 0.2)
    is_arm = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part, 1.0)), 0.5, 0.2)
    is_leg = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part, 3.0)), 0.5, 0.2)
    # fabric
    n1 = g.noise(obj, 3.0, 3.0, 0.55)
    fab = g.mix(g.maprange(n1.outputs['Fac'], 0.35, 0.7), hexc('#2E2A3F'), hexc('#24202F'))
    flank = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', g.math('ABSOLUTE', bth), 90.0)), 28.0, 18.0)
    panel = g.math('MULTIPLY', flank, is_tor)
    fab = g.mix(panel, fab, hexc('#3A3550'))
    hexw = g.voronoi(obj, 140.0, 'DISTANCE_TO_EDGE', 0.0, 'EUCLIDEAN')
    hx = g.maprange(hexw.outputs['Distance'], 0.0, 0.08)
    fab = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', 1.0, hx), 0.4), fab, hexc('#17141F'))
    seam_p = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', panel, 0.5)), 0.12, 0.02)
    seam_w = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.36)), 0.005, 0.0012), is_tor)
    seam_s = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.03)), 0.006, 0.0015), is_arm)
    seam = g.math('MAXIMUM', g.math('MAXIMUM', seam_p, seam_w), seam_s)
    dash = g.maprange(g.wave(obj, 230.0, 'BANDS', 0.0, 0.0, 'Z').outputs['Fac'], 0.7, 0.92)
    stitch = g.math('MULTIPLY', dash, g.maprange(seam, 0.3, 0.8))
    fab = g.mix(g.math('MULTIPLY', seam, 0.5), fab, hexc('#0F0D14'))
    fab = g.mix(g.math('MULTIPLY', stitch, 0.6), fab, hexc('#7E6FB0'))
    knees = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.5)), 0.1, 0.03), g.math('MAXIMUM', is_leg, is_arm))
    wn = g.noise(obj, 18.0, 5.0, 0.65)
    wear = g.math('MULTIPLY', g.math('ADD', knees, g.math('MULTIPLY', edge, 0.5)), g.maprange(wn.outputs['Fac'], 0.35, 0.6))
    fab = g.mix(g.math('MULTIPLY', wear, 0.9), fab, hexc('#6E6886'))
    # seams that follow the muscle groups: under the pectorals, round the deltoids, down the outer arm and leg
    s_pec = g.math('MULTIPLY', is_tor, g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, g.math('ADD', 0.7, g.math('MULTIPLY', g.math('ABSOLUTE', bth), -0.0006)))), 0.006, 0.0015))
    s_delt = g.math('MULTIPLY', is_arm, g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bs_, 0.2)), 0.007, 0.002))
    s_out = g.math('MULTIPLY', g.math('MAXIMUM', is_arm, is_leg), g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', g.math('ABSOLUTE', bth), 90.0)), 2.5, 0.8))
    mseam = g.math('MAXIMUM', g.math('MAXIMUM', s_pec, s_delt), s_out)
    mstitch = g.math('MULTIPLY', dash, g.maprange(mseam, 0.3, 0.8))
    fab = g.mix(g.math('MULTIPLY', mseam, 0.55), fab, hexc('#0F0D14'))
    fab = g.mix(g.math('MULTIPLY', mstitch, 0.6), fab, hexc('#8E7FC4'))
    # padded panels (plates in fabric) quilted in diamonds
    ispad = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', kind, 1.0)), 0.5, 0.1)
    rq1 = g.nt.nodes.new('ShaderNodeMapping')
    g.link(obj, rq1.inputs['Vector'])
    rq1.inputs['Rotation'].default_value = (0.0, 0.0, 0.785)
    rq2 = g.nt.nodes.new('ShaderNodeMapping')
    g.link(obj, rq2.inputs['Vector'])
    rq2.inputs['Rotation'].default_value = (0.785, 0.0, 0.0)
    qline = g.math('MAXIMUM', g.maprange(g.wave(rq1.outputs['Vector'], 40.0, 'BANDS', 0.0, 0.0, 'Z').outputs['Fac'], 0.9, 0.99),
                   g.maprange(g.wave(rq2.outputs['Vector'], 40.0, 'BANDS', 0.0, 0.0, 'Z').outputs['Fac'], 0.9, 0.99))
    quilt = g.math('MULTIPLY', qline, ispad)
    fab = g.mix(g.math('MULTIPLY', quilt, 0.6), fab, hexc('#141019'))
    fab = g.mix(g.math('MULTIPLY', ispad, 0.25), fab, hexc('#3D3754'))
    # facets: pale lilac-grey stone-crystal, value per facet (object-space cells), chips at edges, clouding
    cell = g.voronoi(obj, 60.0, 'F1', 1.0)
    fv = g.math('FRACT', g.math('MULTIPLY', g.vmath('DOT_PRODUCT', cell.outputs['Color'], (1.0, 0.37, 0.13)), 5.1))
    facet = g.mix(fv, hexc('#7E6FC4'), hexc('#A897EE'))
    facet = g.mix(g.math('MULTIPLY', g.maprange(g.noise(obj, 25.0, 4.0, 0.6, distortion=1.0).outputs['Fac'], 0.5, 0.75), 0.4), facet, hexc('#5A4C9A'))
    facet = g.mix(g.math('MULTIPLY', g.maprange(pnt, 0.55, 0.66), 0.45), facet, hexc('#D6CCF6'))
    # collars: slate, sooted
    slate = g.mix(g.maprange(g.noise(obj, 60.0, 4.0, 0.6).outputs['Fac'], 0.35, 0.7), hexc('#3A3F4A'), hexc('#1A1C22'))
    slate = g.mix(g.math('MULTIPLY', g.maprange(g.noise(obj, 14.0, 3.0, 0.6).outputs['Fac'], 0.5, 0.7), 0.6), slate, hexc('#0E0F12'))
    col = g.mix(isfacet, fab, facet)
    col = g.mix(iscol, col, slate)
    low = g.maprange(z, 0.45, 0.04)
    col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', low, g.maprange(g.noise(obj, 6.0, 4.0, 0.6).outputs['Fac'], 0.35, 0.75)), 0.45), col, hexc('#0E0F12'))
    # light in the seams: where crystal meets collar, and the prisms' growth lines
    emc = g.mix(g.maprange(g.noise(obj, 5.0, 1.0, 0.5).outputs['Fac'], 0.35, 0.65), hexc('#B9A6FF'), hexc('#64E3FF'))
    # (only the seam line itself and the facet edges glow, in the crystal's own lilac-cyan, never white)
    glow = g.math('MULTIPLY', g.maprange(seam_a, 0.55, 0.95), g.math('MAXIMUM', isfacet, iscol))
    fedge = g.math('MULTIPLY', g.math('MULTIPLY', g.maprange(pnt, 0.56, 0.64), isfacet), 0.35)
    em = g.mix(g.math('MINIMUM', g.math('ADD', glow, fedge), 1.0), hexc('#000000'), emc)
    rough = g.math('ADD', g.math('MULTIPLY', g.math('MAXIMUM', isfab, ispad), 0.72), g.math('ADD', g.math('MULTIPLY', isfacet, 0.14), g.math('MULTIPLY', iscol, 0.74)))
    rough = g.math('ADD', rough, g.math('MULTIPLY', g.math('SUBTRACT', wn.outputs['Fac'], 0.5), 0.08))
    h = g.math('ADD', g.math('MULTIPLY', g.math('SUBTRACT', 1.0, hx), g.math('MULTIPLY', isfab, 0.25)), g.math('MULTIPLY', seam, -0.7))
    h = g.math('ADD', h, g.math('MULTIPLY', stitch, 0.5))
    h = g.math('ADD', h, g.math('MULTIPLY', mstitch, 0.5))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', mseam, 0.7))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', quilt, 0.9))
    h = g.math('ADD', h, g.math('MULTIPLY', g.noise(obj, 140.0, 3.0, 0.6).outputs['Fac'], 0.15))
    nb = g.bump(h, 0.3, 0.0012)
    principled(g, col, rough, nb, metal=g.math('MULTIPLY', kind, 0.0), emission=em, estr=0.6)
    m['auth'] = True
    return m


def _regions(g, col, rough, mouth_col, lip_col, rim_col):
    """Mouth bag, lip borders and the lids' inner rims, from the head's one-hot region masks (head.region_masks)."""
    mouth = g.maprange(g.attr('m_mouth'), 0.2, 0.8)
    col = g.mix(mouth, col, hexc(mouth_col))
    lip = g.maprange(g.attr('m_lip'), 0.0, 1.0)
    col = g.mix(g.math('MULTIPLY', lip, 0.7), col, hexc(lip_col))
    rim = g.maprange(g.attr('m_rim'), 0.3, 1.0)
    col = g.mix(g.math('MULTIPLY', rim, 0.8), col, hexc(rim_col))
    rough = g.mixf(g.math('MAXIMUM', mouth, g.math('MULTIPLY', rim, 0.8)), rough, 0.25)
    return col, rough


def ixari_skin(name='AUTH_IX_Skin'):
    """Slate-dark skin: stratified like layered stone, faceted micro-plates, faint lilac-to-cyan mineral veins (the
    crystal pattern character creation tints), soot-dark bands along the spine and the outer forearms where the
    crystal sockets sit."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    obj = tc.outputs['Object']
    geo = g.nt.nodes.new('ShaderNodeNewGeometry')
    pnt = geo.outputs['Pointiness']
    n1 = g.noise(obj, 2.2, 3.0, 0.55)
    # (a slate grey nearly neutral inside the bible's range: the bluer end read navy under the noon sky)
    base = g.mix(g.maprange(n1.outputs['Fac'], 0.3, 0.72), hexc('#373B44'), hexc('#484D57'))
    # darker slate in the creases and at the joints, paler over the bony convexities
    base = g.mix(g.math('MULTIPLY', g.maprange(pnt, 0.5, 0.42), 0.6), base, hexc('#2A2D34'))
    base = g.mix(g.math('MULTIPLY', g.maprange(pnt, 0.53, 0.6), 0.3), base, hexc('#555A65'))
    sepz = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(obj, sepz.inputs['Vector'])
    face = g.maprange(sepz.outputs['Z'], 1.62, 1.7)
    strata = g.wave(obj, 38.0, 'BANDS', 4.0, 3.0, 'Z')
    plates = g.voronoi(g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 9.0, 2.0, 0.5).outputs['Color'], (0.01, 0.01, 0.01))), 40.0,
                       'DISTANCE_TO_EDGE', 0.95, 'CHEBYCHEV')
    pl = g.maprange(plates.outputs['Distance'], 0.0, 0.05)
    pmask = g.math('MULTIPLY', g.maprange(g.noise(obj, 3.0, 2.0, 0.5).outputs['Fac'], 0.42, 0.6), 0.16)
    base = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', g.math('SUBTRACT', 1.0, pl), 0.3), pmask), base, hexc('#22262E'))
    veins = g.voronoi(g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 6.0, 2.0, 0.5).outputs['Color'], (0.03, 0.03, 0.03))), 16.0,
                      'DISTANCE_TO_EDGE', 1.0)
    vm = g.maprange(veins.outputs['Distance'], 0.012, 0.003)
    # the crystal pattern gathers toward the crystal sites (spine, outer forearms) and thins elsewhere
    bth_ = g.attr('bth')
    part_ = g.attr('part')
    near_sp = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', bth_), 120.0, 170.0), g.maprange(part_, 0.5, 0.2))
    near_fa = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', g.math('ABSOLUTE', bth_), 140.0)), 60.0, 20.0),
                     g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part_, 1.0)), 0.5, 0.2))
    sites = g.math('MAXIMUM', near_sp, near_fa)
    vmask = g.math('MAXIMUM', g.math('MULTIPLY', g.maprange(g.noise(obj, 3.0, 2.0, 0.5).outputs['Fac'], 0.56, 0.68), 0.6), sites)
    vcol = g.mix(g.maprange(g.noise(obj, 1.5, 1.0, 0.5).outputs['Fac'], 0.3, 0.7), hexc('#9A86E0'), hexc('#5FB8D0'))
    # (cracks crowd round the crystal sites and fade over the face)
    crack = g.math('MULTIPLY', g.math('MULTIPLY', g.math('SUBTRACT', 1.0, pl), sites), g.math('SUBTRACT', 1.0, face))
    base = g.mix(g.math('MULTIPLY', crack, 0.45), base, hexc('#1C2027'))
    col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', g.math('MULTIPLY', vm, vmask), 0.5), g.math('SUBTRACT', 1.0, face)), base, vcol)
    bth = g.attr('bth')
    part = g.attr('part')
    spine = g.math('MULTIPLY', g.maprange(bth, 160.0, 176.0), g.maprange(part, 0.5, 0.2))
    fore = g.math('MULTIPLY', g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', bth, 120.0)), 40.0, 15.0),
                  g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', part, 1.0)), 0.5, 0.2))
    soot = g.math('MULTIPLY', g.math('MAXIMUM', spine, fore), g.maprange(g.noise(obj, 20.0, 4.0, 0.6).outputs['Fac'], 0.3, 0.6))
    col = g.mix(g.math('MULTIPLY', soot, 0.7), col, hexc('#121418'))
    # (dry stone, not wet: a broad soft sheen; the veins barely glossier)
    rough = g.math('ADD', 0.6, g.math('MULTIPLY', g.math('SUBTRACT', n1.outputs['Fac'], 0.5), 0.08))
    rough = g.math('SUBTRACT', rough, g.math('MULTIPLY', vm, 0.06))
    col, rough = _regions(g, col, rough, '#3A2448', '#1E222A', '#0E1014')
    h = g.math('ADD', g.math('MULTIPLY', pl, g.math('MULTIPLY', g.math('MULTIPLY', sites, g.math('SUBTRACT', 1.0, face)), 0.8)),
               g.math('MULTIPLY', strata.outputs['Fac'], 0.0))
    h = g.math('ADD', h, g.math('MULTIPLY', g.noise(obj, 220.0, 3.0, 0.5).outputs['Fac'], 0.3))
    nb = g.bump(h, 0.22, 0.0012)
    principled(g, col, rough, nb)
    m['auth'] = True
    return m


def eye_ixari(name='AUTH_IX_Eye'):
    """Pale luminous lilac-to-cyan iris with a dark slit pupil; the glow is the people's biolume."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    c = g.vmath('SUBTRACT', tc.outputs['UV'], (0.5, 0.5, 0.0))
    r = g.vmath('LENGTH', c)
    sepn = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(c, sepn.inputs['Vector'])
    pupil = g.math('ADD', g.math('POWER', g.math('ABSOLUTE', g.math('MULTIPLY', sepn.outputs['X'], 3.5)), 2.0),
                   g.math('POWER', g.math('ABSOLUTE', sepn.outputs['Y']), 2.0))
    pm = g.maprange(pupil, 0.004, 0.0025)
    irisn = g.noise(g.vmath('MULTIPLY', c, (40.0, 40.0, 1.0)), 5.0, 4.0, 0.6)
    iris = g.mix(g.maprange(r, 0.04, 0.17), hexc('#9FE6F5'), hexc('#8C6BE0'))
    iris = g.mix(g.math('MULTIPLY', irisn.outputs['Fac'], 0.35), iris, hexc('#3B2A70'))
    col = g.mix(pm, iris, hexc('#05060A'))
    col = g.mix(g.maprange(r, 0.18, 0.22), col, hexc('#1A1C24'))
    rough = g.math('ADD', g.maprange(r, 0.2, 0.3, 0.04, 0.4), g.math('MULTIPLY', irisn.outputs['Fac'], 0.03))
    em = g.mix(g.math('MULTIPLY', g.maprange(r, 0.19, 0.15), g.math('SUBTRACT', 1.0, pm)), hexc('#000000'), hexc('#7FD8E8'))
    nb = g.bump(irisn.outputs['Fac'], 0.2, 0.001)
    principled(g, col, rough, nb, emission=em, estr=1.2)
    m['auth'] = True
    return m


def ixari_crystal(name='AUTH_IX_Crystal'):
    """LIB_GrownCrystal: lilac #B9A6FF shafts, deeper violet clouding in the core (toward the root and in drifting
    veils), chips paler at the facet edges, growth lines that carry the light (emissive lilac-to-cyan along the
    terraces only; the body of the crystal does not glow); slate socket collars with soot."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    obj = tc.outputs['Object']
    geo = g.nt.nodes.new('ShaderNodeNewGeometry')
    pnt = geo.outputs['Pointiness']
    gpart = g.attr('gpart')
    glow = g.attr('glow')
    gv = g.attr('gv')
    cloud = g.noise(obj, 22.0, 4.0, 0.62, distortion=1.5)
    crys = g.mix(g.maprange(cloud.outputs['Fac'], 0.35, 0.68), hexc('#B9A6FF'), hexc('#8A6FE6'))
    crys = g.mix(g.math('MULTIPLY', g.maprange(gv, 0.45, 0.0), 0.6), crys, hexc('#5A3CB4'))      # clouded toward the root
    crys = g.mix(g.math('MULTIPLY', g.maprange(pnt, 0.55, 0.65), 0.55), crys, hexc('#E4DCFF'))   # chipped, paler edges
    collar = g.maprange(gpart, 0.5, 0.9)
    stone = g.mix(g.maprange(g.noise(obj, 60.0, 4.0, 0.6).outputs['Fac'], 0.35, 0.7), hexc('#353A45'), hexc('#16181D'))
    col = g.mix(collar, crys, stone)
    emc = g.mix(g.maprange(g.noise(obj, 6.0, 1.0, 0.5).outputs['Fac'], 0.35, 0.65), hexc('#9C7CFF'), hexc('#3FD2F5'))
    lines = g.math('MULTIPLY', glow, g.math('SUBTRACT', 1.0, collar))
    # the light runs up the crystal's core: a line down the middle of every facet, brightening toward the tip, and a
    # faint floor so a shaft still reads lilac-cyan at LOD2 range
    core = g.math('MULTIPLY', g.maprange(g.attr('core'), 0.35, 1.0), g.math('ADD', 0.42, g.math('MULTIPLY', gv, 0.4)))
    inner = g.math('MULTIPLY', g.math('SUBTRACT', 1.0, collar), g.math('MAXIMUM', core, 0.1))
    em = g.mix(g.math('MAXIMUM', lines, inner), hexc('#000000'), emc)
    rough = g.mixf(collar, g.math('ADD', 0.14, g.math('MULTIPLY', cloud.outputs['Fac'], 0.1)), 0.72)
    h = g.math('ADD', g.math('MULTIPLY', glow, 0.3), g.math('MULTIPLY', g.noise(obj, 160.0, 3.0, 0.5).outputs['Fac'], 0.25))
    nb = g.bump(h, 0.2, 0.001)
    principled(g, col, rough, nb, emission=em, estr=2.0)
    m['auth'] = True
    return m


def ulgani_skin(name='AUTH_UL_Skin', slits=()):
    """Pale porous skin that takes in air (art bible 2.3, LIB_Skin_Ulgani): ivory to bone in broad soft variation
    (#E8E1CF-#CFC4A8), warmer in the creases, paler on the convexities; breathing pits gathered in clusters of
    different sizes over the shoulders, back and flanks (deep in the normal map, a warm shadow in colour, nothing
    elsewhere); fine branching amber veins, densest round the neck, the shoulders and the rib slits; the rib slits
    themselves (`slits`: (top, bottom) object-space points per opening) dark and wet between pale raised lips."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    obj = tc.outputs['Object']
    geo = g.nt.nodes.new('ShaderNodeNewGeometry')
    Nn = geo.outputs['Normal']
    pnt = geo.outputs['Pointiness']
    n1 = g.noise(obj, 2.2, 3.0, 0.55)
    # (warm ivory to bone: the noon sky's blue ambient greyed the cooler values to plaster)
    base = g.mix(g.maprange(n1.outputs['Fac'], 0.3, 0.72), hexc('#F0E1C0'), hexc('#DAC59C'))
    curv = g.maprange(pnt, 0.44, 0.56)
    base = g.mix(g.math('MULTIPLY', g.maprange(pnt, 0.5, 0.41), 0.6), base, hexc('#A48C66'))
    base = g.mix(g.math('MULTIPLY', g.maprange(pnt, 0.52, 0.6), 0.35), base, hexc('#F5F0E3'))
    sep = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(obj, sep.inputs['Vector'])
    z = sep.outputs['Z']
    sepn = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(Nn, sepn.inputs['Vector'])
    dors = g.math('ADD', g.vmath('DOT_PRODUCT', Nn, (0.0, 0.9, 0.5)), g.math('MULTIPLY', g.math('ABSOLUTE', sepn.outputs['X']), 0.7))
    col = base
    # a faint warm pigment on the back and shoulders (soft, low contrast: no smudges)
    pig = g.noise(g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 3.0, 2.0, 0.5).outputs['Color'], (0.05, 0.05, 0.05))), 4.0, 4.0, 0.55)
    col = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', g.maprange(pig.outputs['Fac'], 0.5, 0.68), g.maprange(dors, 0.0, 0.6)), 0.3), col, hexc('#D2B98C'))
    # pit clusters: discs of 2-5 cm on the shoulders, back and flanks (upper body), each a crowd of pits of mixed size
    region = g.math('MULTIPLY', g.maprange(dors, -0.1, 0.45), g.math('MULTIPLY', g.maprange(z, 0.85, 1.0), g.maprange(z, 1.62, 1.5)))
    warp = g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 9.0, 2.0, 0.5).outputs['Color'], (0.025, 0.025, 0.025)))
    cl = g.voronoi(warp, 8.5, 'F1', 1.0)
    csize = g.math('ADD', 0.16, g.math('MULTIPLY', g.vmath('DOT_PRODUCT', cl.outputs['Color'], (0.33, 0.33, 0.34)), 0.18))
    cluster = g.math('MULTIPLY', g.maprange(g.math('DIVIDE', cl.outputs['Distance'], csize), 1.0, 0.6), region)
    # (pits of 2-5 mm, big and deep enough to read at turntable distance)
    pv = g.voronoi(g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 40.0, 2.0, 0.5).outputs['Color'], (0.003, 0.003, 0.003))), 85.0, 'F1', 1.0)
    psize = g.math('ADD', 0.18, g.math('MULTIPLY', g.vmath('DOT_PRODUCT', pv.outputs['Color'], (0.4, 0.3, 0.3)), 0.24))
    pd = g.math('DIVIDE', pv.outputs['Distance'], psize)
    hole = g.math('MULTIPLY', g.maprange(pd, 1.0, 0.55), cluster)
    halo = g.math('MULTIPLY', g.maprange(pd, 1.7, 1.0), cluster)
    col = g.mix(g.math('MULTIPLY', cluster, 0.3), col, hexc('#CDB890'))
    col = g.mix(g.math('MULTIPLY', halo, 0.4), col, hexc('#B89A6C'))
    col = g.mix(g.math('MULTIPLY', hole, 0.92), col, hexc('#5A4430'))
    # fine branching veins: a warped cell network at two scales, the finer one branching off the coarser
    vreg = g.math('ADD', g.math('MULTIPLY', g.maprange(z, 1.2, 1.55), 0.8), g.math('MULTIPLY', g.maprange(g.noise(obj, 2.5, 2.0, 0.5).outputs['Fac'], 0.5, 0.62), 0.6))
    vw = g.vmath('ADD', obj, g.vmath('MULTIPLY', g.noise(obj, 6.0, 3.0, 0.6).outputs['Color'], (0.05, 0.05, 0.05)))
    v1 = g.voronoi(vw, 8.0, 'DISTANCE_TO_EDGE', 1.0)
    v2 = g.voronoi(g.vmath('ADD', vw, g.vmath('MULTIPLY', g.noise(obj, 22.0, 2.0, 0.5).outputs['Color'], (0.01, 0.01, 0.01))), 24.0, 'DISTANCE_TO_EDGE', 1.0)
    l1 = g.maprange(v1.outputs['Distance'], 0.012, 0.003)
    l2 = g.math('MULTIPLY', g.maprange(v2.outputs['Distance'], 0.03, 0.008), g.maprange(v1.outputs['Distance'], 0.09, 0.02))
    # (none over the face: there they read as a crackle and a grey smudge on the nose)
    vreg = g.math('MULTIPLY', vreg, g.maprange(z, 1.78, 1.68))
    vm = g.math('MULTIPLY', g.math('MAXIMUM', l1, g.math('MULTIPLY', l2, 0.8)), g.math('MINIMUM', vreg, 1.0))
    col = g.mix(g.math('MULTIPLY', vm, 0.45), col, hexc('#B4844A'))
    # clustered freckles (sparse, faint)
    frk = g.voronoi(obj, 55.0, 'F1', 1.0)
    fm = g.math('MULTIPLY', g.maprange(frk.outputs['Distance'], 0.2, 0.1), g.maprange(g.noise(obj, 3.5, 2.0, 0.5).outputs['Fac'], 0.6, 0.7))
    col = g.mix(g.math('MULTIPLY', fm, 0.4), col, hexc('#C29A62'))
    # rib slits: a wet dark cut between two pale raised lips
    core = None
    lips = None
    for a, b in slits:
        cm = seg_mask(g, obj, a, b, 0.0048, 0.0048, 0.5)
        lm = seg_mask(g, obj, a, b, 0.0155, 0.0155, 0.45)
        core = cm if core is None else g.math('MAXIMUM', core, cm)
        lips = lm if lips is None else g.math('MAXIMUM', lips, lm)
    rough = g.math('ADD', 0.64, g.math('MULTIPLY', g.math('SUBTRACT', n1.outputs['Fac'], 0.5), 0.08))
    rough = g.math('ADD', rough, g.math('MULTIPLY', hole, 0.1))
    rough = g.math('SUBTRACT', rough, g.math('MULTIPLY', g.math('SUBTRACT', 1.0, curv), 0.05))
    if core is not None:
        lipring = g.math('MULTIPLY', lips, g.math('SUBTRACT', 1.0, core))
        col = g.mix(g.math('MULTIPLY', lipring, 0.6), col, hexc('#F4EEE0'))
        col = g.mix(g.math('MULTIPLY', lips, g.maprange(pnt, 0.5, 0.42)), col, hexc('#9A7A58'))
        col = g.mix(core, col, hexc('#3A2A20'))
        rough = g.mixf(core, rough, 0.22)
    col, rough = _regions(g, col, rough, '#6B3F30', '#A88C70', '#7A5E48')
    h = g.math('MULTIPLY', g.noise(obj, 160.0, 4.0, 0.55).outputs['Fac'], 0.18)
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', hole, 3.2))
    h = g.math('ADD', h, g.math('MULTIPLY', halo, 0.35))
    h = g.math('ADD', h, g.math('MULTIPLY', vm, 0.18))
    h = g.math('ADD', h, g.math('MULTIPLY', g.noise(obj, 40.0, 3.0, 0.6).outputs['Fac'], 0.07))
    if core is not None:
        h = g.math('ADD', h, g.math('MULTIPLY', lips, 0.5))
        h = g.math('SUBTRACT', h, g.math('MULTIPLY', core, 1.4))
    nb = g.bump(h, 0.6, 0.0012)
    principled(g, col, rough, nb)
    m['auth'] = True
    return m


def eye_ulgani(name='AUTH_UL_Eye'):
    """Deep amber-ochre eyes with no white: radial iris fibres darkening to a sooty limbal ring, a wide horizontal
    pupil, the outer eyeball a dark wet umber (only the iris shows between the lids)."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    c = g.vmath('SUBTRACT', tc.outputs['UV'], (0.5, 0.5, 0.0))
    r = g.vmath('LENGTH', c)
    sep = g.nt.nodes.new('ShaderNodeSeparateXYZ')
    g.link(c, sep.inputs['Vector'])
    ang = g.math('ARCTAN2', sep.outputs['Y'], sep.outputs['X'])
    comb = g.nt.nodes.new('ShaderNodeCombineXYZ')
    g.link(g.math('MULTIPLY', ang, 6.0), comb.inputs['X'])
    g.link(g.math('MULTIPLY', r, 40.0), comb.inputs['Y'])
    fib = g.noise(comb.outputs['Vector'], 3.0, 4.0, 0.6)
    iris = g.mix(g.maprange(r, 0.03, 0.15), hexc('#E7B04A'), hexc('#8C5A1E'))
    iris = g.mix(g.math('MULTIPLY', g.maprange(fib.outputs['Fac'], 0.42, 0.7), 0.55), iris, hexc('#5A3412'))
    iris = g.mix(g.math('MULTIPLY', g.maprange(fib.outputs['Fac'], 0.6, 0.45), 0.35), iris, hexc('#F3CF7A'))
    iris = g.mix(g.maprange(r, 0.13, 0.17), iris, hexc('#2B1A0C'))   # limbal ring
    # horizontal pupil: an ellipse 2.4:1
    ex = g.math('MULTIPLY', sep.outputs['X'], 1.0)
    ey = g.math('MULTIPLY', sep.outputs['Y'], 2.4)
    comb2 = g.nt.nodes.new('ShaderNodeCombineXYZ')
    g.link(ex, comb2.inputs['X'])
    g.link(ey, comb2.inputs['Y'])
    pr = g.vmath('LENGTH', comb2.outputs['Vector'])
    col = g.mix(g.maprange(pr, 0.058, 0.05), iris, hexc('#070504'))
    col = g.mix(g.maprange(r, 0.17, 0.2), col, hexc('#3A2A1C'))   # the outer eyeball: dark wet umber
    rough = g.math('ADD', g.maprange(r, 0.18, 0.3, 0.05, 0.3), g.math('MULTIPLY', fib.outputs['Fac'], 0.03))
    nb = g.bump(fib.outputs['Fac'], 0.15, 0.0008)
    principled(g, col, rough, nb)
    m['auth'] = True
    return m


def ulgani_frond(name='AUTH_UL_Frond'):
    """Spore-fronds: amber stalks paling to ivory, leaflets with darker veins and pale margins, spore nodules that
    glow spore-green (LIB_CapFlesh's spore points)."""
    m = new(name)
    g = G(m)
    tc = g.coords()
    obj = tc.outputs['Object']
    gpart = g.attr('gpart')
    glow = g.attr('glow')
    gv = g.attr('gv')
    stalk = g.mix(gv, hexc('#D9962B'), hexc('#F2EAD3'))
    leaf = g.mix(g.maprange(gv, 0.0, 0.5), hexc('#DDB878'), hexc('#F4ECD6'))
    veins = g.wave(obj, 220.0, 'BANDS', 3.0, 2.0)
    leaf = g.mix(g.math('MULTIPLY', g.maprange(veins.outputs['Fac'], 0.85, 1.0), 0.5), leaf, hexc('#7A5420'))
    isleaf = g.maprange(g.math('ABSOLUTE', g.math('SUBTRACT', gpart, 2.0)), 0.5, 0.1)
    isnod = g.math('MULTIPLY', g.maprange(gpart, 2.5, 2.9), g.maprange(gpart, 3.6, 3.2))
    iscap = g.maprange(gpart, 3.6, 3.9)
    col = g.mix(isleaf, stalk, leaf)
    # gill lamellae under the outer leaf: fine ridges across the blade, warmer and darker between them
    gill = g.attr('gill')
    lam = g.maprange(g.wave(obj, 700.0, 'BANDS', 2.0, 1.0, 'Z').outputs['Fac'], 0.3, 0.7)
    col = g.mix(g.math('MULTIPLY', gill, 0.85), col, g.mix(lam, hexc('#A9773C'), hexc('#E6D2A2')))
    capc = g.mix(g.maprange(g.noise(obj, 80.0, 3.0, 0.6).outputs['Fac'], 0.35, 0.7), hexc('#D8A24A'), hexc('#F0E2BC'))
    col = g.mix(iscap, col, capc)
    col = g.mix(g.math('MULTIPLY', iscap, glow), col, hexc('#D9F28A'))
    col = g.mix(isnod, col, hexc('#E6F7A8'))
    spot = g.voronoi(obj, 300.0, 'F1', 1.0)
    sm = g.math('MULTIPLY', g.maprange(spot.outputs['Distance'], 0.2, 0.08), g.math('MULTIPLY', isleaf, g.maprange(gv, 0.4, 1.0)))
    col = g.mix(g.math('MULTIPLY', sm, 0.6), col, hexc('#C7F06A'))
    em = g.mix(g.math('MAXIMUM', glow, g.math('MULTIPLY', sm, 0.6)), hexc('#000000'), hexc('#C7F06A'))
    rough = g.math('ADD', 0.55, g.math('MULTIPLY', isnod, -0.3))
    h = g.math('ADD', g.math('MULTIPLY', g.maprange(veins.outputs['Fac'], 0.85, 1.0), 0.4), g.math('MULTIPLY', g.noise(obj, 200.0, 3.0, 0.5).outputs['Fac'], 0.2))
    h = g.math('ADD', h, g.math('MULTIPLY', g.math('MULTIPLY', gill, lam), 0.6))
    nb = g.bump(h, 0.3, 0.001)
    principled(g, col, rough, nb, emission=em, estr=0.9)
    m['auth'] = True
    return m
