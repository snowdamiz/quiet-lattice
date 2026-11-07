import json, os, sys
wt = sys.argv[1]
for p in ('thalune', 'ixari', 'ulgani'):
    for kind in ('blend', 'glb'):
        d = json.load(open(f'{wt}/assets/renders/characters/validate/characters__{p}.{kind}.json'))
        vs = [v for a in d['assets'] for v in a['variants']]
        rng = {l: (min(v['lodTris'][l] for v in vs), max(v['lodTris'][l] for v in vs)) for l in '0123'}
        h = (min(v['dims'][2] for v in vs), max(v['dims'][2] for v in vs))
        mats = sorted({m for v in vs for m in v['materials']})
        print(f"{p:8} {kind:5} {d['status']} {d['summary']['fail']}f/{d['summary']['warn']}w  "
              + '  '.join(f"L{l} {a}-{b}" for l, (a, b) in rng.items())
              + f"  height {h[0]:.2f}-{h[1]:.2f} m  {len(vs)} variants  {','.join(mats)}")
    print(f"{p:8} glb size {os.path.getsize(f'{wt}/packages/client/public/models/characters/{p}.glb') / 1e6:.1f} MB")
