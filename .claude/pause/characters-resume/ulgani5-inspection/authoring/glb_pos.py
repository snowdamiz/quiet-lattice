import json, struct, sys
b = open(sys.argv[1], 'rb').read()
jl = struct.unpack_from('<I', b, 12)[0]
j = json.loads(b[20:20 + jl])
seen = 0
for ni, n in enumerate(j['nodes']):
    if 'mesh' not in n:
        continue
    m = j['meshes'][n['mesh']]
    a = j['accessors'][m['primitives'][0]['attributes']['POSITION']]
    print(n.get('name'), 'skin' in n, {k: n[k] for k in ('translation', 'scale') if k in n}, a['componentType'], a.get('normalized'), a.get('min'), a.get('max'))
    seen += 1
    if seen > 5:
        break
