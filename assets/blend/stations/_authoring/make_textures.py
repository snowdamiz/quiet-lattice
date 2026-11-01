import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import paint as P

out = os.environ.get("STATION_TEXTURE_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "tex"))
os.makedirs(out, exist_ok=True)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
which = argv or ["shell", "metal", "deck", "decal"]
makers = {"scrap": P.reaches_scrap, "rock": P.reaches_rock, "grate": P.reaches_grate, "regolith": P.reaches_regolith, "floor": P.compact_floor, "shell": P.compact_shell, "metal": P.compact_metal, "deck": P.compact_deck, "decal": P.compact_decal, "prop": P.compact_prop}
for k in which:
    t = time.time()
    s = makers[k]()
    P.save_png(f"{out}/{s.name}_base.png", P.to_srgb(s.base), alpha=s.alpha)
    orm = np.stack([s.ao, np.clip(s.rough, 0.05, 1), np.clip(s.metal, 0, 1)], -1)
    P.save_png(f"{out}/{s.name}_orm.png", orm)
    P.save_png(f"{out}/{s.name}_normal.png", s.normal)
    if s.emit.max() > 0:
        P.save_png(f"{out}/{s.name}_emit.png", P.to_srgb(s.emit))
    import json
    json.dump(s.strips, open(f"{out}/{s.name}_strips.json", "w"))
    print("made", s.name, round(time.time() - t, 1), "s")
