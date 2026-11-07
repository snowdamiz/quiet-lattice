import sys,time,json
from pathlib import Path
sys.dont_write_bytecode=True
script=Path(sys.argv[1]);F=Path(sys.argv[2]);sys.path.insert(0,str(script.parent))
import stage,stage_processes
original_snapshot=stage_processes.snapshot; original_drain=stage.drain
phase={'drain':False,'injected':False,'owned':None}
def drain(owned,record):
 phase.update(drain=True,owned=owned)
 return original_drain(owned,record)
def snapshot():
 rows=original_snapshot()
 if phase['drain'] and not phase['injected']:
  phase['injected']=True
  (F/'real-pre-fork-snapshot.json').write_text(json.dumps(rows,indent=2))
  (F/'fork-now').touch()
  end=time.monotonic()+4
  while not (F/'leaf.json').exists() or not phase['owned'].leader_exited():
   if time.monotonic()>end:raise TimeoutError('leader exit and real leaf startup')
   time.sleep(.005)
 # Returns the actual OS snapshot, unchanged; barrier realizes a scheduling gap.
 return rows
stage.drain=drain;stage_processes.snapshot=snapshot
sys.exit(stage.main(['work',*sys.argv[3:]]))
