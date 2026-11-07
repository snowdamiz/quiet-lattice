"""Isolated group leader; no heavy executable until its guardian is registered."""
import json
import os
import select
import sys

fd=int(sys.argv[1])
command=json.loads(sys.argv[2])
ready,_,_=select.select([fd],[],[],15)
token=os.read(fd,16) if ready else b''
os.close(fd)
if token != b'RUN\n':
    raise SystemExit(125)
os.execvpe(command[0],command,os.environ)
