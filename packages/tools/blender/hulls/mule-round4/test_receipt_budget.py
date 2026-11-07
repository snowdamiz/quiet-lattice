"""Exercise actual publication at the one-MiB boundary, including the receipt."""
import argparse
import json
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parent))
import run
out=Path(os.environ['MULE_ATTEMPT'])
results=[]
for label,reserve in [('receipt-crosses-cap',100),('receipt-fits',4096)]:
    root=out/'scratch'/label;root.mkdir()
    run.EVIDENCE=root
    cap=1024**2
    (root/'payload').write_bytes(b'x'*(cap-reserve))
    receipt={'status':'PASS','exit':0,'reason':None,'primary_failure_history':[]}
    run.publish_receipt(root,receipt,argparse.Namespace(evidence_mib=1))
    persisted=json.loads((root/'receipt.json').read_text())
    total=sum(p.stat().st_size for p in root.iterdir())
    assert total==persisted['persisted_evidence_bytes'],persisted
    if label=='receipt-crosses-cap':
        assert persisted['status']=='FAIL' and persisted['receipt_budget_exceeded'] and total>cap
    else:assert persisted['status']=='PASS' and total<=cap
    assert not (root/'receipt.pending.json').exists()
    results.append({'case':label,'cap':cap,'before_receipt':cap-reserve,'receipt_bytes':(root/'receipt.json').stat().st_size,'persisted_bytes':total,'status':persisted['status'],'reason':persisted['reason']})
# Simulate a separate writer racing publication; stale counts must be invalidated.
root=out/'scratch'/'concurrent-change';root.mkdir()
class ChangingEvidence:
    calls=0
    def __fspath__(self):return str(root)
    def rglob(self,pattern):
        self.calls+=1
        if self.calls==2:(root/'late-payload').write_bytes(b'x'*100)
        return root.rglob(pattern)
run.EVIDENCE=ChangingEvidence()
receipt={'status':'FAIL','exit':1,'reason':'original workload failure'}
run.publish_receipt(root,receipt,argparse.Namespace(evidence_mib=1))
persisted=json.loads((root/'receipt.json').read_text())
assert persisted['status']=='FAIL' and persisted['reason']=='original workload failure'
assert persisted['persisted_evidence_bytes'] is None
results.append({'case':'concurrent-change','status':'FAIL','primary_error_preserved':True,'stale_count_invalidated':True})
(out/'receipt-boundary-tests.json').write_text(json.dumps({'status':'PASS','cases':results},indent=2))
print(json.dumps(results,indent=2),flush=True)
