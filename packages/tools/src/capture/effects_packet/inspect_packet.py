"""Full bounded PNG decoding and the actual standard Review perf schema. CPU only.

No Pillow, ffmpeg, Blender, browser, ImageIO or hardware codec. Python's pinned
zlib expands the PNG stream; every scanline/filter and every chunk CRC is checked.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import zlib

from contract import ASSET, FILE, LIGHTS, OUTPUT_CAP, PNG_CAP, PERF_CAP, bounded_bytes, plan, snapshot, require


def png(file, dimensions):
    path = Path(file)
    data = bounded_bytes(path, PNG_CAP)
    require(data[:8] == b'\x89PNG\r\n\x1a\n', 'PNG signature')
    offset, compressed, size, ended, idat_ended = 8, bytearray(), None, False, False
    while offset < len(data):
        require(offset + 12 <= len(data), 'Truncated PNG chunk')
        count = struct.unpack_from('>I', data, offset)[0]
        tag = data[offset + 4:offset + 8]
        end = offset + 12 + count
        require(end <= len(data), 'PNG chunk outside file')
        body = data[offset + 8:end - 4]
        crc = struct.unpack_from('>I', data, end - 4)[0]
        require(zlib.crc32(tag + body) & 0xffffffff == crc, 'PNG CRC')
        if size is None:
            require(tag == b'IHDR' and count == 13, 'PNG IHDR order/length')
            width, height, bits, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', body)
            require((width, height) == tuple(dimensions), 'PNG dimensions')
            require(bits == 8 and color in (2, 6) and compression == filtering == interlace == 0, 'Nonstandard canvas PNG encoding')
            channels = 3 if color == 2 else 4
            size = (width, height, channels)
        elif tag == b'IHDR':
            raise ValueError('Duplicate IHDR')
        elif tag == b'IDAT':
            require(not idat_ended, 'Noncontiguous IDAT')
            compressed.extend(body)
        elif tag == b'IEND':
            require(count == 0 and compressed and end == len(data), 'PNG IEND/trailing bytes')
            ended = True
        elif tag == b'PLTE':
            require(not compressed and count % 3 == 0 and count <= 768, 'PNG palette placement')
        else:
            require(tag[0] & 32, 'Unknown critical PNG chunk')
            if compressed:
                idat_ended = True
        offset = end
    require(ended and size is not None, 'Incomplete PNG')
    width, height, channels = size
    stride = width * channels
    expected = (stride + 1) * height
    inflater = zlib.decompressobj()
    raw = inflater.decompress(compressed, expected + 1)
    require(len(raw) == expected and inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail, 'PNG full zlib stream/decoded bound')
    previous = bytearray(stride)
    digest = hashlib.sha256()
    filters = set()
    for y in range(height):
        at = y * (stride + 1)
        kind = raw[at]
        require(kind in range(5), 'PNG filter')
        filters.add(kind)
        row = bytearray(raw[at + 1:at + 1 + stride])
        if kind:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                up = previous[x]
                upper_left = previous[x - channels] if x >= channels else 0
                if kind == 1:
                    predictor = left
                elif kind == 2:
                    predictor = up
                elif kind == 3:
                    predictor = (left + up) // 2
                else:
                    p = left + up - upper_left
                    a, b, c = abs(p - left), abs(p - up), abs(p - upper_left)
                    predictor = left if a <= b and a <= c else up if b <= c else upper_left
                row[x] = (row[x] + predictor) & 255
        digest.update(row)
        previous = row
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'dimensions': [width, height], 'channels': channels, 'decodedBytes': height * stride,
            'scanlines': height, 'filters': sorted(filters), 'pixelsSha256': digest.hexdigest()}


def stats(value, material, triangles):
    require(isinstance(value, dict), 'Missing actual Review stats')
    require(value.get('file') == FILE and value.get('asset') == value.get('variant') == ASSET, 'Wrong Review root')
    require(type(value.get('lod')) is int and value['lod'] == 0 and type(value.get('shown')) is int and value['shown'] == 0 and value.get('lods') == [0], 'Requested/selected/available LOD facts')
    require(value.get('materials') == [material], 'Wrong filament material')
    require(value.get('meshes') == 1 and value.get('triangles') == triangles, 'Wrong shown mesh geometry')
    textures = value.get('textures')
    require(isinstance(textures, dict), 'Missing compressed texture observations')
    for which in ('shown', 'file'):
        t = textures.get(which)
        require(isinstance(t, dict) and type(t.get('compressed')) is int and 0 < t['compressed'] <= t.get('count', -1), 'Compressed textures must be nonzero')
        require(type(t.get('mb')) in (int, float) and math.isfinite(t['mb']) and t['mb'] > 0, 'Compressed texture GPU size missing')


def perf(value, material, triangles):
    require(value.get('file') == FILE and value.get('asset') == value.get('variant') == ASSET, 'Perf asset binding')
    require(value.get('class') == 'effect' and value.get('gl') == 'metal' and value.get('viewport') == [1920, 1080], 'Perf class/backend/viewport')
    require(value.get('errors') == [], 'Review reported page errors')
    stats(value.get('stats'), material, triangles)
    samples = value.get('perf')
    require(isinstance(samples, list) and len(samples) == 3 and [x.get('case') for x in samples] == list(LIGHTS), 'Three perf cases required')
    for sample in samples:
        require(sample.get('lod') == 0 and sample.get('viewport') == [1920, 1080], 'Perf sample LOD/viewport')
        stats(sample.get('stats'), material, triangles)
        require(all(isinstance(sample.get(k), dict) for k in ('scene', 'withoutAsset', 'asset', 'settle')), 'Actual perf shape missing')
    far = value.get('far')
    require(isinstance(far, list) and len(far) == 1, 'Effect has one far view, no hero 200m shot')
    require(far[0].get('range') == 100 and far[0].get('case') == 'noon-lush' and far[0].get('lod') == 2 and type(far[0].get('shown')) is int and far[0]['shown'] == 0, 'Far requested LOD2 must select LOD0')
    require(set(value.get('spots', {})) == set(LIGHTS) and isinstance(value.get('overlay'), dict), 'Missing lighting/overlay facts')
    return {'requestedLods': [0, 2], 'selectedLod': 0, 'availableLods': [0], 'material': material,
            'textureFacts': value['stats']['textures'], 'performanceQualified': False,
            'note': 'Retained standard perf shape is not T13 GPU attribution or 60fps qualification.'}


def inspect_packet(ready, writes):
    root = Path(ready['pilot']['output'])
    require(root.is_dir() and not root.is_symlink(), 'Output root unsafe')
    actual = []
    for p in root.rglob('*'):
        require(not p.is_symlink(), 'Output symlink')
        if p.is_dir():
            require(p == root / ASSET, 'Unexpected output directory')
        else:
            require(p.is_file(), 'Special output file')
            actual.append(str(p.relative_to(root)))
    require(sorted(actual) == sorted(plan()), 'Exact twelve-file inventory required')
    require(isinstance(writes, list) and [w['path'] for w in writes] == plan(), 'Actual entry write inventory/order')
    total, results, facts = 0, [], None
    for row in writes:
        path = root / row['path']
        limit = PERF_CAP if path.name == 'perf.json' else PNG_CAP
        value = snapshot(path, PERF_CAP) if path.name == 'perf.json' else png(path, [1920, 2876] if path.name == 'sheet.png' else [1920, 1080])
        size = value['bytes']
        require(row.get('completed') is True and 0 < size <= limit and size == row['bytes'] and value['sha256'] == row['sha256'], 'Output bytes/hash/cap mismatch')
        total += size
        if path.name != 'perf.json':
            results.append({'path': row['path'], **value})
        else:
            facts = perf(value['value'], ready['asset']['material'], ready['asset']['triangles'])
    require(total <= OUTPUT_CAP, 'Aggregate output cap')
    return {'valid': True, 'files': writes, 'totalBytes': total, 'decodedPngs': results, 'review': facts}
