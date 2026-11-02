"""Compare the actual 100 m engine captures at native size and 4x nearest scale.

Blender -b --factory-startup -P this.py -- [--grayscale] output.png far_lod2.png ...
Columns retain input order. The JSON sidecar records every input hash. This only
crops and arranges captured pixels; it does not replace their silhouette or camera.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--grayscale', action='store_true')
parser.add_argument('output', type=Path)
parser.add_argument('captures', type=Path, nargs='+')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
crops, sources = [], []
width = height = 120
scale, gap = 4, 8
for source in args.captures:
    assert source.name == 'far_lod2.png', 'Use the standard 100 m LOD2 review capture'
    image = bpy.data.images.load(str(source.resolve()))
    w, h = image.size
    assert w >= width and h >= height
    pixels = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h, w, 4)
    x, y = w // 2 - width // 2, h // 2 - height // 2
    crop = pixels[y:y + height, x:x + width].copy()
    if args.grayscale:
        luminance = crop[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        crop[..., :3] = luminance[..., None]
    crops.append(crop)
    sources.append({'column': len(sources) + 1, 'path': str(source),
                    'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                    'capture_size': [w, h], 'crop': [x, y, width, height]})
    bpy.data.images.remove(image)

columns = []
for crop in crops:
    enlarged = np.repeat(np.repeat(crop, scale, axis=0), scale, axis=1)
    native = np.zeros((height, width * scale, 4), np.float32)
    left = (native.shape[1] - width) // 2
    native[:, left:left + width] = crop
    separator = np.zeros((gap, width * scale, 4), np.float32)
    # Blender image pixels run bottom-up: enlarged view below the native view.
    column = np.concatenate([enlarged, separator, native], axis=0)
    columns.append(np.pad(column, ((0, 0), (0, gap * scale), (0, 0))))
sheet = np.concatenate(columns, axis=1)
sheet[..., 3] = 1.0
image = bpy.data.images.new('character_100m_comparison', sheet.shape[1], sheet.shape[0], alpha=True)
image.pixels.foreach_set(sheet.ravel())
args.output.parent.mkdir(parents=True, exist_ok=True)
image.filepath_raw = str(args.output.resolve())
image.file_format = 'PNG'
image.save()
args.output.with_suffix('.json').write_text(json.dumps({
    'distance_m': 100, 'lod': 2, 'lighting': 'noon-lush',
    'grayscale': args.grayscale, 'enlargement': '4x nearest neighbour',
    'rows': ['native captured pixels', 'enlarged captured pixels'], 'sources': sources,
}, indent=2) + '\n')
print('LINEUP_SAVED', args.output, flush=True)
