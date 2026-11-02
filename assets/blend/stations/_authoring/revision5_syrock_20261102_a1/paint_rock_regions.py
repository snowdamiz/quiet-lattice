"""Four directed, sparse geological paint sets; no old texture is read or overwritten."""
import hashlib
from pathlib import Path
import struct
import zlib

import numpy as np

SIZE = 2048
TILE_METRES = 48.0


def write_png(path, pixels):
    assert not path.exists(), path
    rgb = np.round(np.clip(pixels, 0, 1) * 255).astype(np.uint8)
    data = np.concatenate([np.zeros((SIZE, 1), np.uint8), rgb.reshape(SIZE, SIZE * 3)], axis=1).tobytes()
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 2, 0, 0, 0)) +
                     chunk(b'IDAT', zlib.compress(data, 6)) + chunk(b'IEND', b''))


def field(seed, cells):
    rng = np.random.default_rng(seed)
    values = rng.random((cells + 1, cells + 1)).astype(np.float32)
    values[-1] = values[0]; values[:, -1] = values[:, 0]
    q = np.linspace(0, cells, SIZE, endpoint=False, dtype=np.float32)
    index = q.astype(np.int32); blend = q - index
    blend = blend * blend * (3 - 2 * blend)
    horizontal = values[:, index] * (1 - blend) + values[:, index + 1] * blend
    return horizontal[index] * (1 - blend[:, None]) + horizontal[index + 1] * blend[:, None]


def strokes(paths, width):
    canvas = np.zeros((SIZE, SIZE), np.float32)
    for points, weight in paths:
        for index, (a, b) in enumerate(zip(points, points[1:])):
            a, b = np.array(a) * SIZE, np.array(b) * SIZE
            w = width * (0.72 + 0.28 * ((index * 7 + len(points)) % 5) / 4)
            lo = np.maximum(0, np.floor(np.minimum(a, b) - w * 3).astype(int))
            hi = np.minimum(SIZE, np.ceil(np.maximum(a, b) + w * 3).astype(int))
            yy, xx = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]]
            if xx.size == 0: continue
            delta = b - a
            t = np.clip(((xx - a[0]) * delta[0] + (yy - a[1]) * delta[1]) / np.dot(delta, delta), 0, 1)
            distance = np.sqrt((xx - a[0] - delta[0] * t) ** 2 + (yy - a[1] - delta[1] * t) ** 2)
            patch = np.exp(-((distance / w) ** 2)) * weight
            view = canvas[lo[1]:hi[1], lo[0]:hi[0]]
            np.maximum(view, patch, out=view)
    return canvas


def paint(directory):
    directory.mkdir(exist_ok=False)
    # Unequal branching fractures end inside the sheet; there is no periodic line family.
    fractures = [([(0.07, .16), (.16, .29), (.21, .44), (.38, .52), (.49, .69), (.68, .75), (.87, .90)], 1.0),
                 ([(.21, .44), (.12, .56), (.17, .72)], .63),
                 ([(.49, .69), (.57, .49), (.69, .42), (.74, .23), (.70, .08)], .82),
                 ([(.38, .52), (.42, .34), (.33, .24)], .44),
                 ([(.69, .42), (.87, .48), (.94, .62)], .53)]
    crack = strokes(fractures, 2.3)
    halo = strokes(fractures, 8.4)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32) / SIZE
    patches = np.zeros((SIZE, SIZE), np.float32)
    for cx, cy, sx, sy, angle, weight in ((.22,.22,.19,.065,.4,.7),(.64,.67,.12,.22,-.55,.5),
                                         (.81,.19,.10,.08,.9,.45),(.32,.81,.21,.10,-.2,.62)):
        u = (xx-cx)*np.cos(angle)+(yy-cy)*np.sin(angle)
        v = -(xx-cx)*np.sin(angle)+(yy-cy)*np.cos(angle)
        patches += np.exp(-((u/sx)**2+(v/sy)**2)*1.8)*weight
    broad, chips, grain = field(501, 5), field(503, 29), field(509, 251)
    records = []
    regions = [('SY_Rock',(0.26,.285,.29),.86,.34),
               ('SY_Fracture_R4',(.195,.215,.225),.79,.90),
               ('SY_Excavated_R4',(.36,.345,.31),.83,.55),
               ('SY_Regolith',(.34,.30,.245),.94,.08)]
    for name, colour, roughness, fracture_weight in regions:
        mineral = patches * (0.8 if name == 'SY_Rock' else .55)
        variation = (broad-.5)*.18+(chips-.5)*.045+(grain-.5)*.012
        base = np.array(colour, np.float32)[None,None,:] * (1 + variation[...,None])
        base = np.broadcast_to(base, (SIZE,SIZE,3)).copy()
        base += mineral[...,None]*np.array([.045,.030,.009])
        base -= crack[...,None]*fracture_weight*.085
        base += halo[...,None]*fracture_weight*np.array([.010,.008,.004])
        relief = (chips-.5)*.065+(grain-.5)*.008-crack*fracture_weight*.115+mineral*.018
        if name == 'SY_Regolith':
            relief *= .22
            base += patches[...,None]*np.array([.018,.014,.006])
        dy, dx = np.gradient(relief, TILE_METRES/SIZE)
        normal = np.stack([-dx, dy, np.ones_like(dx)], axis=-1)
        normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
        normal = normal*.5+.5
        ao = np.clip(.98-crack*fracture_weight*.22-(chips-.5)*.025,.60,1)
        rough = np.clip(roughness+(chips-.5)*.10+patches*.025,.66,.99)
        orm = np.stack([ao,rough,np.zeros_like(ao)], axis=-1)
        for channel, pixels in [('base',base),('orm',orm),('normal',normal)]:
            path = directory/f'{name}_R5_{channel}.png';write_png(path,pixels)
            records.append({'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                            'region':name,'channel':channel,'size':[SIZE,SIZE]})
    return records
