"""Final artifact/asset hashes and process release, without touching author files."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ap=argparse.ArgumentParser();ap.add_argument('--author-root',required=True)
a=ap.parse_args();author=Path(a.author_root);root=Path(__file__).resolve().parent
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
blend=author/'assets/blend/hulls/lark.blend';glb=author/'packages/client/public/models/hulls/lark.glb'
pins={'blend':sha(blend),'glb':sha(glb)}
assert pins=={'blend':'d48d83e9c6a76b0214028a80389a77d6dfd19f65704c73ffc9f47dca58b244ba','glb':'7cd5fed2661f96dd67b50c0a5f6d7df995be43d4adc57d327d35479d894a5e78'}
processes=subprocess.check_output(['ps','-axo','pid=,comm=,args='],text=True).splitlines()
active=[p for p in processes if '/Contents/MacOS/Blender 'in p or ('node 'in p and 'lark-geometry-qualification/'in p and any(name in p for name in ('survey.mjs','measure.mjs','source_compare.mjs','map_body.mjs','inspect.mjs')))]
assert not active,active
head=subprocess.check_output(['git','-C',str(author),'rev-parse','HEAD'],text=True).strip()
assert head=='6445c7ec07aa2a08b722aeca22d56132154ea32c'
artifacts=[]
for p in sorted(root.rglob('*')):
    if not p.is_file()or '__pycache__'in p.parts or p.name=='SEAL.json':continue
    artifacts.append(dict(path=str(p.relative_to(root)),bytes=p.stat().st_size,sha256=sha(p)))
seal=dict(candidate_head=head,assets=pins,assets_unchanged=True,active_geometry_processes=active,
          source_processes_released=True,artifact_bytes=sum(x['bytes']for x in artifacts),artifacts=artifacts,
          qualification='Geometry measurements retained; intentional clearance/semantic plate denominator/structural exposure remain UNQUALIFIED. No visual/runtime/performance acceptance.')
(root/'SEAL.json').write_text(json.dumps(seal,indent=2)+'\n')
print(json.dumps({k:v for k,v in seal.items()if k!='artifacts'}))
