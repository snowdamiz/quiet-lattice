"""Run the immutable review guard with an explicit inert disk-capacity port."""
import json,os,runpy,shutil,sys
from collections import namedtuple
from pathlib import Path
sys.dont_write_bytecode=True
guard=Path(sys.argv[1]);label=sys.argv[2];calls=[]
sys.path.insert(0,str(Path(sys.argv[3]).resolve().parent))
Usage=namedtuple('Usage','total used free')
def capacity(path):
    calls.append(str(path));return Usage(22066626560,0,22066626560)
def forbidden(*args,**kwargs):raise AssertionError('Live capacity observation forbidden in this unit')
shutil.disk_usage=capacity;os.statvfs=forbidden
sys.argv=sys.argv[1:]
try:runpy.run_path(str(guard),run_name='__main__')
finally:
    with (guard.parent/(label+'.capacity-port.json')).open('x') as f:
        json.dump(dict(currentCapacityAdmission=False,liveCapacityObservations=0,port='inert fixed fixture',calls=calls),f,indent=2)
