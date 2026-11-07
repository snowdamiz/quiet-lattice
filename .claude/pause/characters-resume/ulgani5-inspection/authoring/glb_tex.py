import json, struct, sys, collections
for path in sys.argv[1:]:
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    binoff = 20 + jl + 8
    sizes = collections.Counter()
    for im in j.get('images', []):
        bv = j['bufferViews'][im['bufferView']]
        o = binoff + bv.get('byteOffset', 0)
        if b[o:o + 12] == b'\xabKTX 20\xbb\r\n\x1a\n':
            w, h = struct.unpack_from('<II', b, o + 20)
            sizes[(im.get('mimeType'), w, h)] += 1
        else:
            sizes[(im.get('mimeType'), '?', '?')] += 1
    print(path.rsplit('/', 1)[-1], dict(sizes), 'ext', j.get('extensionsUsed'))
