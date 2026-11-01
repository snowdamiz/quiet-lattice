"""The hangar's bay door: ten leaves on staggered tracks, each a framed panel of lapped shell shingles over three Thalune
ribs, braced behind by an Ulgani lattice, hung from rollers in a head rail and guided by rollers in a floor rail. Each
leaf slides along X by its `open_x` into the pockets in the hangar's 12 m wall mass, so the 130 m mouth clears. The
door's frame is the hangar's frame translated to Socket_BayDoor (its Socket_DoorMount faces +Y, back into the hall).

Open state: every leaf has its own COL_Door_Leaf_<side><n> carrying the same `leaf`, `open_x` and `open_seconds` as the
leaf mesh, so the station builder moves each collider with its leaf (a closed door blocks the mouth, an open one clears
it)."""
import numpy as np

import kit as K
import paint as PD

W, H = 13.4, 41.4  # the 42 m opening closes against the head rail above the leaves
LAP = 0.4
PITCH = 0.55  # track spacing: a leaf is 0.5 m deep from its rib crowns to its back lattice, so passing leaves clear
FRONT, BACK = -0.12, 0.4  # rib crowns and the back frame, from the leaf's shingle plane
ROWS = 12
X_RAIL = 80.0  # the rails run on into the pockets


def leaf(m, x0, y, lod, lead_x, number):
    """One leaf: x0..x0+W, its shingle plane at y (the side facing space is -y)."""
    x1 = x0 + W
    out = lambda c: c + np.array([0, -5.0, 0])
    hall = lambda c: c + np.array([0, 5.0, 0])
    if lod == 3:
        zb = H / ROWS
        K.patch(m, [[(x0, y, 0), (x0, y, zb)], [(x1, y, 0), (x1, y, zb)]], "WS_Shell", "accent", toward=out)
        K.patch(m, [[(x0, y, zb), (x0, y, H)], [(x1, y, zb), (x1, y, H)]], "WS_Shell", "plate", toward=out)
        K.patch(m, [[(x0, y + BACK, 0), (x0, y + BACK, H)], [(x1, y + BACK, 0), (x1, y + BACK, H)]], "WS_Metal", "machine", toward=hall)
        return
    fw = 0.45  # frame width
    ix0, ix1, iz0, iz1 = x0 + fw, x1 - fw, fw + 0.4, H - fw
    # shingles: rows lapping downward, each row's lower edge 5 cm proud, seams staggered row to row
    zs = np.linspace(iz0, iz1, ROWS + 1)
    rng = np.random.default_rng(int(abs(x0) * 10) + 3)
    lap = 0.05 if lod <= 1 else 0.0
    for i in range(ROWS):
        z0, z1 = zs[i], zs[i + 1]
        cuts = [ix0, ix1] if lod >= 2 else ([ix0, (ix0 + ix1) / 2, ix1] if i % 2 == 0 else [ix0, ix0 + (ix1 - ix0) * 0.25, ix0 + (ix1 - ix0) * 0.75, ix1])
        key = "accent" if i < 2 else ("plate_band" if i == 6 else "plate")
        for a, b in zip(cuts, cuts[1:]):
            uo = float(rng.random() * 8)
            K.patch(m, [[(a, y - lap, z0), (a, y, z1 + (0.06 if i < ROWS - 1 else 0))], [(b, y - lap, z0), (b, y, z1 + (0.06 if i < ROWS - 1 else 0))]], "WS_Shell", key, u_off=uo, toward=out)
            if lap:
                K.patch(m, [[(a, y, z0), (a, y - lap, z0)], [(b, y, z0), (b, y - lap, z0)]], "WS_Shell", "lip", u_off=uo, t_range=(0, 0.2), toward=lambda c: c + np.array([0, 0, -5.0]))
    # the frame: stiles and rails standing 8 cm proud of the shingles, as deep as the leaf
    for (a, b) in (((x0, -0.08, 0.0), (ix0, BACK, H)), ((ix1, -0.08, 0.0), (x1, BACK, H)), ((ix0, -0.08, 0.0), (ix1, BACK, iz0)), ((ix0, -0.08, iz1), (ix1, BACK, H))):
        K.box(m, (a[0], y + a[1], a[2]), (b[0], y + b[1], b[2]), "WS_Shell", "lip" if a[2] == 0.0 and b[2] == iz0 else "accent", keys={"+y": "accent"}, u_off=x0 * 0.13)
    # three Thalune ribs over the shingles, the seams follow them
    if lod <= 2:
        for f in (0.25, 0.5, 0.75):
            xr = ix0 + (ix1 - ix0) * f
            K.tube(m, [(xr, y - 0.02, iz0), (xr, y - 0.02, iz1)], 0, 0, "WS_Shell", "rib", smooth=True, up=(1, 0, 0), profile=[(-0.5, 0.0), (-0.34, -0.08), (0.0, -0.11), (0.34, -0.08), (0.5, 0.0)])
    # the leading edge: a rounded signal-orange bumper with depth, the edge that meets the next leaf
    xe = lead_x
    s = 1 if abs(xe - x1) < 1e-6 else -1
    K.tube(m, [(xe, y + 0.14, 0.0), (xe, y + 0.14, H)], 0, 0, "WS_Shell", "signal", smooth=True, up=(s, 0, 0), profile=[(-0.25, 0.0), (-0.17, 0.08 * s), (0.0, 0.12 * s), (0.17, 0.08 * s), (0.25, 0.0)])
    # the back: a thin skin and an Ulgani lattice of bowed members fused into the frame
    K.patch(m, [[(ix0, y + 0.06, iz0), (ix0, y + 0.06, iz1)], [(ix1, y + 0.06, iz0), (ix1, y + 0.06, iz1)]], "WS_Metal", "machine", toward=hall)
    if lod <= 2:
        nz = 6 if lod <= 1 else 3
        pz = np.linspace(iz0, iz1, nz + 1)
        yb = y + 0.24
        for k in range(nz):
            xa, xb = (ix0, ix1) if k % 2 == 0 else (ix1, ix0)
            K.member(m, (xa, yb, pz[k]), (xb, yb, pz[k + 1]), 0.1, "WS_Metal", "lattice", lod=lod, bow=0.03, bow_dir=(0, 0, 1), sides=4, seg=1 if lod <= 1 else 2)
            if lod <= 1 and 0 < k:
                K.box(m, (ix0, y + 0.1, pz[k] - 0.15), (ix1, y + 0.38, pz[k] + 0.15), "WS_Metal", "lattice", skip=("-y",))
    # rollers: two carriages hung in the head rail, two guide wheels in the floor rail
    if lod <= 1:
        for xr in (x0 + 2.0, x1 - 2.0):
            for z0, z1, wz in ((H, H + 0.7, H + 0.7), (0.05, 0.6, 0.14)):
                K.box(m, (xr - 0.35, y + 0.05, z0), (xr + 0.35, y + 0.4, z1), "WS_Metal", "trim")
                K.revolve(m, [(0.0, wz - 0.12), (0.22, wz - 0.12), (0.26, wz - 0.06), (0.26, wz + 0.06), (0.22, wz + 0.12), (0.0, wz + 0.12)], 12 if lod == 0 else 8, "WS_Metal", "trim", center=(xr, y + 0.2, 0.0), axis="z", away=(xr, y + 0.2, wz))
    # walking-height chevrons on the leading edge, the leaf's number stencilled at 6 m, grime splashed up the foot
    if lod <= 1:
        zc = 2.4
        K.decal(m, (xe - s * 1.6, y - 0.07, zc), (0, -1, 0), (-1, 0, 0), 2.4, 2.4, PD.DECAL_CELLS["chevron"], lift=0.0, flip=s > 0)
        for k, ch in enumerate(f"{number:02d}"):
            K.decal(m, (x0 + 1.9 + (k - 0.5) * 0.96, y - 0.07, 6.5), (0, -1, 0), (1, 0, 0), 0.9, 1.8, PD.DECAL_CELLS["digit" + ch], lift=0.0)
        K.decal(m, ((x0 + x1) / 2, y - 0.075, 1.8), (0, -1, 0), (-1, 0, 0), W - 0.6, 3.0, PD.DECAL_CELLS["grime_runs"], lift=0.0, flip=bool(number % 2))
        K.decal(m, ((x0 + x1) / 2, y - 0.075, H - 2.2), (0, -1, 0), (1, 0, 0), W - 1.0, 3.6, PD.DECAL_CELLS["grime_runs"], lift=0.0, flip=bool(number % 3))


def rails(m, lod):
    """The head rail across the top of the mouth (five channels, one per track) and a guide rail per track in the floor."""
    y0, y1 = 0.05, 0.3 + 4 * PITCH + BACK + 0.1
    if lod == 3:
        K.box(m, (-X_RAIL, y0, H), (X_RAIL, y1, H + 1.2), "WS_Metal", "machine")
        return
    K.box(m, (-X_RAIL, y0 - 0.2, H + 0.75), (X_RAIL, y1 + 0.2, H + 1.4), "WS_Shell", "lip", keys={"-y": "signal"})
    for k in range(6):
        yy = 0.3 - 0.15 + k * PITCH - 0.02
        K.box(m, (-X_RAIL, yy, H + 0.05), (X_RAIL, yy + 0.08, H + 0.75), "WS_Metal", "trim", skip=("-z",))
    for k in range(5):
        yy = 0.3 + k * PITCH + 0.2
        K.box(m, (-X_RAIL, yy - 0.11, -0.02), (X_RAIL, yy - 0.07, 0.06), "WS_Metal", "trim", skip=("-z",))
        K.box(m, (-X_RAIL, yy + 0.07, -0.02), (X_RAIL, yy + 0.11, 0.06), "WS_Metal", "trim", skip=("-z",))


def leaves():
    """(side, index, x0, y, open_x, leading edge x, number) for the ten leaves."""
    out = []
    for side in ("L", "R"):
        for k in range(5):
            # leaves overlap like shingles: each inner leaf sits one track further toward space
            y = 0.3 + (4 - k) * PITCH
            if side == "L":
                x0 = -65.0 + k * (W - LAP)
                open_x = -(x0 + 65.0) - W + 0.2 - (4 - k) * 0.3
                lead = x0 + W
            else:
                x0 = 65.0 - W - k * (W - LAP)
                open_x = (65.0 - (x0 + W)) + W - 0.2 + (4 - k) * 0.3
                lead = x0
            out.append((side, k, x0, y, open_x, lead, (k + 1) if side == "L" else (10 - k)))
    return out


def build(sc, root):
    asset = K.new_collection("ws_baydoor", root)
    asset["asset_class"] = "building"
    for lod in range(4):
        c = K.new_collection(f"ws_baydoor_LOD{lod}", asset)
        tot = 0
        for side, k, x0, y, open_x, lead, number in leaves():
            m = K.Mesh()
            leaf(m, x0, y, lod, lead, number)
            tot += m.tris()
            o = m.build(f"Door_Leaf_{side}{k + 1}_L{lod}", c)
            o["leaf"] = f"{side}{k + 1}"
            o["open_x"] = round(open_x, 3)
            o["open_seconds"] = 6.0
        m = K.Mesh()
        rails(m, lod)
        tot += m.tris()
        m.build(f"ws_baydoor_rails_L{lod}", c)
        print(f"ws_baydoor LOD{lod}: {tot:,} tris")
    for side, k, x0, y, open_x, lead, number in leaves():
        o = K.collider(asset, f"COL_Door_Leaf_{side}{k + 1}", (x0, y + FRONT, 0.0), (x0 + W, y + BACK, H))
        o["leaf"] = f"{side}{k + 1}"
        o["open_x"] = round(open_x, 3)
        o["open_seconds"] = 6.0
    K.collider(asset, "COL_HeadRail", (-X_RAIL, -0.15, H + 0.05), (X_RAIL, 0.3 + 4 * PITCH + BACK + 0.3, H + 1.4))
    K.empty(asset, "Socket_DoorMount", (0, 0, 0), size=6.0, props={"interface": "baydoor"})
    return asset
