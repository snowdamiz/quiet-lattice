from pathlib import Path
import sys,subprocess,json,hashlib
out=Path(__file__).parent;root=Path.cwd();reader=out/'reader/packages/tools/src/capture/effects_packet';reader.mkdir(parents=True)
source='4795d01fa0098d0b29310124fdeee06fd5fa4e24';provenance={}
for name in ['evidence.py','contract.py']:
 raw=subprocess.check_output(['git','show',source+':packages/tools/src/capture/effects_packet/'+name]);(reader/name).write_bytes(raw);provenance[name]={'source':source,'sha256':hashlib.sha256(raw).hexdigest()}
sys.path.insert(0,str(reader));import evidence
packet=Path('/private/tmp/egp-164a9dca1cd5400c8f734587e449adeb');snap=evidence.capture_snapshot(packet/'result.json');r=snap['value']
(out/'effects-result-decoded.json').write_text(json.dumps(r,indent=2));(out/'effects-reader-provenance.json').write_text(json.dumps(provenance,indent=2));print('keys',list(r));print('errors',json.dumps(r.get('errors'),indent=2));print('raw keys',list(r.get('raw',{})))
sys.path.insert(0,str(root/'packages/tools/src/capture/trace_observer_packet'));import metadata as m
with m.io_deadline(30):
 preserved={str(packet):m.ledger(packet,count=20000,cap=128*1024**2),'/private/tmp/space-effects-parent-pilot-r2-1of62im8':m.ledger('/private/tmp/space-effects-parent-pilot-r2-1of62im8',count=20000,cap=128*1024**2)}
 (out/'effects-preservation-before.json').write_text(json.dumps(preserved,indent=2));print('original metadata roots',[(p,v['count'],v['bytes']) for p,v in preserved.items()])
