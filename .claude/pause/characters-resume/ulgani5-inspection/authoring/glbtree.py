import json, struct, sys
p = sys.argv[1]
data = open(p, 'rb').read()
clen, _ = struct.unpack_from('<II', data, 12)
js = json.loads(data[20:20 + clen])
nodes = js['nodes']
kids = set(c for n in nodes for c in n.get('children', []))
def show(i, d=0):
    n = nodes[i]
    extra = []
    if 'mesh' in n:
        m = js['meshes'][n['mesh']]
        extra.append(f"mesh={n['mesh']}:{m.get('name')} prims={len(m['primitives'])} targets={len(m['primitives'][0].get('targets', []))} extras={m.get('extras')}")
    if 'skin' in n:
        extra.append(f"skin={n['skin']}")
    if 'translation' in n or 'scale' in n or 'rotation' in n:
        extra.append(f"T={n.get('translation')} R={n.get('rotation')} S={n.get('scale')}")
    print('  ' * d + f"[{i}] {n.get('name')} " + ' '.join(extra))
    for c in n.get('children', []):
        show(c, d + 1)
for s in js['scenes']:
    for r in s['nodes']:
        show(r)
print('meshes', len(js['meshes']), 'skins', len(js.get('skins', [])), 'materials', [m['name'] for m in js['materials']], 'images', [(i.get('name'), i.get('mimeType')) for i in js.get('images', [])])
for i, s in enumerate(js.get('skins', [])):
    print('skin', i, 'skeleton', s.get('skeleton'), 'joints', [nodes[j]['name'] for j in s['joints']][:12])
print('bytes', len(data))
