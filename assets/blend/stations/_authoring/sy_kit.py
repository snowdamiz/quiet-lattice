"""The Scrapyard kit (DESIGN 13): the Free Reaches' base in a hollowed asteroid. sy_rock is the rock with its cavity and
mouth; sy_mouth a welded girder gate bolted into the mouth; sy_dock a cantilevered landing pad; sy_deck the deck to
fight across, with cover and a container hold. Docks and decks mount on the cavity wall at the rock's Socket_* anchors."""
import math

import numpy as np
from mathutils import Matrix, Vector

import kit as K

R0 = 80.0
MOUTH = math.radians(19.0)
INNER = 0.64
rng0 = np.random.default_rng(1317)
WAVES = [(rng0.normal(size=3), rng0.uniform(1.5, 6.0), rng0.uniform(0, 6.28)) for _ in range(18)]
CRATERS = [(rng0.normal(size=3), rng0.uniform(0.12, 0.34), rng0.uniform(0.06, 0.14)) for _ in range(12)]


def _dir(theta, phi):
    """theta from -Y (the mouth), phi round it."""
    return np.array([math.sin(theta) * math.cos(phi), -math.cos(theta), math.sin(theta) * math.sin(phi)])


AXES = (0.92, 1.32, 0.78)  # an elongated rock, the mouth at the end of its long axis
LOBE = np.array([0.55, 0.35, 0.76])


def radius(d, inner=False):
    ell = 1.0 / math.sqrt((d[0] / AXES[0]) ** 2 + (d[1] / AXES[1]) ** 2 + (d[2] / AXES[2]) ** 2)
    lobe = 1 + 0.16 * max(0.0, float(np.dot(d, LOBE / np.linalg.norm(LOBE)))) ** 3
    return ell * lobe * _radius(d, inner)


def _radius(d, inner=False):
    f = 0.0
    tot = 0.0
    for k, fr, ph in WAVES:
        k = k / np.linalg.norm(k)
        a = 1.0 / fr
        f += a * math.sin(np.dot(k, d) * fr + ph)
        tot += a
    f /= tot
    ridge = 1 - abs(math.sin(d[0] * 2.3 + d[2] * 1.7 + 0.4))
    r = R0 * (1 + 0.24 * f + 0.10 * math.sin(d[0] * 2.1 + 1.0) * math.cos(d[2] * 1.6) + 0.07 * ridge ** 3 + 0.12 * max(0.0, d[1]) ** 2)
    if not inner:
        for c, size, depth in CRATERS:
            c = c / np.linalg.norm(c)
            x = math.acos(max(-1, min(1, np.dot(c, d)))) / size
            if x < 2.0:
                bowl = -depth * (1 - x * x) if x < 1 else 0.0
                rim = depth * 0.45 * math.exp(-(((x - 1) / 0.28) ** 2))
                r *= 1 + bowl + rim
        return r
    return r * INNER * (1 + 0.05 * f)


def mouth_theta(phi, inner=False):
    """The broken mouth: its rim angle wanders with phi, deeper bites where the rock sheared away."""
    t = MOUTH * (1 + 0.16 * math.sin(phi * 3 + 0.7) + 0.09 * math.sin(phi * 7 + 2.1) + 0.05 * math.sin(phi * 13))
    return t * (1.35 if inner else 1.0)


def rock_patch(m, grid, inner=False):
    # Each face projects on its dominant plane: the rim and pole do not pinch into UV rings.
    # Broad material regions describe dust hollows and exhaust soot at the cavity throat.
    for i in range(len(grid) - 1):
        for j in range(len(grid[0]) - 1):
            pts = [grid[i,j], grid[i+1,j], grid[i+1,j+1], grid[i,j+1]]
            c = np.mean(pts, axis=0)
            normal = np.cross(pts[1]-pts[0], pts[3]-pts[0])
            axes = [k for k in range(3) if k != int(np.argmax(np.abs(normal)))]
            dust = (c[2] < -18 and c[1] > -35) or (inner and c[1] < -30) or (c[0] > 28 and c[1] > 10 and c[2] < 14)
            mat = "SY_Regolith" if dust else "SY_Rock"
            uv = [(q[axes[0]] / 18, q[axes[1]] / 18) for q in pts]
            m.add(pts, uv, mat, True, toward=(0,0,0) if inner else None, away=None if inner else (0,0,0))


def rail(m, a, b, lod):
    a, b = np.asarray(a, float), np.asarray(b, float)
    n = max(1, math.ceil(np.linalg.norm(b-a)/2.5))
    for t in np.linspace(0,1,n+1):
        p = a + (b-a)*t
        K.tube(m, [p, p+[0,0,1.05]], 0.065, 6 if lod == 0 else 4, "SY_Scrap", "girder")
    for z in (0.48,1.05):
        K.tube(m, [a+[0,0,z], b+[0,0,z]], 0.05, 6 if lod == 0 else 4, "SY_Scrap", "girder")


def hull_panel(m, width, y0, y1, z, lod, shift=(0,0,0)):
    # A piece of a Thalune hull, with radiating ribs retained under the Reaches paint.
    h = K.Mesh()
    prof = [(x, z + 1.25*(1-(x/width)**2)) for x in np.linspace(-width,width,9 if lod == 0 else 5)]
    K.lapped_rows(h, prof, y0,y1,"SY_Scrap",lambda i: "hull" if i%3 else "oxide",row=1.0,lap=0.09,lod=lod,seed=42,seg_m=0.65,edge_mat=("SY_Scrap","girder"),away=(0,(y0+y1)/2,z-3))
    for k in range(-2,3):
        x = width*k/2.5
        pts = [(x*(0.35+0.65*t), y1+(y0-y1)*t, z+1.25*(1-(x*(0.35+0.65*t)/width)**2)+0.13) for t in np.linspace(0,1,8 if lod==0 else 4)]
        K.tube(h,pts,0.11,6 if lod==0 else 4,"SY_Scrap","girder")
    m.extend(h, Matrix.Translation(shift))


def shell(m, lod, inner):
    nu = (72, 44, 22, 14)[lod] if not inner else (56, 36, 18, 10)[lod]
    nv = (40, 24, 12, 7)[lod] if not inner else (30, 20, 10, 6)[lod]
    phis = np.linspace(0, 2 * math.pi, nu + 1)
    g = np.zeros((nu + 1, nv, 3))
    for i, p in enumerate(phis):
        t0 = mouth_theta(p, inner)
        for j, t in enumerate(np.linspace(0, 1, nv)):
            t = t0 + (math.pi - 0.08 - t0) * (t ** 0.85)
            d = _dir(t, p)
            g[i, j] = d * radius(d, inner)
    g[-1] = g[0]
    rock_patch(m, g, inner)
    # close the back pole
    cap = g[:-1, -1]
    c = cap.mean(0)
    for i in range(len(cap)):
        a, b = cap[i], cap[(i + 1) % len(cap)]
        m.add([a, b, c], [(q[0]/18, q[2]/18) for q in (a,b,c)], "SY_Rock", True, away=None if inner else (0, 0, 0), toward=(0, 0, 0) if inner else None)
    return g


def tunnel(m, lod):
    """The mouth: rock folding from the outer rim into the cavity, jagged where it broke."""
    nu = (72, 44, 22, 14)[lod]
    rings = (7, 4, 2, 1)[lod]
    phis = np.linspace(0, 2 * math.pi, nu + 1)
    g = np.zeros((nu + 1, rings + 1, 3))
    for i, p in enumerate(phis):
        a = _dir(mouth_theta(p), p) * radius(_dir(mouth_theta(p), p))
        b = _dir(mouth_theta(p, True), p) * radius(_dir(mouth_theta(p, True), p), True)
        for j in range(rings + 1):
            t = j / rings
            q = a * (1 - t) + b * t
            # bulge toward the axis in the middle: a throat
            ax = np.array([0, q[1], 0])
            q = q + (ax - q) * 0.12 * math.sin(t * math.pi) * (1 + 0.4 * math.sin(p * 5 + 1.3))
            g[i, j] = q
    g[-1] = g[0]
    rock_patch(m, g, True)
    return g


def patch_plates(m, lod):
    """Salvage plates bolted over breaches in the rock: the Reaches patch what they cannot fix. Every LOD keeps every
    plate (LOD2-3 as flat quads without frames), so the colour patches never pop."""
    rng = np.random.default_rng(9)
    for k in range(14):
        t = rng.uniform(0.5, 2.6)
        p = rng.uniform(0, 2 * math.pi)
        d = _dir(t, p)
        c = d * (radius(d) + 0.35)
        n = d
        up = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
        x = np.cross(up, n)
        x /= np.linalg.norm(x)
        y = np.cross(n, x)
        w, h = rng.uniform(6, 14), rng.uniform(4, 9)
        key = ["plate", "oxide", "patch"][k % 3]
        onto = lambda q, lift=0.3: (q / np.linalg.norm(q)) * (radius(q / np.linalg.norm(q)) + lift)
        nn = 4 if lod <= 1 else 1
        grid = np.zeros((nn + 1, nn + 1, 3))
        for i in range(nn + 1):
            for j in range(nn + 1):
                grid[i, j] = onto(c + x * (i / nn - 0.5) * w + y * (j / nn - 0.5) * h)
        K.patch(m, grid, "SY_Scrap", key, away=c - n * 3)
        if lod >= 2:
            continue
        edge = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5), (-0.5, -0.5)]
        for e in range(4):
            (a0, b0), (a1, b1) = edge[e], edge[e + 1]
            pts = [onto(c + x * (a0 + (a1 - a0) * t) * w + y * (b0 + (b1 - b0) * t) * h, 0.45) for t in np.linspace(0, 1, 5)]
            K.tube(m, pts, 0, 0, "SY_Scrap", "girder", smooth=False, up=tuple(n), profile=[(-0.18, -0.15), (0.18, -0.15), (0.18, 0.15), (-0.18, 0.15), (-0.18, -0.15)])


def rock_lod(lod):
    m = K.Mesh()
    shell(m, lod, False)
    shell(m, lod, True)
    tunnel(m, lod)
    patch_plates(m, lod)
    if lod <= 2:
        for theta, phi, height in ((1.15,1.4,22),(0.8,2.7,15),(1.9,0.7,18)):
            d = _dir(theta,phi)
            base = d * radius(d)
            for dx in (-0.7,0.7):
                K.member(m, base + [dx,0,-2], base+[dx,0,height], 0.22,"SY_Scrap","girder",lod, bow=0.012)
            for z in (5,10,15):
                if z < height:
                    K.member(m, base+[-0.7,0,z],base+[0.7,0,z+4],0.12,"SY_Scrap","girder",lod)
            K.beam(m,base+[-4,0,height-3],base+[4,0,height-3],0.3,0.3,"SY_Scrap","patch",up=(0,1,0))
            K.revolve(m,[(0,0),(0.45,0.3),(0.45,0.8)],8 if lod==0 else 6,"NavReaches",None,center=base+[0,0,height],axis="z")
        # The visible approach frame is socketed into the actual rim, not floating outside it.
        for phi in np.linspace(0,2*math.pi,9)[:-1]:
            d = _dir(mouth_theta(phi),phi); base = d * radius(d)
            tip = base + [0,-11,0]
            K.member(m, base,tip,0.55,"SY_Scrap","girder",lod, bow_dir=(math.cos(phi),0,math.sin(phi)))
            K.revolve(m,[(0,0),(0.55,0.25),(0.55,0.6)],8 if lod==0 else 6,"NavReaches",None,center=tip,axis="y")
    return m


def mouth_lod(lod):
    """A welded octagon of girders in the mouth, struts into the rock, floodlights and a hazard-striped lintel."""
    m = K.Mesh()
    r = 25.0
    n = 8
    pts = [np.array([math.cos(a) * r * (1 + 0.07*math.sin(k*2.1)), 0.0, math.sin(a) * r * (1 + 0.07*math.sin(k*2.1))]) for k,a in enumerate(np.linspace(0, 2 * math.pi, n + 1) + math.pi / 8)]
    pts[-1] = pts[0].copy()
    for i in range(n):
        a, b = pts[i], pts[i + 1]
        if lod == 3:
            K.tube(m, [a, b], 1.4, 3, "SY_Scrap", "girder", smooth=False, up=(0, 1, 0))
            continue
        # an I-beam: two flanges and a web
        d = (b - a) / np.linalg.norm(b - a)
        out = np.cross(d, np.array([0, 1.0, 0]))
        K.beam(m, a + out * 1.0, b + out * 1.0, 0.3, 2.4, "SY_Scrap", "girder", up=(0, 1, 0))
        K.beam(m, a - out * 1.0, b - out * 1.0, 0.3, 2.4, "SY_Scrap", "girder", up=(0, 1, 0))
        K.beam(m, a, b, 2.0, 0.35, "SY_Scrap", "plate" if i % 3 else "oxide", up=(0, 1, 0))
        if lod <= 2:
            # struts into the rock, splayed
            for s in (-1, 1):
                p0 = a + (b - a) * (0.3 if s < 0 else 0.7)
                p1 = p0 + (p0 / np.linalg.norm(p0)) * 7.0 + np.array([0, -3.0 + s * 1.5, 0])
                K.member(m, p0, p1, 0.35, "SY_Scrap", "girder", lod, bow_dir=(0,1,0))
            # gussets welded across each corner, a cable run along the inside flange
            if lod == 0:
                c_ = a / np.linalg.norm(a)
                for s2 in (-1, 1):
                    K.beam(m, a + d * 3.0 + np.array([0, s2 * 1.0, 0]), a - c_ * 2.8 + np.array([0, s2 * 1.0, 0]), 0.25, 0.25, "SY_Scrap", "girder", up=(0, 1, 0))
                K.tube(m, [a - out * 1.3 + np.array([0, -0.8, 0]), b - out * 1.3 + np.array([0, -0.8, 0])], 0.18, 6, "SY_Scrap", "girder")
                for t in (0.25, 0.5, 0.75):
                    p_ = a + (b - a) * t
                    K.box(m, (-0.8, -1.25, -0.8), (0.8, 1.25, 0.8), "SY_Scrap", ["patch", "oxide", "plate"][(i + int(t * 4)) % 3], xf=Matrix.Translation(Vector(p_ + out * 1.25)) @ Matrix.Rotation(-math.atan2(d[2], d[0]), 4, "Y"))
            # floodlights at the nodes
            K.box(m, (-0.9, -1.6, -0.6), (0.9, -0.2, 0.6), "SY_Scrap", "lamp", xf=Matrix.Translation(Vector(a * 0.95)) @ Matrix.Rotation(-math.atan2(a[2], a[0]), 4, "Y"))
    if lod <= 1:
        for i,a in enumerate(pts[:-1]):
            # Visible beads and corner bolts at the field-welded joints.
            for j in range(12 if lod == 0 else 6):
                p = a + [-1.2+j*0.2,-1.28,0.1*math.sin(j)]
                K.revolve(m,[(0.09,0),(0.12,0.04),(0,0.08)],6,"SY_Scrap","girder",center=p,axis="y")
        # One damaged bay is plated over with a ribbed salvaged shell.
        panel = K.Mesh()
        hull_panel(panel,6,-2,2,0,lod)
        m.extend(panel,Matrix.Translation((19,-1,6)) @ Matrix.Rotation(math.pi/2,4,"X"))
    if lod <= 2:
        # the lintel: a hazard band across the top of the gate, mismatched patch plates hung below it
        K.box(m, (-14.0, -1.2, r * 0.86), (14.0, 0.6, r * 0.86 + 2.2), "SY_Scrap", "hazard")
        for k, x in enumerate(np.arange(-12.0, 12.1, 4.0)):
            K.box(m, (x - 1.9, -0.6, r * 0.86 - 2.5 - (k % 2) * 0.6), (x + 1.9, -0.2, r * 0.86), "SY_Scrap", ["patch", "oxide", "plate"][k % 3])
    if lod <= 2:
        for a in (0.3, 2.8):
            p = np.array([math.cos(a) * (r + 1.4), -1.3, math.sin(a) * (r + 1.4)])
            K.revolve(m, [(0.0, 0.0), (0.5, 0.3), (0.5, 0.7)], 8, "NavReaches", None, center=tuple(p), axis="y", away=tuple(p + [0, 2, 0]))
    return m


def dock_lod(lod, large=False):
    """A 26 m landing pad on a girder cantilever, anchored to the cavity wall at y = 0, the pad toward -Y."""
    m = K.Mesh()
    R = 18.0 if large else 12.5
    cy = -R - 4.5
    seg = (48, 28, 16, 8)[lod]
    ang = np.linspace(0, 2 * math.pi, seg + 1)[:-1] + math.pi / seg
    top = [(math.cos(a) * R, cy + math.sin(a) * R, 0.0) for a in ang]
    bot = [(math.cos(a) * R, cy + math.sin(a) * R, -1.2) for a in ang]
    K.planar(m, top, "SY_Grate")
    if lod == 3:
        K.box(m, (-R, cy - R, -1.2), (R, cy + R, 0.0), "SY_Scrap", "oxide", keys={"+z": "plate"}, skip=("+z",))
        K.box(m, (-8.0, -0.6, -14.0), (8.0, 0.0, 2.0), "SY_Scrap", "oxide", skip=("+y",))
        return m
    for k in range(seg):
        k2 = (k + 1) % seg
        approach = math.sin(ang[k]) < -0.55
        K.patch(m, [[bot[k], top[k]], [bot[k2], top[k2]]], "SY_Scrap", "hazard" if approach else "oxide", away=(0, cy, -0.6))
    K.planar(m, bot[::-1], "SY_Scrap", toward=lambda c: c + np.array([0, 0, -1.0]))
    if lod <= 2:
        # the pad ring: a welded band of patch plates, landing lamps on it
        ring_o = [(math.cos(a) * (R - 0.5), cy + math.sin(a) * (R - 0.5), 0.05) for a in ang]
        ring_i = [(math.cos(a) * (R - 2.0), cy + math.sin(a) * (R - 2.0), 0.05) for a in ang]
        for k in range(seg):
            k2 = (k + 1) % seg
            K.patch(m, [[ring_i[k], ring_o[k]], [ring_i[k2], ring_o[k2]]], "SY_Scrap", "patch", toward=lambda c: c + np.array([0, 0, 1.0]))
        if lod <= 2:
            for a in np.linspace(0,2*math.pi,9)[:-1]:
                p = np.array([math.cos(a)*(R-0.5),cy+math.sin(a)*(R-0.5),0.10])
                K.revolve(m, [(0.0, 0.25), (0.25, 0.15), (0.3, 0.0)], 6, "NavReaches", None, center=tuple(p), axis="z", away=tuple(p - [0, 0, 1]))
    # cantilever: two deep girders back to the anchor plate, braced
    for x in (-5.0, 5.0):
        K.beam(m, np.array([x, cy + 4.0, -1.6]), np.array([x, 0.0, -1.6]), 0.8, 2.2, "SY_Scrap", "girder", up=(1, 0, 0))
        if lod <= 2:
            K.beam(m, np.array([x, cy + 2.0, -2.7]), np.array([x, 0.0, -12.0]), 0.7, 0.7, "SY_Scrap", "girder", up=(1, 0, 0))
    K.box(m, (-8.0, -0.6, -14.0), (8.0, 0.0, 2.0), "SY_Scrap", "oxide", skip=("+y",) if lod == 3 else ())
    if lod == 0:
        # bollards and a fuel line round the pad, cable reels at the hatch
        for k in range(0, seg, 4):
            p = np.array([math.cos(ang[k]) * (R - 1.0), cy + math.sin(ang[k]) * (R - 1.0), 0.0])
            K.revolve(m, [(0.25, 0.0), (0.2, 0.6), (0.3, 0.7), (0.0, 0.75)], 8, "SY_Scrap", "girder", center=tuple(p), axis="z", away=tuple(p - [0, 0, 1]))
        ring = [np.array([math.cos(a) * (R + 0.35), cy + math.sin(a) * (R + 0.35), -0.6]) for a in np.linspace(0.3, 2 * math.pi - 0.3, 25)]
        K.tube(m, ring, 0.14, 6, "SY_Scrap", "girder")
        for x in (-2.5, 2.5):
            K.revolve(m, [(0.7, 0.0), (0.7, 0.5)], 12, "SY_Scrap", "patch", center=(x, -1.4, 0.7), axis="x", away=(x, -1.4, 0.7))
        for x in np.arange(-7.0, 7.1, 2.0):
            K.box(m, (x - 0.5, -cy * 0 - 0.75, -12.0), (x + 0.5, -0.6, -11.6), "SY_Scrap", "girder")
    if lod <= 1:
        for z in (-12.0, -6.0, 0.0):
            for x in (-6.5, 6.5):
                K.revolve(m, [(0.25, 0.0), (0.25, 0.35), (0.0, 0.4)], 6, "SY_Scrap", "girder", center=(x, -0.6, z), axis="y", away=(x, 0, z))
        # a walkway from the pad's edge to a hatch in the anchor plate
        K.box(m, (-1.2, cy + R - 1.5, -0.3), (1.2, -0.6, 0.0), "SY_Scrap", "plate", keys={"+z": "plate"})
        K.box(m, (-1.0, -0.65, 0.0), (1.0, -0.6, 2.6), "SY_Scrap", "hazard")
    if lod <= 2:
        # Actual curved lattice supports join the cantilever, with a burn ring on the working pad.
        for x in (-5.0,5.0):
            for k in range(6):
                y = cy + k*(-cy)/6
                K.member(m,(x,y,-1.3),(x,y-cy/6,-5.5),0.22,"SY_Scrap","girder",lod,bow_dir=(1,0,0))
                K.member(m,(x,y,-5.5),(x,y-cy/6,-1.3),0.22,"SY_Scrap","girder",lod,bow_dir=(1,0,0))
            K.chord(m,[(x,cy,-5.5),(x,0,-5.5)],0.35,"SY_Scrap","girder",lod)
        for k in range(seg):
            a,b=ang[k],ang[(k+1)%seg]
            K.patch(m, [[(math.cos(a)*R*.25,cy+math.sin(a)*R*.25,.07),(math.cos(a)*R*.82,cy+math.sin(a)*R*.82,.07)],[(math.cos(b)*R*.25,cy+math.sin(b)*R*.25,.07),(math.cos(b)*R*.82,cy+math.sin(b)*R*.82,.07)]],"SY_Scrap","burn",toward=lambda c:c+[0,0,1])
        panel=K.Mesh(); hull_panel(panel,8,-7,7,0,lod)
        m.extend(panel,Matrix.Translation((0,-0.8,-6)) @ Matrix.Rotation(math.pi/2,4,"X"))
        for x in (-7.8,7.8):
            K.beam(m,(x,-.7,-14),(x,-.7,2),.5,.5,"SY_Scrap","girder",bevel=.1)
        K.box(m,(R-2,cy-1.2,-.2),(R,cy+1.2,0),"SY_Scrap","walk")
    return m


def cover_layout():
    rng = np.random.default_rng(4)
    for k in range(7):
        x=-12+k*3.6+rng.uniform(-.5,.5); y=-11+rng.uniform(-1,1.5); a=rng.uniform(-.4,.4)
        yield k,Matrix.Translation((x,y,0)) @ Matrix.Rotation(a,4,"Z")


def deck_lod(lod):
    """The fight deck: a 30 x 14 m grated platform, welded cover plates, a container hold, railings; anchored at y = 0."""
    m = K.Mesh()
    X, Y0, Y1 = 15.0, -14.0, 0.0
    K.planar(m, [(-X, Y0, 0), (X, Y0, 0), (X, Y1, 0), (-X, Y1, 0)], "SY_Grate")
    K.patch(m, [[(-X, Y0, -1.0), (-X, Y0, 0.0)], [(X, Y0, -1.0), (X, Y0, 0.0)]], "SY_Scrap", "hazard", toward=lambda c: c + np.array([0, -1.0, 0]))
    K.planar(m, [(-X, Y0, -1.0), (-X, Y1, -1.0), (X, Y1, -1.0), (X, Y0, -1.0)], "SY_Scrap", toward=lambda c: c + np.array([0, 0, -1.0]))
    for s in (-1, 1):
        K.patch(m, [[(s * X, Y0, -1.0), (s * X, Y0, 0.0)], [(s * X, Y1, -1.0), (s * X, Y1, 0.0)]], "SY_Scrap", "plate", toward=lambda c, s=s: c + np.array([s, 0, 0]))
    if lod == 3:
        K.box(m, (4.0, -6.0, 0.0), (10.0, -3.5, 2.6), "SY_Scrap", "oxide")
        return m
    # walkway strip of worn patch plates across the deck (where the crews walk)
    K.box(m, (-X + 0.5, -8.0, 0.0), (X - 0.5, -6.6, 0.04), "SY_Scrap", "walk", skip=("-z",))
    # container hold: a salvaged container with a hatch (3.0 x 2.0 m service size)
    K.box(m, (3.0, -6.2, 0.0), (12.0, -3.2, 2.9), "SY_Scrap", "oxide", keys={"+z": "plate", "-y": "oxide"})
    if lod <= 1:
        for x in np.arange(3.3, 12.0, 0.6):
            K.box(m, (x, -6.28, 0.1), (x + 0.25, -6.2, 2.8), "SY_Scrap", "oxide")
        K.box(m, (6.4, -6.35, 0.0), (8.6, -6.25, 3.0), "SY_Scrap", "hazard")
    # cover: angled welded plates and crates across the deck
    for k,xf in cover_layout():
        if k % 2:
            K.box(m, (-1.4, -0.12, 0.0), (1.4, 0.12, 1.25), "SY_Scrap", ["patch", "plate", "oxide"][k % 3], xf=xf)
            if lod <= 1:
                K.box(m, (-1.2, 0.12, 0.0), (-1.0, 0.7, 1.0), "SY_Scrap", "girder", xf=xf)
                K.box(m, (1.0, 0.12, 0.0), (1.2, 0.7, 1.0), "SY_Scrap", "girder", xf=xf)
        else:
            K.box(m, (-0.7, -0.7, 0.0), (0.7, 0.7, 1.1), "SY_Scrap", "plate", keys={"+z": "patch"}, xf=xf)
    # railings along the open edge: girder posts and a pipe rail at 1.05 m
    for x0, x1 in ((-X, X),):
        n = 10 if lod <= 1 else 4
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            K.box(m, (x - 0.06, Y0 + 0.05, 0.0), (x + 0.06, Y0 + 0.2, 1.05), "SY_Scrap", "girder")
        K.tube(m, [(x0, Y0 + 0.12, 1.05), (x1, Y0 + 0.12, 1.05)], 0.04, 6 if lod <= 1 else 4, "SY_Scrap", "girder")
    if lod == 0:
        # straps on the crates, a pipe run along the deck's back edge, bollards at the open edge
        K.tube(m, [(-X + 0.6, -0.6, 0.5), (X - 0.6, -0.6, 0.5)], 0.2, 8, "SY_Scrap", "girder")
        K.tube(m, [(-X + 0.6, -1.1, 0.35), (X - 0.6, -1.1, 0.35)], 0.13, 6, "SY_Scrap", "oxide")
        for x in np.arange(-X + 1.5, X, 3.0):
            K.box(m, (x - 0.2, -1.4, 0.0), (x + 0.2, -0.3, 0.8), "SY_Scrap", "girder")
        for x in (-13.0, -4.0, 5.0):
            K.revolve(m, [(0.22, 0.0), (0.18, 0.5), (0.26, 0.6), (0.0, 0.65)], 8, "SY_Scrap", "girder", center=(x, Y0 + 0.8, 0.0), axis="z", away=(x, Y0 + 0.8, -1))
    # deck lamps under the hold's eave
    if lod <= 2:
        K.box(m, (3.5, -6.6, 2.5), (11.5, -6.3, 2.7), "SY_Scrap", "lamp")
    # anchor beams into the rock
    for x in (-10.0, 0.0, 10.0):
        K.beam(m, np.array([x, Y1 - 1.0, -1.0]), np.array([x, Y1 + 0.5, -8.0]), 0.6, 0.6, "SY_Scrap", "girder", up=(1, 0, 0))
    if lod <= 2:
        hull_panel(m,4.6,-6.4,-3.0,2.8,lod,shift=(7.5,0,0))
        K.crystal_insert(m,(10,-6.4,1.6),(0,-1,0),(1,0,0),2.3,1.1,lod,seed=7,mats=("SY_Scrap","girder","SY_Glass","SY_Glass"))
        K.tube(m,[(9.1,-6.94,1.6),(9.8,-6.95,1.8),(10.2,-6.94,1.2),(10.7,-6.95,1.4)],.025,4,"SY_Scrap","girder")
        for y in (-12,-7,-2):
            K.chord(m,[(-15,y,-.6),(0,y,-1.8),(15,y,-.6)],.3,"SY_Scrap","girder",lod,nodes=(0,1,2))
            for x in range(-15,15,5):
                K.member(m,(x,y,-.6),(x+2.5,y,-4.5),.24,"SY_Scrap","girder",lod)
                K.member(m,(x+2.5,y,-4.5),(x+5,y,-.6),.24,"SY_Scrap","girder",lod)
        for x in (-15,15):
            rail(m,(x,-14,0),(x,-8.3,0),lod)
            rail(m,(x,-5.7,0),(x,0,0),lod)
        for k,xf in cover_layout():
            if lod <= 1:
                for x in (-.6,.6):
                    for z in (.12,.95):
                        bolt=K.Mesh();K.revolve(bolt,[(.09,0),(.09,.06),(0,.08)],8,"SY_Scrap","girder",center=(x,-.72 if not k%2 else -.14,z),axis="y")
                        m.extend(bolt,xf)
        if lod == 0:
            for x in np.arange(3.15,12,.3):
                K.tube(m,[(x,-6.36,.15),(x,-6.36,2.7)],.055,6,"SY_Scrap","oxide")
            for x in (3,12):
                for y in (-6.2,-3.2):
                    for z in (.1,2.65):
                        K.box(m,(x-.16,y-.16,z),(x+.16,y+.16,z+.25),"SY_Scrap","girder")
    return m


def gangway_lod(lod):
    m=K.Mesh()
    K.box(m,(-1.2,-12,-.24),(1.2,0,0),"SY_Scrap","walk")
    if lod == 3:
        return m
    for x in (-1.16,1.16):
        rail(m,(x,-12,0),(x,0,0),lod)
        K.chord(m,[(x,0,-.2),(x,-6,-1.2),(x,-12,-.2)],.14,"SY_Scrap","girder",lod,nodes=(0,1,2))
        for y in range(-12,0,2):
            K.member(m,(x,y,-.24),(x,y+1,-1),.09,"SY_Scrap","girder",lod)
            K.member(m,(x,y+1,-1),(x,y+2,-.24),.09,"SY_Scrap","girder",lod)
    return m


SOCKETS = {
    # (name, theta from the mouth, phi round it, inset) on the cavity wall, +Y pointing into the cavity
    "Socket_Dock_1": (1.30, math.pi + 0.25, 0.0),
    "Socket_Dock_2": (1.90, 0.15, 0.0),
    "Socket_DockL_1": (2.40, math.pi - 0.40, 0.0),
    "Socket_Deck_1": (1.60, -0.45, 0.0),
    "Socket_Deck_2": (2.05, math.pi + 0.55, 0.0),
}


def build(sc, root):
    for name, fn, cls in (("sy_rock", rock_lod, "building"), ("sy_mouth", mouth_lod, "kit"), ("sy_dock", dock_lod, "kit"), ("sy_deck", deck_lod, "kit"), ("sy_dock_l", lambda lod: dock_lod(lod,True), "kit"), ("sy_gangway",gangway_lod,"kit")):
        asset = K.new_collection(name, root)
        asset["asset_class"] = cls
        for lod in range(4):
            c = K.new_collection(f"{name}_LOD{lod}", asset)
            m = fn(lod)
            print(f"{name} LOD{lod}: {m.tris():,} tris, {len(m.mats)} materials")
            m.build(f"{name}_L{lod}", c)
        if name == "sy_rock":
            # the rock's colliders: shell sectors between the cavity and the skin, from the same radius as the mesh
            n_ = 0
            for band, (t0, t1) in enumerate(((0.55, 1.05), (1.05, 1.6), (1.6, 2.15), (2.15, 2.7), (2.7, math.pi))):
                nphi = 8 if band < 4 else 1
                for k in range(nphi):
                    p0, p1 = 2 * math.pi * k / nphi, 2 * math.pi * (k + 1) / nphi
                    tm, pm = (t0 + t1) / 2, (p0 + p1) / 2
                    d = _dir(tm, pm) if band < 4 else np.array([0.0, 1.0, 0.0])
                    ro, ri = radius(d), radius(d, True)
                    ang_t = (t1 - t0)
                    ang_p = (p1 - p0) * math.sin(tm) if band < 4 else 2 * math.pi * math.sin(2.9)
                    rm = (ro + ri) / 2
                    w, h = rm * ang_p * 1.08, rm * ang_t * 1.08
                    if band == 4:
                        w = h = rm * 0.9
                    q = Vector(d).to_track_quat("Z", "Y").to_matrix().to_4x4()
                    xf = Matrix.Translation(Vector(d * rm)) @ q
                    n_ += 1
                    K.collider(asset, f"COL_Rock_{n_:02d}", (-w / 2, -h / 2, -(ro - ri) / 2), (w / 2, h / 2, (ro - ri) / 2), xf=xf)
            # the mouth's socket: at the rim's centre, +Y out of the rock (toward -Y world)
            mid = np.mean([_dir(MOUTH * 1.1, p) * radius(_dir(MOUTH * 1.1, p)) for p in np.linspace(0, 2 * math.pi, 16)], 0)
            K.empty(asset, "Socket_Mouth", (0.0, float(mid[1]), 0.0), rot=(0, 0, math.pi), size=8.0, props={"interface": "mouth"})
            for nm, (t, p, _) in SOCKETS.items():
                if nm.startswith("Socket_Deck"):
                    continue
                d = _dir(t,p); pos = d*radius(d,True)*.97
                inward=Vector((-d[0],-d[1],0)).normalized(); q=inward.to_track_quat("Y","Z")
                props={"interface":"anchor"}
                target={"Socket_Dock_1":"Deck_1","Socket_DockL_1":"Deck_2"}.get(nm)
                if target:
                    props["gangway"]=target
                o=K.empty(asset,nm,tuple(pos),rot=tuple(q.to_euler()),size=4,props=props)
                if target:
                    r=18 if "DockL" in nm else 12.5; cy=-r-4.5
                    dock=Matrix.Translation(pos) @ q.to_matrix().to_4x4() @ Matrix.Rotation(math.pi,4,"Z")
                    deck=dock @ Matrix.Translation((r+27,cy+7,0)) @ Matrix.Rotation(math.pi,4,"Z")
                    K.empty(asset,"Socket_"+target,tuple(deck.translation),rot=tuple(deck.to_euler()),size=4,props={"interface":"anchor"})
            K.empty(asset, "BAY_Mouth", (0.0, -R0 - 40.0, 0.0), size=8.0, props={"approach": True})
            K.empty(asset, "Light_Cavity", (0.0, 0.0, 0.0), size=3.0, props={"color": "#FF8A5C", "intensity": 1.6, "distance": 110.0})
        elif name == "sy_mouth":
            for k in range(8):
                a = k * math.pi / 4 + math.pi / 8 + math.pi / 8
                xf = Matrix.Translation((math.cos(a) * 25.0, 0.0, math.sin(a) * 25.0)) @ Matrix.Rotation(-a, 4, "Y")
                K.collider(asset, f"COL_Gate_{k + 1}", (-1.3, -1.3, -10.2), (1.3, 1.3, 10.2), xf=xf)
            K.empty(asset, "Socket_GateMount", (0, 0, 0), size=6.0, props={"interface": "mouth"})
            K.empty(asset, "Light_Gate", (0.0, -3.0, 21.0), size=2.0, props={"color": "#FF6A3D", "intensity": 2.0, "distance": 60.0})
        elif name in ("sy_dock","sy_dock_l"):
            r = 18.0 if name == "sy_dock_l" else 12.5
            cy = -r-4.5
            n=16; verts=[(math.cos(a)*r,cy+math.sin(a)*r,z) for z in (-1.2,0) for a in np.linspace(0,2*math.pi,n,endpoint=False)+math.pi/n]
            faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
            K.collider_mesh(asset,"COL_Pad",verts,faces)
            K.collider(asset,"COL_Walk",(-1.2,cy+r-1.5,-.3),(1.2,-.6,0))
            K.empty(asset,"Socket_Gangway",(r,cy,0),rot=(0,0,-math.pi/2),props={"interface":"walkway"})
            K.collider(asset, "COL_Cantilever", (-6.0, -6.0, -3.0), (6.0, 0.0, 0.0))
            K.collider(asset, "COL_Anchor", (-8.0, -0.6, -14.0), (8.0, 0.0, 2.0))
            K.empty(asset, "BAY_Dock", (0.0, cy, 0.0), size=4.0, props={"radius": r, "tier": 2 if r==18 else 1})
            K.empty(asset, "Socket_DockAnchor", (0, 0, 0), size=3.0, props={"interface": "anchor"})
            K.empty(asset, "Interact_Hatch", (0.0, -1.0, 1.4), size=0.3)
        elif name == "sy_gangway":
            K.collider(asset,"COL_Walk",(-1.2,-12,-.24),(1.2,0,0))
            for x in (-1.16,1.16):
                K.collider(asset,f"COL_Rail_{'L' if x<0 else 'R'}",(x-.08,-12,0),(x+.08,0,1.1))
            K.empty(asset,"Socket_DockEnd",(0,0,0),props={"interface":"walkway"})
            K.empty(asset,"Socket_DeckEnd",(0,-12,0),rot=(0,0,math.pi),props={"interface":"walkway"})
        else:
            for k,xf in cover_layout():
                mn,mx=((-1.4,-.12,0),(1.4,.12,1.25)) if k%2 else ((-.7,-.7,0),(.7,.7,1.1))
                K.collider(asset,f"COL_Cover_{k}",mn,mx,xf=xf)
            for x in (-15,15):
                for j,(y0,y1) in enumerate(((-14,-8.3),(-5.7,0))):
                    K.collider(asset,f"COL_EndRail_{'L' if x<0 else 'R'}{j}",(x-.08,y0,0),(x+.08,y1,1.1))
            K.empty(asset,"Socket_Gangway",(-15,-7,0),rot=(0,0,math.pi/2),props={"interface":"walkway"})
            K.collider(asset, "COL_Deck", (-15.0, -14.0, -1.0), (15.0, 0.0, 0.0))
            K.collider(asset, "COL_Hold", (3.0, -6.2, 0.0), (12.0, -3.2, 2.9))
            K.collider(asset, "COL_Rail", (-15.0, -14.0, 0.0), (15.0, -13.8, 1.1))
            K.empty(asset, "Socket_DeckAnchor", (0, 0, 0), size=3.0, props={"interface": "anchor"})
            K.empty(asset, "Interact_Hold", (7.5, -6.8, 1.3), size=0.3)
            K.empty(asset, "Light_Deck", (7.5, -7.5, 2.4), size=1.0, props={"color": "#FF8A5C", "intensity": 0.8, "distance": 18.0})
