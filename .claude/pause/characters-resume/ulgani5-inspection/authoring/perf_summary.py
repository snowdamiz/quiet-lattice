import json, glob, os, sys
wt = sys.argv[1]
for p in ('thalune', 'ixari', 'ulgani'):
    rows = []
    for f in sorted(glob.glob(f'{wt}/assets/renders/review/characters/{p}/{p}/*/perf.json')):
        d = json.load(open(f))
        a = [x['asset'] for x in d['perf'] if x['lod'] == 0]
        gpu = [x['gpuMs'] for x in a]
        cpu = [x['cpuMs'] for x in a]
        scene = [x['scene']['gpuMsMedian'] for x in d['perf'] if x['lod'] == 0]
        t = time = os.path.getmtime(f)
        rows.append((d['variant'], d['stats']['size'], max(gpu), max(cpu), a[0]['drawCalls'], min(scene), max(scene), d.get('errors'), t))
    print(p, 'asset LOD0 gpu ms max over cases', f"{min(r[2] for r in rows):.2f}-{max(r[2] for r in rows):.2f}",
          'cpu', f"{min(r[3] for r in rows):.2f}-{max(r[3] for r in rows):.2f}", 'draws', sorted({r[4] for r in rows}),
          'scene gpu', f"{min(r[5] for r in rows):.0f}-{max(r[6] for r in rows):.0f}", 'errors', sum(len(r[7] or []) for r in rows))
    for r in rows:
        print('  ', r[0], r[1], f"gpu {r[2]:.2f} cpu {r[3]:.2f}", __import__('time').strftime('%m-%d %H:%M', __import__('time').localtime(r[8])))
