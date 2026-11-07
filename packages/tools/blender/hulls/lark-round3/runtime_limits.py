"""Keep stock codec work at one process; no encoding/decoding algorithm changes."""
from concurrent.futures import ThreadPoolExecutor

class SingleCodecPool(ThreadPoolExecutor):
    def __init__(self,max_workers=None,**kwargs):
        super().__init__(max_workers=1,**kwargs)

def configure(ktx):
    # Stock decoded_copy deliberately uses max(2, jobs()); constrain this task's
    # executor as well as setting ART_KTX_JOBS=1 for compression.
    ktx.ThreadPoolExecutor=SingleCodecPool
    original=ktx.encode_args
    ktx.encode_args=lambda tool,src,dst,codec,srgb,normal,channels,settings,threads: original(tool,src,dst,codec,srgb,normal,channels,settings,2)
