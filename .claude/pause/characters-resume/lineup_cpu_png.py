"""CPU PNG composition of the existing lineup.py's native120px/4x-nearest layout.

No Blender, browser, renderer, source or export work. Colour pixels are copied
exactly. Grayscale applies lineup.py's Rec709 coefficients directly to the PNG
channels, verified against all20 frozen peer native grayscale crops (<=1/255).
"""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--grayscale', action='store_true')
parser.add_argument('output', type=Path)
parser.add_argument('captures', type=Path, nargs='+')
args = parser.parse_args()
width = height = 120
scale, gap = 4, 8
sheet = np.zeros((height * (scale + 1) + gap, len(args.captures) * (width + gap) * scale, 4), dtype=np.uint8)
sheet[..., 3] = 255
sources = []
for column, source in enumerate(args.captures):
    assert source.name == 'far_lod2.png'
    with Image.open(source) as image:
        image = image.convert('RGBA')
        w, h = image.size
        assert [w, h] == [1920, 1080]
        x, y = w // 2 - width // 2, h // 2 - height // 2
        crop = np.array(image.crop((x, y, x + width, y + height)))
    original = crop.copy()
    if args.grayscale:
        gray = crop[..., :3].astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        crop[..., :3] = np.clip(np.rint(gray), 0, 255).astype(np.uint8)[..., None]
    left = column * (width + gap) * scale
    native_left = left + (width * scale - width) // 2
    sheet[:height, native_left:native_left + width] = crop
    enlarged = np.repeat(np.repeat(crop, scale, axis=0), scale, axis=1)
    sheet[height + gap:, left:left + width * scale] = enlarged
    assert np.array_equal(sheet[:height, native_left:native_left + width], crop)
    assert np.array_equal(sheet[height + gap::scale, left:left + width * scale:scale], crop)
    if not args.grayscale:
        assert np.array_equal(crop, original)
    sources.append({'column': column + 1, 'path': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'capture_size': [w, h], 'crop': [x, y, width, height]})
args.output.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(sheet).save(args.output)
with Image.open(args.output) as result:
    assert np.array_equal(np.array(result.convert('RGBA')), sheet)
args.output.with_suffix('.json').write_text(json.dumps({'distance_m': 100, 'lod': 2, 'lighting': 'noon-lush', 'grayscale': args.grayscale, 'enlargement': '4x nearest neighbour', 'rows': ['native captured pixels', 'enlarged captured pixels'], 'sources': sources, 'method': 'CPU PNG composition; colour captured pixels preserved exactly; grayscale applies Rec709 coefficients directly to PNG channels, matching existing lineup.py outputs within1/255 across all20 frozen peer native crops. Same120px centre crop/4x-nearest layout; no Blender/render/browser invoked.', 'pixel_checks': {'native_crop_exact': True, 'enlarged_nearest_exact': True, 'saved_png_roundtrip_exact': True}}, indent=2) + '\n')
print('LINEUP_SAVED_CPU_PNG', args.output, sheet.shape[1], sheet.shape[0], flush=True)
