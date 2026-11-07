"""Head designs: each people's face (shared by its six heads, so blendshapes and the dialogue bar behave the same) and
six variants of skull, crest, frills, crystals or fronds.  Coordinates are metres relative to the head joint
(x left, y back, z up) at canonical scale; the builder scales them by the people and mirrors pairs."""
import copy
import math

import bmesh
import bpy
import numpy as np

from . import membrane
from .sdf import nrm

def _rotx(deg):
    a = math.radians(deg)
    return np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])


def _roty(deg):
    a = math.radians(deg)
    return np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])


def _rotz(deg):
    a = math.radians(deg)
    return np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])


# ---------------------------------------------------------------------------------------------- Thalune
TH_BASE = dict(
    rings=[-0.08, -0.045, -0.02, 0.0, 0.012, 0.024, 0.034, 0.044, 0.058, 0.071, 0.085, 0.099, 0.113, 0.131, 0.15,
           0.168, 0.186, 0.2],
    forms=[
        ('ell', (0, 0.014, 0.098), (0.09, 0.098, 0.077), 0.05),         # wide low dome
        ('ell', (0, 0.046, 0.07), (0.07, 0.056, 0.066), 0.045),         # occiput
        ('ell', (0, -0.046, 0.054), (0.077, 0.06, 0.055), 0.05),        # broad face
        ('ell', (0, -0.028, 0.013), (0.074, 0.066, 0.036), 0.05),       # wide flat jaw
        ('ell', (0, -0.016, -0.022), (0.056, 0.05, 0.034), 0.045),      # throat
        ('ell', (0, -0.084, 0.044), (0.04, 0.024, 0.026), 0.035),       # rounded snout
        ('ell2', (0.043, -0.091, 0.112), (0.032, 0.019, 0.013), 0.02, _roty(-18)),    # brow ridges overhanging the sockets
        ('ell2', (0.054, -0.07, 0.06), (0.025, 0.022, 0.015), 0.026),   # cheeks under the eyes, ahead of the eyeball
        ('ell', (0, -0.1, 0.034), (0.036, 0.012, 0.007), 0.012),        # upper lip rim along the wide mouth
        ('ell', (0, -0.094, 0.021), (0.03, 0.012, 0.007), 0.012),       # lower lip
        ('sub', (0.011, -0.108, 0.055), (0.0028, 0.008, 0.0032), 0.0035, _rotz(-25)),  # nostril slits on the snout
    ] + [f for y, z in ((-0.034, -0.004), (-0.023, -0.017), (-0.012, -0.03), (-0.001, -0.043)) for f in (
        ('ell2', (0.059, y, z), (0.0055, 0.0045, 0.016), 0.005, _rotx(-30)),                  # a gill slit's raised lip
        ('sub', (0.063, y + 0.003, z), (0.0042, 0.0016, 0.0145), 0.0018, _rotx(-30)))],       # and the slit behind it
    eyes=[dict(bone='eye_L', r=0.0205, yaw=34, pitch=8, open=(52, 30, 30), almond=2.0, tilt=6, depth=0.0165,
               rows=(8, 11), cols=(1, 6), lid=0.0027, mound_k=0.009, lid_h=(1.25, 0.7),
               loops=[(None, None, 1.0), (1.45, 1.0, 1.0), (1.26, 0.85, 0.0), (1.0, 0.42, 0.0)])],
    mouth=dict(z=0.028, w=0.042, rows=(4, 6), cols=(-4, 4), smile=0.0, gap=0.0007, lip_in=0.003, border_x=0.006,
               lip_up=0.0062, lip_lo=0.0058, lip_out=0.0022, arc=0.32),
)


def _fan(root, out, length, rays, **kw):
    kw.setdefault('thick', 0.0036)
    return dict(kind='membrane', root=root, out=out, length=length, rays=rays, **kw)


TH_VARIANTS = {
    # 1 tidal: a swept-back occipital lobe, three layered frill fans, the classic Thalune silhouette
    1: dict(name='tidal', forms=[('ell', (0, 0.07, 0.112), (0.062, 0.064, 0.05), 0.035, _rotx(-25)),
                                 ('ell', (0, 0.105, 0.098), (0.04, 0.035, 0.03), 0.03)], acc=[
        _fan([(0.055, 0.008, 0.056), (0.059, 0.026, 0.026)], (0.45, 0.85, 0.3), 0.11, 5, droop=0.1, fan=0.7, scallop=0.22),
        _fan([(0.059, 0.026, 0.026), (0.061, 0.034, -0.012)], (0.62, 0.78, -0.02), 0.13, 5, droop=0.14, fan=0.8, scallop=0.22),
        _fan([(0.061, 0.034, -0.012), (0.058, 0.026, -0.05)], (0.66, 0.58, -0.45), 0.085, 4, droop=0.1, fan=0.6, scallop=0.22),
    ]),
    # 2 crested: a tall median crest fin from brow to nape, small frills
    2: dict(name='crested', forms=[('ell', (0, 0.02, 0.112), (0.078, 0.095, 0.08), 0.05)], acc=[
        _fan([(0.0, -0.055, 0.155), (0.0, 0.01, 0.182), (0.0, 0.075, 0.15), (0.0, 0.1, 0.08)], (0, 0.35, 1.0), 0.06, 7,
             mirror=False, normal=(1, 0, 0), droop=0.0, scallop=0.25, profile='crest', thick=0.0022, rib_h=0.0022),
        _fan([(0.057, 0.016, 0.042), (0.061, 0.03, -0.008)], (0.5, 0.85, 0.05), 0.05, 3, droop=0.1, fan=0.5),
    ]),
    # 3 hooded: a broad flat skull under a hood of skin arching from temple to temple behind it, one wide fan per side
    3: dict(name='shelf', forms=[
        ('ell', (0, 0.025, 0.1), (0.102, 0.092, 0.066), 0.05),
        ('ell', (0, 0.102, 0.08), (0.094, 0.062, 0.036), 0.04),
        ('ell', (0, 0.09, 0.118), (0.118, 0.064, 0.054), 0.03, _rotx(-18)),
        ('cone', (0.078, 0.0, 0.12), (0.0, 0.112, 0.16), 0.013, 0.017, 0.02, True),
    ], acc=[
        _fan([(0.066, 0.02, 0.064), (0.068, 0.04, 0.005), (0.062, 0.03, -0.045)], (0.85, 0.5, 0.0), 0.11, 6, droop=0.15,
             fan=1.0, scallop=0.26),
    ]),
    # 4 lobed: lateral skull lobes and three slender fringed gill stalks per side
    4: dict(name='lobed', forms=[
        ('ell2', (0.058, 0.026, 0.112), (0.042, 0.052, 0.046), 0.03),
    ], acc=[
        _fan([(0.057, 0.014, 0.05), (0.059, 0.02, 0.036)], (0.35, 0.8, 0.5), 0.085, 6, droop=0.05, fan=0.35, scallop=0.4, rib_w=0.18,
             rib_h=0.0042, thick=0.0034, twist=0.5),
        _fan([(0.060, 0.026, 0.012), (0.061, 0.03, -0.002)], (0.55, 0.85, 0.05), 0.095, 6, droop=0.08, fan=0.35, scallop=0.4, rib_w=0.18,
             rib_h=0.0042, thick=0.0034, twist=0.5),
        _fan([(0.060, 0.03, -0.026), (0.059, 0.03, -0.04)], (0.6, 0.7, -0.35), 0.08, 6, droop=0.08, fan=0.35, scallop=0.4, rib_w=0.18,
             rib_h=0.0042, thick=0.0034, twist=0.5),
    ]),
    # 5 veil: a twin crest of parietal ridges, long frills that drape over the shoulders
    5: dict(name='veil', forms=[('ell', (0, 0.0, 0.092), (0.088, 0.1, 0.072), 0.05),
                                ('cone', (0.03, -0.045, 0.158), (0.036, 0.075, 0.142), 0.019, 0.011, 0.014, True),
                                ('ell2', (0.032, -0.052, 0.168), (0.02, 0.022, 0.017), 0.016),
                                ('cone', (0.036, 0.075, 0.142), (0.03, 0.11, 0.1), 0.01, 0.007, 0.012, True)], acc=[
        _fan([(0.055, 0.008, 0.056), (0.06, 0.03, 0.0), (0.058, 0.026, -0.05)], (0.42, 0.62, -0.66), 0.15, 6, droop=0.3,
             fan=0.6, scallop=0.15, curl=0.5),
    ]),
    # 6 crown: a ribbed scallop-shell crest rising from the nape (the people's shell form), short frills
    6: dict(name='crown', forms=[('ell', (0, 0.05, 0.11), (0.074, 0.06, 0.07), 0.045)], acc=[
        _fan([(-0.05, 0.066, 0.095), (-0.026, 0.084, 0.115), (0.0, 0.09, 0.122), (0.026, 0.084, 0.115), (0.05, 0.066, 0.095)],
             (0, 0.55, 0.85), 0.085, 9, mirror=False, normal=(0, -0.85, 0.55), scallop=0.12, droop=-0.08, fan=1.3, thick=0.003,
             rib_h=0.005, rib_w=0.3, sink=0.009),
        _fan([(0.058, 0.02, 0.03), (0.061, 0.03, -0.02)], (0.55, 0.8, -0.1), 0.045, 3, droop=0.08, fan=0.4),
    ]),
}


RINGS_TALL = [-0.08, -0.045, -0.02, 0.0, 0.012, 0.024, 0.034, 0.044, 0.058, 0.071, 0.085, 0.099, 0.113, 0.131, 0.15,
              0.168, 0.186, 0.204, 0.222]

# ---------------------------------------------------------------------------------------------- Ixari
IX_BASE = dict(
    rings=RINGS_TALL,
    forms=[
        ('ell', (0, 0.04, 0.128), (0.064, 0.118, 0.086), 0.05, _rotx(-20)),   # long skull sweeping back
        ('ell', (0, -0.028, 0.062), (0.055, 0.054, 0.066), 0.045),           # narrow face
        ('ell2', (0.044, -0.046, 0.074), (0.021, 0.026, 0.015), 0.02),       # high cheekbones
        ('ell', (0, -0.034, 0.016), (0.045, 0.05, 0.03), 0.04),              # narrow jaw
        ('ell', (0, -0.053, 0.012), (0.017, 0.016, 0.018), 0.025),           # pointed chin, under the face (it stays level)
        ('ell', (0, -0.07, 0.06), (0.0105, 0.013, 0.03), 0.016),             # a long, angular nasal ridge
        ('ell', (0, -0.078, 0.042), (0.012, 0.01, 0.009), 0.012),            # its tip
        ('sub', (0.0068, -0.083, 0.038), (0.0026, 0.008, 0.0052), 0.0018, _rotz(-30)),   # slit nostrils
        ('ell2', (0.03, -0.064, 0.105), (0.028, 0.014, 0.011), 0.011, _roty(-20)),       # brow plates over the main eyes
        ('ell2', (0.043, -0.052, 0.143), (0.019, 0.011, 0.0085), 0.01, _roty(-30)),       # small brows over the upper eyes
        ('ell2', (0.036, -0.06, 0.07), (0.022, 0.009, 0.007), 0.01, _roty(15)),           # orbital rims under the main eyes
        ('ell', (0, -0.076, 0.026), (0.023, 0.011, 0.0075), 0.006),          # upper lip, a defined edge
        ('ell', (0, -0.071, 0.016), (0.019, 0.01, 0.007), 0.006),            # lower lip
        ('ell', (0, -0.02, -0.025), (0.042, 0.042, 0.04), 0.04),             # slim throat
        ('ell', (0, -0.06, 0.15), (0.026, 0.018, 0.032), 0.03),              # the forehead carried forward between the
                                                                              # upper eyes, so the face stands level
    ],
    eyes=[dict(bone='eye_L', r=0.0165, yaw=24, pitch=-3, open=(44, 22, 21), almond=1.7, tilt=14, depth=0.002,
               rows=(8, 11), cols=(1, 4), lid=0.0024, mound_k=0.01, lid_h=(1.3, 0.6),
               loops=[(None, None, 1.0), (1.45, 1.0, 1.0), (1.26, 0.85, 0.0), (1.0, 0.42, 0.0)]),
          dict(bone='eye_upper_L', r=0.0088, yaw=42, pitch=9, open=(40, 26, 24), almond=1.8, tilt=10, depth=0.0022,
               rows=(12, 14), cols=(2, 5), lid=0.0016, mound_k=0.013, upper=True, lid_h=(1.2, 0.7),
               loops=[(None, None, 1.0), (1.45, 1.0, 1.0), (1.26, 0.85, 0.0), (1.0, 0.42, 0.0)])],
    mouth=dict(z=0.021, w=0.024, rows=(4, 6), cols=(-2, 2), smile=0.0, gap=0.0005, lip_in=0.0025, border_x=0.005,
               lip_up=0.0042, lip_lo=0.0046, lip_out=0.0016, arc=0.5),
)


def _cr(base, d, length, r, **kw):
    return dict(base=base, dir=d, length=length * 2.15, radius=r * 1.45, **kw)


IX_VARIANTS = {
    # each head its own cranium: 1 a keeled ridge, 2 a forward-swept crown, 3 a broad flattened skull, 4 a twin-lobed
    # back skull, 5 a tall narrow skull, 6 a terraced crown
    1: dict(name='shard', base_edit={0: ('ell', (0, 0.04, 0.13), (0.058, 0.116, 0.09), 0.05, _rotx(-20))}, forms=[
        ('cone', (0, -0.035, 0.196), (0, 0.13, 0.166), 0.016, 0.011, 0.012),('ell', (0, 0.085, 0.16), (0.036, 0.06, 0.045), 0.035, _rotx(-35))], acc=[dict(kind='crystals', mirror=False, items=[
        _cr((0, 0.05, 0.2), (0, 0.85, 1), 0.06, 0.012), _cr((0.022, 0.07, 0.185), (0.3, 0.8, 1), 0.035, 0.0075),
        _cr((-0.022, 0.07, 0.185), (-0.3, 0.8, 1), 0.035, 0.0075)])]),
    2: dict(name='fan', base_edit={0: ('ell', (0, 0.012, 0.14), (0.062, 0.1, 0.09), 0.05, _rotx(6))}, forms=[
        ('ell', (0, -0.025, 0.188), (0.044, 0.05, 0.034), 0.03, _rotx(28)),('cone', (0, -0.03, 0.188), (0, 0.11, 0.152), 0.012, 0.009, 0.02)], acc=[dict(kind='crystals', mirror=False, items=[
        _cr((0, -0.01, 0.205), (0, -0.2, 1), 0.035, 0.007), _cr((0, 0.025, 0.212), (0, 0.15, 1), 0.05, 0.0085),
        _cr((0, 0.06, 0.205), (0, 0.5, 1), 0.06, 0.0095), _cr((0, 0.095, 0.185), (0, 0.85, 0.8), 0.055, 0.009),
        _cr((0, 0.12, 0.155), (0, 1, 0.45), 0.04, 0.0075)])]),
    3: dict(name='circlet', base_edit={0: ('ell', (0, 0.036, 0.122), (0.08, 0.112, 0.07), 0.05, _rotx(-14))}, forms=[('ell', (0, 0.03, 0.14), (0.068, 0.1, 0.08), 0.04),
        ('box', (0, 0.034, 0.19), (0.066, 0.088, 0.01), 0.006, 0.014)], acc=[dict(kind='crystals', mirror=False, items=[
        _cr((0.06 * math.sin(a), 0.035 - 0.08 * math.cos(a), 0.185), (math.sin(a) * 0.45, -math.cos(a) * 0.45 + 0.25, 1),
            0.026 + 0.008 * (k % 2), 0.0055) for k, a in enumerate(np.linspace(-2.4, 2.4, 9))])]),
    4: dict(name='horns', forms=[('ell2', (0.04, 0.11, 0.152), (0.042, 0.054, 0.047), 0.03),('ell2', (0.045, 0.012, 0.158), (0.024, 0.034, 0.028), 0.024)], acc=[dict(kind='crystals', mirror=True, items=[
        _cr((0.045, 0.0, 0.17), (0.35, 0.75, 0.6), 0.075, 0.01), _cr((0.05, 0.03, 0.155), (0.5, 0.85, 0.3), 0.035, 0.0065)])]),
    5: dict(name='ridge', base_edit={0: ('ell', (0, 0.034, 0.14), (0.054, 0.104, 0.1), 0.05, _rotx(-20))}, forms=[('cone', (0, -0.04, 0.196), (0, 0.13, 0.165), 0.015, 0.011, 0.02)], acc=[dict(kind='crystals', mirror=False, items=[
        _cr((0, -0.03 + 0.022 * k, 0.2 + 0.006 * k - 0.0035 * k * k), (0, 0.25 + 0.12 * k, 1), 0.018 + 0.007 * k, 0.005 + 0.0007 * k)
        for k in range(8)])]),
    6: dict(name='cluster', forms=[('box', (0, 0.045, 0.176), (0.054, 0.076, 0.014), 0.008, 0.008),
                                   ('box', (0, 0.055, 0.199), (0.038, 0.054, 0.012), 0.006, 0.006),
                                   ('box', (0, 0.064, 0.218), (0.023, 0.034, 0.01), 0.005, 0.005),('ell', (0.032, 0.04, 0.168), (0.038, 0.05, 0.036), 0.03)], acc=[dict(kind='crystals', mirror=False, items=[
        _cr((0.03, 0.04, 0.195), (0.45, 0.4, 1), 0.07, 0.011), _cr((0.045, 0.02, 0.18), (0.7, 0.1, 0.8), 0.045, 0.008),
        _cr((0.04, 0.07, 0.175), (0.55, 0.8, 0.6), 0.05, 0.008), _cr((0.015, 0.06, 0.205), (0.15, 0.5, 1), 0.035, 0.006),
        _cr((0.055, 0.05, 0.16), (0.9, 0.5, 0.3), 0.03, 0.006)])]),
}

# ---------------------------------------------------------------------------------------------- Ulgani
def _gills(x, ys, zs, length=0.022, tilt=-25):
    """Flared breathing openings: a raised lip (operculum) over a deep slit, one per (y, z), on the side of the neck."""
    out = []
    for y, z in zip(ys, zs):
        R = _rotx(tilt)
        out.append(('ell2', (x, y, z), (0.006, length, 0.005), 0.005, R))             # the raised, flared lip
        out.append(('sub', (x + 0.004, y + 0.002, z - 0.0042), (0.0068, length * 0.9, 0.0021), 0.002, R))  # the slit under it
    return out


UL_BASE = dict(
    rings=[-0.08, -0.045, -0.02, 0.0, 0.012, 0.024, 0.034, 0.044, 0.058, 0.071, 0.085, 0.099, 0.113, 0.131, 0.15,
           0.168, 0.186, 0.2],
    forms=[
        ('ell', (0, 0.016, 0.096), (0.085, 0.091, 0.08), 0.05),          # broad rounded cranium
        ('ell', (0, -0.036, 0.064), (0.068, 0.058, 0.05), 0.05),         # face mass
        ('ell', (0, -0.03, 0.02), (0.068, 0.062, 0.034), 0.05),          # broad jaw
        ('ell', (0, -0.012, -0.022), (0.066, 0.06, 0.042), 0.05),        # thick throat
        ('ell2', (0.033, -0.08, 0.106), (0.026, 0.013, 0.0095), 0.03, _roty(-14)),  # brow masses over the sockets
        ('ell', (0, -0.088, 0.096), (0.012, 0.01, 0.014), 0.018),        # glabella between the brows
        ('ell2', (0.047, -0.072, 0.067), (0.02, 0.018, 0.012), 0.026),   # cheekbones under the sockets
        ('ell', (0, -0.096, 0.06), (0.016, 0.015, 0.022), 0.02),         # flat nasal plate
        ('ell', (0, -0.09, 0.038), (0.029, 0.017, 0.011), 0.014),        # upper lip / muzzle
        ('ell', (0, -0.087, 0.022), (0.025, 0.016, 0.0095), 0.012),      # lower lip
        ('ell', (0, -0.079, 0.003), (0.022, 0.016, 0.015), 0.02),        # chin
        ('sub', (0.077, -0.03, 0.092), (0.012, 0.02, 0.016), 0.02),      # temple hollows
        ('sub', (0.0095, -0.107, 0.051), (0.003, 0.009, 0.0085), 0.0045, _roty(-16)),   # nostril slits
    ] + _gills(0.066, (-0.012, 0.0, 0.012, 0.022), (0.008, -0.008, -0.024, -0.04), length=0.026),
    eyes=[dict(bone='eye_L', r=0.0185, yaw=20, pitch=-3, open=(46, 20, 26), almond=2.0, tilt=-4, depth=0.002,
               rows=(8, 11), cols=(1, 4), lid=0.003, mound_k=0.008, lid_h=(1.4, 0.55), crease=0.0,
               loops=[(None, None, 1.0), (1.5, 1.05, 1.0), (1.3, 0.9, 0.0), (1.0, 0.42, 0.0)])],
    mouth=dict(z=0.03, w=0.03, rows=(4, 6), cols=(-3, 3), smile=0.0, gap=0.0007, lip_in=0.003, border_x=0.006,
               lip_up=0.007, lip_lo=0.0078, lip_out=0.0028, arc=0.45),
)


def _fr(base, d, side, length, **kw):
    """A spore-frond item: base and direction in head space, length in metres (canonical)."""
    kw.setdefault('r', 0.0058)
    kw.setdefault('leaflets', 8)
    kw.setdefault('leaf', 0.3)
    kw.setdefault('leaf_w', 0.36)
    return dict(base=base, dir=d, side=side, length=length, **kw)


def _rim(items, mirror=False, size=(0.0155, 0.0155, 0.0115), k=0.016, drop=0.004):
    """A grown cap-rim under a row of fronds: a swollen collar at every frond root, smooth-blended into its
    neighbours and the scalp (the fillet the fronds grow out of)."""
    out = []
    for it in items:
        x, y, z = it['base']
        out.append(('ell2' if mirror else 'ell', (x, y, z - drop), size, k))
    return out


def _canopy(items, **kw):
    """The frond items given a dense, pale canopy: leaflets crowded toward the tip and larger, so the crest reads
    as one light tuft at range."""
    for it in items:
        it.update(kw)
    return items


def _ring(cx, cy, cz, rx, ry, n, size, k=0.012, phase=0.0):
    """Bumps round a ring (a cap rim)."""
    return [('ell', (cx + rx * math.sin(phase + 2 * math.pi * i / n), cy - ry * math.cos(phase + 2 * math.pi * i / n), cz), size, k)
            for i in range(n)]


def _fan(n, y0, y1, z0, lmax, lmin, lean=0.55, tips=('pods', 'cap'), **kw):
    out = []
    for k in range(n):
        f = k / (n - 1)
        mid = 1 - abs(2 * f - 1)
        y = y0 + (y1 - y0) * f
        z = z0 + 0.012 * mid
        L = lmin + (lmax - lmin) * mid ** 0.7
        sx = 0.22 * (1 if k % 2 else -1) * (0.4 + 0.6 * mid)
        out.append(_fr((0.004 * (1 if k % 2 else -1), y, z), (sx, -lean + 2 * lean * f, 1), (0, 1, 0), L, curl=0.55 - 1.1 * f,
                       tip=tips[1] if mid > 0.6 else tips[0], fork=1 if 0.25 < mid < 0.9 else 0, **kw))
    return out


def _ul_fan():
    return _canopy(_fan(11, -0.055, 0.072, 0.172, 0.38, 0.2), leaflets=12, leaf=0.42, leaf_w=0.5, shape='willow', crowd=1.6, nod_p=0.5)


def _ul_swept():
    return _canopy([_fr((0.012 + 0.009 * k, 0.07 + 0.012 * k, 0.15 - 0.006 * k), (0.16 + 0.05 * k, 1, 0.55 - 0.06 * k), (0, 0, 1),
                        0.36 - 0.035 * k, curl=0.4, tip='pods' if k % 2 else 'cap', fork=1 if k < 4 else 0) for k in range(5)],
                   leaflets=13, leaf=0.4, leaf_w=0.62, shape='strap', crowd=1.3, nod_p=0.2, form='filament')


def _ul_ridge():
    return _canopy([_fr((0.032, -0.035 + 0.018 * k, 0.168 - 0.002 * k), (0.42, 0.1 * k - 0.15, 1), (1, 0, 0), 0.24 + 0.025 * min(k, 5 - k),
                        curl=0.6, tip='cap' if k in (2, 3) else 'pods', fork=k % 2) for k in range(6)],
                   leaflets=11, leaf=0.44, leaf_w=0.7, shape='lobed', crowd=1.4, nod_p=0.65, form='gillfan')


def _ul_crown():
    return _canopy([_fr((0.066 * math.sin(a), 0.015 - 0.072 * math.cos(a), 0.165), (math.sin(a) * 0.45, -math.cos(a) * 0.45, 1),
                        (math.sin(a), -math.cos(a), 0), 0.27 + 0.03 * math.cos(a), curl=0.7, tip='cap' if k % 2 else 'pods',
                        fork=k % 2) for k, a in enumerate(np.linspace(0, 2 * math.pi, 11, endpoint=False))],
                   leaflets=10, leaf=0.46, leaf_w=0.75, shape='fan', crowd=1.8, nod_p=0.3, form='cup')


def _ul_side():
    return _canopy([_fr((0.03 + 0.007 * k, -0.03 + 0.02 * k, 0.178 - 0.004 * k), (0.7, 0.15 + 0.1 * k, 1), (1, 0.2, -0.35),
                        0.34 - 0.02 * k, curl=0.8, tip='cap' if k == 1 else 'pods', fork=1 if k < 5 else 0) for k in range(7)],
                   leaflets=12, leaf=0.42, leaf_w=0.55, shape='obovate', crowd=1.5, nod_p=0.45, form='lamella')


def _ul_cap():
    rim = [_fr((0.08 * math.sin(a), 0.02 - 0.084 * math.cos(a), 0.13), (math.sin(a) * 0.9, -math.cos(a) * 0.9 + 0.1, 0.1),
               (0, 0, -1), 0.16, curl=1.0, leaflets=6, leaf=0.36, r=0.0045, shape='fan', leaf_w=0.7)
           for a in np.linspace(math.radians(60), math.radians(300), 10)]
    tuft = _canopy([_fr((0.014 * math.sin(a), 0.02 - 0.014 * math.cos(a), 0.19), (math.sin(a) * 0.3, -math.cos(a) * 0.3 + 0.1, 1),
                        (math.sin(a), -math.cos(a), 0), 0.3, curl=0.45, tip='cap', fork=1) for a in (0.0, 1.26, 2.5, 3.8, 5.0)],
                   leaflets=12, leaf=0.44, leaf_w=0.66, shape='fan', crowd=1.7, nod_p=0.35, form='cup')
    return rim + tuft


UL_VARIANTS = {
    # 1 fan: a tall keeled skull, a fleshy sagittal ridge from brow to nape grown up into a rim, and a tall fan of fronds
    1: dict(name='fan',
            base_edit={0: ('ell', (0, 0.012, 0.104), (0.077, 0.088, 0.088), 0.05),
                       2: ('ell', (0, -0.03, 0.022), (0.062, 0.058, 0.032), 0.05),
                       4: ('ell2', (0.032, -0.08, 0.108), (0.029, 0.016, 0.012), 0.026, _roty(-16))},
            forms=[('cone', (0, -0.055, 0.162), (0, 0.075, 0.156), 0.015, 0.013, 0.016),
                   ('ell', (0, 0.01, 0.17), (0.03, 0.062, 0.022), 0.02)] + _rim(_ul_fan()),
            acc=[dict(kind='fronds', mirror=False, items=_ul_fan())]),
    # 2 swept: a long skull swept back into a heavy occipital shelf, a low brow and a long chin; the fronds stream back
    2: dict(name='swept',
            base_edit={0: ('ell', (0, 0.034, 0.094), (0.079, 0.106, 0.072), 0.05),
                       4: ('ell2', (0.034, -0.08, 0.102), (0.025, 0.011, 0.008), 0.03, _roty(-10)),
                       10: ('ell', (0, -0.08, -0.002), (0.021, 0.018, 0.019), 0.02)},
            forms=[('ell', (0, 0.08, 0.122), (0.06, 0.06, 0.034), 0.03, _rotx(-22)),
                   ('ell', (0, 0.11, 0.108), (0.042, 0.032, 0.024), 0.025)] + _rim(_ul_swept(), mirror=True, size=(0.017, 0.016, 0.012)),
            acc=[dict(kind='fronds', mirror=True, items=_ul_swept())]),
    # 3 ridge: a broad, flat skull with twin parietal ridges, wide cheekbones and jaw; a row of fronds on each ridge
    3: dict(name='ridge',
            base_edit={0: ('ell', (0, 0.016, 0.09), (0.095, 0.088, 0.07), 0.05),
                       2: ('ell', (0, -0.03, 0.02), (0.075, 0.064, 0.036), 0.05),
                       6: ('ell2', (0.053, -0.07, 0.066), (0.025, 0.02, 0.014), 0.022)},
            forms=[('cone', (0.032, -0.045, 0.152), (0.038, 0.065, 0.146), 0.013, 0.011, 0.014, True)] + _rim(_ul_ridge(), mirror=True),
            acc=[dict(kind='fronds', mirror=True, items=_ul_ridge())]),
    # 4 crown: a round, high skull, a small chin and fine cheekbones under a mushroom cap with a swollen rim
    4: dict(name='crown',
            base_edit={0: ('ell', (0, 0.012, 0.1), (0.087, 0.087, 0.086), 0.05),
                       6: ('ell2', (0.044, -0.073, 0.068), (0.017, 0.016, 0.01), 0.026),
                       10: ('ell', (0, -0.078, 0.006), (0.018, 0.014, 0.012), 0.02)},
            forms=[('ell', (0, 0.015, 0.148), (0.078, 0.084, 0.042), 0.03)] +
                  _ring(0, 0.015, 0.152, 0.07, 0.076, 12, (0.012, 0.012, 0.01)),
            acc=[dict(kind='fronds', mirror=False, items=_ul_crown())]),
    # 5 side: a skull swollen into one parietal lobe, a long face and a heavy chin; the fronds sweep off the lobe's rim
    5: dict(name='side',
            base_edit={2: ('ell', (0, -0.032, 0.012), (0.064, 0.062, 0.04), 0.05),
                       10: ('ell', (0, -0.08, -0.004), (0.024, 0.018, 0.017), 0.02)},
            forms=[('ell', (0.042, 0.01, 0.15), (0.044, 0.066, 0.044), 0.03),
                   ('ell', (0.062, 0.03, 0.125), (0.026, 0.042, 0.026), 0.025)] + _rim(_ul_side()),
            acc=[dict(kind='fronds', mirror=False, items=_ul_side())]),
    # 6 cap: a broad domed skull with a heavy jaw, heavy brow and cheekbones; the cap's rim droops short fronds all
    # round, a dense tuft at the crown
    6: dict(name='cap',
            base_edit={0: ('ell', (0, 0.02, 0.094), (0.091, 0.093, 0.078), 0.05),
                       2: ('ell', (0, -0.028, 0.018), (0.075, 0.066, 0.04), 0.05),
                       4: ('ell2', (0.034, -0.079, 0.106), (0.029, 0.016, 0.012), 0.026, _roty(-12)),
                       6: ('ell2', (0.05, -0.07, 0.066), (0.024, 0.021, 0.014), 0.024)},
            forms=[('ell', (0, 0.02, 0.138), (0.09, 0.094, 0.058), 0.03)] +
                  _ring(0, 0.02, 0.122, 0.085, 0.089, 14, (0.011, 0.011, 0.009), phase=0.2),
            acc=[dict(kind='fronds', mirror=False, items=_ul_cap())]),
}


# Thalune faces: each head its own brow ridge, cheeks, jaw and snout (offsets in metres and scales of the base forms:
# 3 jaw, 5 snout, 6 brow ridges, 7 cheeks; the lips and nostrils travel with the snout)
TH_FACES = {
    1: dict(brow=((0, -0.003, 0), (1.05, 1.1, 1.1))),
    2: dict(snout=0.006, snout_s=(0.9, 0.85, 0.95), brow=((-0.004, -0.004, 0.006), (0.95, 1.25, 1.3)),
            cheek=((-0.006, 0.0, 0.004), (0.8, 0.9, 0.9)), jaw=((0, 0.004, 0.004), (0.86, 0.95, 0.9))),
    3: dict(snout=0.004, snout_s=(1.18, 0.9, 0.85), brow=((0.006, 0.0, 0.0), (1.15, 1.0, 1.0)),
            cheek=((0.01, 0.002, 0.0), (1.3, 1.1, 1.15)), jaw=((0, 0.0, -0.004), (1.12, 1.0, 1.15))),
    4: dict(snout=-0.01, snout_s=(0.88, 1.3, 0.9), brow=((0, -0.002, 0.002), (0.95, 1.05, 1.05)),
            cheek=((0.002, 0.006, -0.008), (1.0, 1.1, 1.3)), jaw=((0, -0.004, 0.0), (0.9, 1.05, 0.95))),
    5: dict(snout=-0.004, snout_s=(1.0, 1.1, 1.0), brow=((0.002, -0.008, 0.002), (1.1, 1.35, 1.35)),
            cheek=((-0.002, 0.004, 0.0), (0.85, 0.85, 0.8)), jaw=((0, -0.006, -0.008), (0.92, 1.12, 1.2))),
    6: dict(snout=0.003, snout_s=(1.08, 0.92, 1.05), brow=((0, 0.0, 0.0), (0.95, 1.0, 1.0)),
            cheek=((0.004, -0.004, -0.002), (1.25, 1.3, 1.3)), jaw=((0, 0.002, 0.004), (0.95, 0.92, 0.9))),
}


# Ixari faces: 5 the nasal ridge (its tip and nostrils travel with it), 8 the brow plates, 2 the cheekbones, 3 the jaw;
# `upper` spaces the second pair of eyes (dx out, dz up)
IX_FACES = {
    1: dict(snout=-0.006, snout_s=(1.0, 1.15, 1.2), brow=((0, -0.004, 0.002), (1.1, 1.3, 1.25)),
            cheek=((0.004, 0.0, 0.006), (1.1, 1.1, 1.0)), jaw=((0, -0.004, -0.006), (0.9, 1.05, 1.15)), upper=(0.0, 0.0)),
    2: dict(snout=0.004, snout_s=(0.9, 0.85, 0.85), brow=((0, 0.0, -0.004), (1.0, 0.9, 0.9)),
            cheek=((0.008, 0.004, -0.002), (1.25, 1.0, 1.1)), jaw=((0, 0.0, 0.002), (1.15, 0.95, 0.95)), upper=(0.005, -0.003)),
    3: dict(snout=0.002, snout_s=(1.35, 0.9, 0.85), brow=((0.006, 0.002, -0.002), (1.2, 1.0, 0.9)),
            cheek=((0.01, 0.0, -0.004), (1.3, 1.1, 1.2)), jaw=((0, 0.0, -0.002), (1.2, 1.0, 1.1)), upper=(0.008, -0.004)),
    4: dict(snout=-0.008, snout_s=(1.1, 1.25, 1.1), brow=((0, -0.002, 0.006), (1.05, 1.2, 1.2)),
            cheek=((-0.004, 0.006, 0.0), (0.85, 0.85, 0.85)), jaw=((0, -0.006, -0.004), (0.95, 1.1, 1.0)), upper=(-0.004, 0.004)),
    5: dict(snout=-0.004, snout_s=(0.85, 1.1, 1.3), brow=((-0.004, -0.002, 0.004), (0.85, 1.1, 1.1)),
            cheek=((-0.006, 0.0, 0.008), (0.8, 1.0, 1.0)), jaw=((0, 0.002, -0.004), (0.82, 1.0, 1.15)), upper=(-0.006, 0.006)),
    6: dict(snout=0.003, snout_s=(1.15, 0.9, 0.95), brow=((0.004, -0.006, 0.0), (1.15, 1.25, 1.0)),
            cheek=((0.004, -0.002, -0.006), (1.1, 1.2, 1.3)), jaw=((0, -0.002, -0.006), (1.12, 1.08, 1.2)), upper=(0.003, 0.0)),
}


# Ulgani faces, on top of each head's own skull: 7 the nasal plate (the nostrils travel with it), 4 the brow masses,
# 6 the cheekbones, 2 the jaw
UL_FACES = {
    1: dict(snout=-0.006, snout_s=(0.9, 1.3, 1.25), brow=((0, -0.003, 0.004), (1.0, 1.3, 1.3)),
            cheek=((-0.003, 0.0, 0.004), (0.9, 1.0, 1.0)), jaw=((0, 0.0, 0.0), (0.95, 1.0, 1.05))),
    2: dict(snout=-0.004, snout_s=(1.0, 1.2, 1.0), brow=((0, -0.004, -0.004), (1.1, 1.2, 0.95)),
            cheek=((0, 0.004, 0.0), (0.85, 0.9, 0.9)), jaw=((0, -0.006, -0.008), (0.92, 1.1, 1.2))),
    3: dict(snout=0.004, snout_s=(1.35, 0.85, 0.85), brow=((0.006, 0.0, 0.0), (1.2, 1.0, 1.0)),
            cheek=((0.012, 0.002, 0.0), (1.35, 1.15, 1.2)), jaw=((0, 0.0, -0.004), (1.18, 1.0, 1.15))),
    4: dict(snout=0.005, snout_s=(0.85, 0.85, 0.85), brow=((0, 0.002, 0.0), (0.9, 0.95, 0.95)),
            cheek=((-0.004, -0.002, 0.004), (0.8, 0.85, 0.85)), jaw=((0, 0.004, 0.006), (0.86, 0.9, 0.85))),
    5: dict(snout=-0.01, snout_s=(1.05, 1.35, 1.1), brow=((0, -0.002, 0.002), (1.05, 1.1, 1.1)),
            cheek=((0, 0.004, -0.008), (1.0, 1.0, 1.3)), jaw=((0, -0.004, -0.01), (0.95, 1.05, 1.25))),
    6: dict(snout=0.0, snout_s=(1.25, 1.0, 1.1), brow=((0.004, -0.008, 0.0), (1.25, 1.45, 1.35)),
            cheek=((0.008, -0.004, 0.0), (1.3, 1.3, 1.3)), jaw=((0, -0.002, -0.008), (1.2, 1.1, 1.25))),
}


def _face(H, f, idx):
    F = H['forms']

    def edit(i, d, sc):
        e = list(F[i])
        e[1] = tuple(np.add(e[1], d))
        e[2] = tuple(np.multiply(e[2], sc))
        F[i] = tuple(e)
    sdy = f.get('snout', 0.0)
    edit(idx['snout'], (0, sdy, 0), f.get('snout_s', (1, 1, 1)))
    for i in idx['lips']:
        edit(i, (0, sdy, 0), (1, 1, 1))
    for key in ('brow', 'cheek', 'jaw'):
        if key in f:
            edit(idx[key], *f[key])


def head_def(people, k):
    if people == 'thalune':
        base, var = TH_BASE, TH_VARIANTS[k]
    elif people == 'ixari':
        base, var = IX_BASE, IX_VARIANTS[k]
    elif people == 'ulgani':
        base, var = UL_BASE, UL_VARIANTS[k]
    else:
        raise KeyError(people)
    H = copy.deepcopy(base)
    for i, form in var.get('base_edit', {}).items():
        H['forms'][i] = form
    if people == 'thalune':
        _face(H, TH_FACES[k], dict(snout=5, lips=(8, 9, 10), brow=6, cheek=7, jaw=3))
    elif people == 'ulgani':
        _face(H, UL_FACES[k], dict(snout=7, lips=(12,), brow=4, cheek=6, jaw=2))
    elif people == 'ixari':
        _face(H, IX_FACES[k], dict(snout=5, lips=(6, 7), brow=8, cheek=2, jaw=3))
        dx, dz = IX_FACES[k]['upper']
        H['eyes'] = [dict(e, dx=dx, dz=dz) if e.get('upper') else e for e in H['eyes']]
    H['forms'] = H['forms'] + var.get('forms', [])
    if people == 'thalune':
        # every fin grows out of a raised base of skin along its root line, blended into the skull
        for a in var.get('acc', []):
            if a['kind'] != 'membrane':
                continue
            for p0, p1 in zip(a['root'][:-1], a['root'][1:]):
                H['forms'].append(('cone', p0, p1, 0.0098, 0.0098, 0.018, a.get('mirror', True)))
    H['acc'] = var.get('acc', [])
    H['vname'] = var['name']
    return H


# ---------------------------------------------------------------------------------------------- accessories
def _profile(name):
    if name == 'crest':
        return lambda u: 0.35 + 0.65 * np.sin(np.pi * np.clip(u, 0, 1)) ** 0.8
    return None


def accessories(ctx, H, S, prefix):
    """Builds the head's accessory meshes (world space).  Returns a list of objects."""
    s = ctx.s
    base = ctx.bs['head']['head']
    out = []
    for ai, a in enumerate(H.get('acc', [])):
        if a['kind'] in ('crystals', 'fronds'):
            out += grown(ctx, a, S, f'{prefix}_g{ai}', base, s)
            continue
        if a['kind'] != 'membrane':
            continue
        sides = (1,) if a.get('mirror', True) is False else (1, -1)
        for side in sides:
            M = np.array([side, 1, 1.0])
            root = [base + np.array(p) * M * s for p in a['root']]
            # sit the root on the skin
            root = list(S.project(np.array(root), iters=10))
            od = nrm(np.array(a['out']) * M)
            tang = nrm(root[-1] - root[0])
            if 'normal' in a:
                nh = nrm(np.array(a['normal']) * M)
            else:
                nh = nrm(np.cross(tang, od))
                if nh[0] * side < 0:
                    nh = -nh
            n = len(root)
            me = membrane.build(f'{prefix}_m{ai}_{side}', root, [od] * n, [nh] * n, a['length'] * s,
                                M=max(16, 8 * a['rays'] + 4), K=12, rays=a['rays'], scallop=a.get('scallop', 0.16),
                                droop=a.get('droop', 0.0), curl=a.get('curl', 0.0), thick=a.get('thick', 0.0021) * s,
                                rib_h=a.get('rib_h', 0.0024) * s, rib_w=a.get('rib_w', 0.24), sink=a.get('sink', 0.006) * s,
                                fan=a.get('fan', 0.0), profile=_profile(a.get('profile')), ray_len=a.get('ray_len'),
                                twist=a.get('twist', 0.0))
            o = bpy.data.objects.new(f'{prefix}_m{ai}_{side}', me)
            bpy.context.scene.collection.objects.link(o)
            o['acc'] = ai
            # mood display: side frills swing out about their root line, midline crests rise
            co = np.array([v.co for v in me.vertices])
            r0, r1 = np.array(root[0]), np.array(root[-1])
            if len(sides) == 2:
                ax = nrm(r1 - r0)
                ang = np.radians(a.get('flare', 24.0))
                def rot(P, ang):
                    v = P - r0
                    return r0 + v * np.cos(ang) + np.cross(ax, v) * np.sin(ang) + np.outer(v @ ax, ax) * (1 - np.cos(ang))
                d1 = rot(co, ang) - co
                if (d1.mean(0)[0]) * side < 0:
                    d1 = rot(co, -ang) - co
            else:
                rl = np.array(root)
                dd = np.linalg.norm(co[:, None] - rl[None], axis=2)
                near = rl[np.argmin(dd, axis=1)]
                d1 = (co - near) * 0.18
            att = me.attributes.new('flare', 'FLOAT_VECTOR', 'POINT')
            att.data.foreach_set('vector', d1.astype(np.float32).ravel())
            out.append(o)
    return out


# ---------------------------------------------------------------------------------------------- body accessories
def body_accessories(ctx, bmap, people, prefix):
    """Thalune: forearm fins along the trailing edge, small calf fins, webs between the toes."""
    out = []
    if people == 'ixari':
        return ixari_body_crystals(ctx, bmap, prefix)
    if people != 'thalune':
        return out
    s = ctx.s
    for side in (1, -1):
        sd = 'L' if side > 0 else 'R'
        for nm, part, srng, length, rays in (('forearmfin', 'arm', (0.6, 0.93), 0.026, 5), ('calffin', 'leg', (0.6, 0.8), 0.018, 4)):
            ss = np.linspace(srng[0], srng[1], 6)
            P, N = bmap.point(part, side, ss, np.full(6, 180.0), -0.002 * s)
            tang = nrm(P[-1] - P[0])
            outd = [nrm(n + tang * 0.35) for n in N]
            nh = [nrm(np.cross(tang, o)) for o in outd]
            prof = lambda u: np.sin(np.pi * np.clip(u, 0, 1)) ** 0.6 * 0.9 + 0.1
            me = membrane.build(f'{prefix}_{nm}_{sd}', list(P), outd, nh, length * s, M=8 * rays + 4, K=10, rays=rays,
                                scallop=0.2, thick=0.0016 * s, rib_h=0.0016 * s, rib_w=0.24, sink=0.004 * s, profile=prof)
            o = bpy.data.objects.new(f'{prefix}_{nm}_{sd}', me)
            bpy.context.scene.collection.objects.link(o)
            out.append(o)
        # toe webs: between neighbouring toes, from the toe bases toward the tips, a concave free edge
        from .anatomy import toe_axes
        from .peoples import THALUNE
        ta = toe_axes(ctx, THALUNE, side)
        for a, b in ((0, 1), (1, 2)):
            pa, pb = ta[a][0], ta[b][0]
            d = nrm((ta[a][1] - ta[a][0]) + (ta[b][1] - ta[b][0]))
            L = min(np.linalg.norm(ta[a][1] - ta[a][0]), np.linalg.norm(ta[b][1] - ta[b][0])) * 0.62
            prof = lambda u: 1 - 0.45 * np.sin(np.pi * np.clip(u, 0, 1))
            me = membrane.build(f'{prefix}_web{a}_{sd}', [pa, pb], [d, d], [np.array([0, 0, 1.0])] * 2, L, M=14, K=8, rays=0,
                                scallop=0.0, thick=0.0014 * s, rib_h=0.0, sink=0.003 * s, profile=prof)
            o = bpy.data.objects.new(f'{prefix}_web{a}_{sd}', me)
            bpy.context.scene.collection.objects.link(o)
            out.append(o)
        # webs between the fingers: from the knuckles toward the second joints, a concave free edge
        for f1, f2 in (('index', 'middle'), ('middle', 'ring')):
            b1, b2 = ctx.bs[f'{f1}_01_L'], ctx.bs[f'{f2}_01_L']
            Mx = np.array([side, 1.0, 1.0])
            pa, pb = b1['head'] * Mx, b2['head'] * Mx
            e1, e2 = ctx.bs[f'{f1}_02_L'], ctx.bs[f'{f2}_02_L']
            q1 = (e1['head'] + (e1['tail'] - e1['head']) * 0.7) * Mx
            q2 = (e2['head'] + (e2['tail'] - e2['head']) * 0.7) * Mx
            d1, d2 = nrm(q1 - pa), nrm(q2 - pb)
            nh = nrm(np.cross(nrm(pb - pa), d1 + d2))
            L = [np.linalg.norm(q1 - pa), np.linalg.norm(q2 - pb)]
            prof = lambda u: 1 - 0.28 * np.sin(np.pi * np.clip(u, 0, 1))
            me = membrane.build(f'{prefix}_fweb_{f1}_{sd}', [pa, pb], [d1, d2], [nh, nh], L, M=14, K=10, rays=0, scallop=0.0,
                                thick=0.0016 * s, rib_h=0.0, sink=0.003 * s, profile=prof)
            o = bpy.data.objects.new(f'{prefix}_fweb_{f1}_{sd}', me)
            bpy.context.scene.collection.objects.link(o)
            out.append(o)
        # claws at the toe tips: short dark hooks
        for base, tip, r in ta:
            dirc = nrm(nrm(tip - base) + np.array([0, 0, -0.55]))
            out.append(_claw(f'{prefix}_claw_{sd}_{len(out)}', tip - dirc * 0.002 * s, dirc, 0.0085 * s, 0.0028 * s))
        # a dorsal fin along the spine from the nape to the small of the back: the silhouette's break at the back
    root = [ctx.p('neck_02', 0.1, f=-0.05), ctx.p('neck_01', 0.4, f=-0.064), ctx.p('spine_03', 0.75, f=-0.088),
            ctx.p('spine_03', 0.3, f=-0.094), ctx.p('spine_02', 0.6, f=-0.08), ctx.p('spine_02', 0.15, f=-0.068)]
    root = list(bmap.S.project(np.array(root), iters=10))
    outd = [nrm(np.array([0.0, 1.0, 0.3 - 0.09 * i])) for i in range(len(root))]
    lens = [0.062 * s, 0.095 * s, 0.102 * s, 0.092 * s, 0.072 * s, 0.038 * s]
    me = membrane.build(f'{prefix}_dorsal', root, outd, [np.array([1.0, 0, 0])] * len(root), lens, M=60, K=12, rays=9,
                        scallop=0.18, droop=0.04, thick=0.0034 * s, rib_h=0.0032 * s, rib_w=0.22, sink=0.008 * s)
    o = bpy.data.objects.new(f'{prefix}_dorsal', me)
    bpy.context.scene.collection.objects.link(o)
    out.append(o)
    for o in out:
        a = o.data.attributes.new('flare', 'FLOAT_VECTOR', 'POINT')
    return out


def _claw(name, base, d, length, r):
    """A small curved claw (a tapered, slightly hooked cone)."""
    from .growths import _frame
    u, v, d = _frame(d)
    bm = bmesh.new()
    rings = []
    n = 6
    for i in range(5):
        t = i / 4
        c = base + d * length * t - v * length * 0.25 * t * t
        rr = r * (1 - 0.85 * t)
        rings.append([bm.verts.new(tuple(c + (u * math.cos(2 * math.pi * k / n) + v * math.sin(2 * math.pi * k / n)) * rr)) for k in range(n)])
    tip = bm.verts.new(tuple(base + d * length * 1.12 - v * length * 0.3))
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    for k in range(n):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % n], tip))
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    from .growths import component_uvs
    component_uvs(me)
    for key, val in (('rib', 1.0), ('edge', 0.0)):
        a = me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.full(len(me.vertices), val, np.float32))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o




def grown(ctx, a, S, name, base, s):
    """Crystals or fronds placed on the head sculpt: bases projected onto the skin, directions in head space."""
    from . import growths
    items = []
    sides = (1, -1) if a.get('mirror') else (1,)
    for side in sides:
        Mx = np.array([side, 1, 1.0])
        for it in a['items']:
            b = S.project((base + np.array(it['base']) * Mx * s)[None], iters=10)[0]
            q = dict(it)
            q['base'] = b
            q['dir'] = nrm(np.array(it['dir']) * Mx)
            if 'side' in it:
                q['side'] = np.array(it['side']) * Mx
            q['length'] = it['length'] * s
            if 'radius' in it:
                q['radius'] = it['radius'] * s
            items.append(q)
    if a['kind'] == 'crystals':
        me = growths.crystal_mesh(name, items, seed=len(items) * 7 + 3)
        flare = np.zeros((len(me.vertices), 3))
    else:
        me = growths.frond_mesh(name, items, seed=len(items) * 5 + 1)
        # mood display: fronds rise (rotate up about their base toward the vertical)
        co = np.array([v.co for v in me.vertices])
        flare = np.zeros_like(co)
        bases = np.array([q['base'] for q in items])
        k = np.argmin(np.linalg.norm(co[:, None] - bases[None], axis=2), axis=1)
        for i, q in enumerate(items):
            sel = k == i
            d = q['dir']
            axis = nrm(np.cross(d, np.array([0, 0, 1.0]))) if abs(d[2]) < 0.98 else np.array([1.0, 0, 0])
            ang = math.radians(16)
            v = co[sel] - q['base']
            rot = v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + np.outer(v @ axis, axis) * (1 - math.cos(ang))
            flare[sel] = rot - v + np.array([0, 0, 0.004 * s]) * (np.linalg.norm(v, axis=1)[:, None] / (q['length'] + 1e-9))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    att = me.attributes.new('flare', 'FLOAT_VECTOR', 'POINT')
    att.data.foreach_set('vector', flare.astype(np.float32).ravel())
    return [o]


def ixari_body_crystals(ctx, bmap, prefix):
    """Living crystal along the spine (leaning back and up from slate sockets) and along the outer forearms."""
    from . import growths
    from .peoples import SPINE_SOCKETS, FOREARM_SOCKETS
    c = ctx
    s = c.s
    S = bmap.S
    items = []
    # the dorsal row: 12-18 cm shafts standing off the back (the 100 m outline), kinds alternating down the spine, with
    # paired side shards on the larger sockets
    spine_kinds = ('hex', 'chisel', 'sceptre', 'rhomb', 'broken', 'hex', 'sceptre', 'chisel')
    for i, (bone, t, r) in enumerate(SPINE_SOCKETS):
        p = c.p(bone, t, f=-0.075 - (0.01 if bone == 'spine_03' else 0.0))
        b = S.project(p[None], iters=10)[0]
        tilt = 0.45 + 0.25 * (i / max(len(SPINE_SOCKETS) - 1, 1))
        items.append(dict(base=b, dir=nrm(np.array([0.0, 1.0, tilt * 0.8])), length=(0.1 + r * 4.5) * s, radius=r * 1.12 * s,
                          lean=(0, 0, 1), kind=spine_kinds[i % len(spine_kinds)]))
        if r >= 0.016:
            for sd in (1, -1):
                items.append(dict(base=b + np.array([sd * r * 0.9 * s, 0.002 * s, 0.0]), dir=nrm(np.array([sd * 0.45, 1.0, tilt])),
                                  length=r * 5.6 * s, radius=r * 0.62 * s, kind='needle' if sd > 0 else 'stub'))
    for side in (1, -1):
        la = 'lowerarm_L' if side > 0 else 'lowerarm_R'
        x, v, z = c.fr[la]
        for t, r in FOREARM_SOCKETS:
            p = c.p('lowerarm_L', t, a=-0.022, f=-0.012) * np.array([side, 1, 1.0])
            b = S.project(p[None], iters=10)[0]
            g = S.grad(b[None])[0]
            n = nrm(g)
            back = -nrm(c.bs[la]['tail'] - c.bs[la]['head'])
            items.append(dict(base=b, dir=nrm(n + back * 0.4), length=r * 9.0 * s, radius=r * 0.95 * s, terraces=4, tip=0.3))
            items.append(dict(base=b + back * 0.016 * s, dir=nrm(n * 0.9 + back * 0.7), length=r * 5.0 * s, radius=r * 0.55 * s,
                              terraces=3, tip=0.32))
    me = growths.crystal_mesh(f'{prefix}_crystals', items, seed=11)
    o = bpy.data.objects.new(f'{prefix}_crystals', me)
    bpy.context.scene.collection.objects.link(o)
    a = me.attributes.new('flare', 'FLOAT_VECTOR', 'POINT')
    return [o]
