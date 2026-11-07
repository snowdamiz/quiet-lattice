"""Run the shared validator on the actual compressed GLB and bind both CPU gates to exact bytes."""
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(Path(__file__).resolve().parent));sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core,rules
from asset_contract import sha,read_inventory

SRC=ROOT/'assets/blend/hulls/kestrel.blend';GLB=ROOT/'packages/client/public/models/hulls/kestrel.glb';OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'


def main():
    receipt=OUT/'qualification.json';receipt.unlink(missing_ok=True)
    source_hash,export_hash=sha(SRC),sha(GLB)
    source=json.loads((OUT/'source-contracts.json').read_text())
    assert source['status']=='PASS' and source['sourceSha256']==source_hash,'source receipt is stale'
    collision=json.loads((OUT/'collision-probe.json').read_text())
    assert collision['sourceSha256']==source_hash and not collision['boardingBodyHits'],'collision evidence is stale or boarding body rays are blocked'
    report=core.validate_path(rules.load(),GLB,family='hulls',source=SRC)
    core.write_and_print(report,OUT/'export-five-gates.json',quiet=True)
    assert report.status=='PASS',report.failures()
    inventory=read_inventory(GLB);inventory.update(sha256=export_hash,bytes=GLB.stat().st_size)
    (OUT/'glb-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
    assert sha(SRC)==source_hash and sha(GLB)==export_hash,'asset changed during qualification'
    result={'status':'PASS','scope':'CPU source/export and static compressed-asset contracts only','source':{'path':str(SRC.relative_to(ROOT)),'sha256':source_hash,'bytes':SRC.stat().st_size},'export':{'path':str(GLB.relative_to(ROOT)),'sha256':export_hash,'bytes':GLB.stat().st_size},'variants':len(inventory['variants']),'staticPrimitivesByVariant':{v:{n:l['primitiveCount'] for n,l in d['lods'].items()} for v,d in inventory['variants'].items()},'GPUTextureBudgetBytes':512*1024*1024,'mapBytesAt8bppWithMipsByVariant':{v:d['gpuTextureBytesAt8bppWithMips'] for v,d in inventory['variants'].items()},'reports':{n:sha(OUT/n) for n in ('source-five-gates.json','source-contracts.json','export-five-gates.json','glb-inventory.json')},'pending':['parent fresh source/code review','third blind visual grade for Kestrel only','runtime GPU draw counts','three-case engine captures','paired runtime CPU/GPU timing','gameplay boarding/collision/animation integration']}
    result['reports']['collision-probe.json']=sha(OUT/'collision-probe.json')
    receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))


if __name__=='__main__':main()
