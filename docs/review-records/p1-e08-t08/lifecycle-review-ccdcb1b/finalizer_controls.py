import sys,os,json,shutil,hashlib
from pathlib import Path
sys.dont_write_bytecode=True
S=Path(__file__).resolve().parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13');T=R/'packages/tools/blender/e08t08'
sys.path.insert(0,str(T));import stage_lifecycle_test as h
# Finalize the exact original reproduction with the actual old finalizer and pinned historical inputs.
F=S/'original-red';root=F/'lifecycle-root';task=root/'packages/tools/blender/e08t08'
shutil.copyfile(S/'source/base/finalize.py',task/'finalize.py')
for files in json.loads((T/'legacy-stages.json').read_text())['stages'].values():
 for name,digest in files.items():
  assert hashlib.sha256((T/'reports'/name).read_bytes()).hexdigest()==digest
  assert not (task/'reports'/name).exists();shutil.copyfile(T/'reports'/name,task/'reports'/name)
old=h.finalize_fixture(F,root,task,'actual-old-finalizer')
assert old==0 and not (task/'reports/interrupted.json').exists() and (task/'C2-report.txt').exists()
# Check fail-closed consumption on a genuine terminal receipt whose copied bytes are subsequently changed.
F,root,task=h.fixture(S,'terminal-integrity',False)
command=[sys.executable,str(task/'stage.py'),'work',sys.executable,'-c','pass']
assert h.call(F,'success',command,root)==0
receipt=task/'reports/work.json';shutil.copyfile(receipt,F/'authentic-work.json')
r=json.loads(receipt.read_text());r['exit']=7;receipt.write_text(json.dumps(r,indent=2)+'\n')
retry=h.call(F,'retry-corrupt',[sys.executable,str(task/'stage.py'),'retry',sys.executable,'-c','pass'],root)
final=h.call(F,'finalize-corrupt',[sys.executable,str(task/'finalize.py')],root)
assert retry!=0 and final!=0 and not (task/'reports/runs/retry').exists()
result=dict(oldFinalizerExit=old,oldOmittedInterruptedReceipt=True,corruptRetryExit=retry,corruptFinalizerExit=final,authenticTerminalSHA256=hashlib.sha256((F/'authentic-work.json').read_bytes()).hexdigest(),mutatedTerminalSHA256=hashlib.sha256(receipt.read_bytes()).hexdigest(),cleanupRemaining=[])
h.save(S/'finalizer-controls-result.json',result);print(json.dumps(result))
