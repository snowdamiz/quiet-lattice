"""Fresh resource measurement before each bake/render within a bounded lane."""
import json
import os
from pathlib import Path
import time
from run import resources

def check(label):
    state=resources()
    own=[r for r in state.pop('processes') if r[2]==os.getpgrp()]
    state.update(time=time.time(),stage=label,group_rss_kib=sum(r[3] for r in own))
    with (Path(os.environ['MULE_ATTEMPT'])/'resource-checkpoints.jsonl').open('a') as out:
        out.write(json.dumps(state)+'\n')
    assert state['disk_free']>12*1024**3,'disk reserve before '+label
    assert state['memory_reclaimable']>3*1024**3,'memory reserve before '+label
    assert state['group_rss_kib']<8192*1024,'RSS before '+label
