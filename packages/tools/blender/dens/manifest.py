"""Seal exact den source/export bytes and validator measurements after all pass.

python3 .../dens/manifest.py --reports /tmp/.../family --contracts /tmp/.../export.json --source-contracts /tmp/.../source.json
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[4]
NAMES=['den_burrow_0','den_burrow_1','den_nest_0','den_nest_1','den_roost_0','den_roost_1','den_apex_lair_0']
p=argparse.ArgumentParser()
p.add_argument('--reports',type=Path,required=True)
p.add_argument('--contracts',type=Path,required=True)
p.add_argument('--source-contracts',type=Path,required=True)
a=p.parse_args()
contracts={r['asset']:r for r in json.loads(a.contracts.read_text())}
source_contracts={r['asset']:r for r in json.loads(a.source_contracts.read_text())}


def record(path):
    return {'path':str(path.relative_to(ROOT)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}


assets=[]
for name in NAMES:
    source=ROOT/'assets/blend/sites'/(name+'.blend')
    export=ROOT/'packages/client/public/models/sites'/(name+'.glb')
    report=json.loads((a.reports/('sites__'+name+'.glb.json')).read_text())
    source_report=json.loads((a.reports/('sites__'+name+'.blend.json')).read_text())
    assert report['status']==source_report['status']==contracts[name]['status']==source_contracts[name]['status']=='PASS'
    assert contracts[name]['sha256']==record(export)['sha256']
    assert source_contracts[name]['sha256']==record(source)['sha256']
    variant=report['assets'][0]['variants'][0]
    assets.append({'name':name,'source':record(source),'export':record(export),
                   'class':variant['class'],'lodTriangles':variant['lodTris'],'gpuTextureMB':variant['gpuTextureMB'],
                   'plannerRadiusM':contracts[name]['radius'],'actualRadiusM':contracts[name]['actualRadius'],
                   'colliders':len(contracts[name]['colliders']),'spawn':[0,0,0],'familyValidation':'PASS','geometryContract':'PASS'})
manifest={'task':'P1.E14.T10','base':'634c51d2378748c6a514af2a792ee4500b912643',
          'assets':assets,'cpuOnly':True,'pending':['engine three-light LOD0/LOD2 and wireframe captures','GPU performance','independent code review','blind visual grade','merged smoke']}
out=Path(__file__).with_name('manifest.json')
out.write_text(json.dumps(manifest,indent=2)+'\n')
print(str(out),hashlib.sha256(out.read_bytes()).hexdigest())
