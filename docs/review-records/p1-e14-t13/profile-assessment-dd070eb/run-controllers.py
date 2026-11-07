from pathlib import Path
import sys,subprocess
out=Path(__file__).parent
for mode in ['before-stat','after-stat','after-open','before-scandir','during-scandir','after-scandir','before-final-fstat','rename-held','close-profile']:
 argv=[sys.executable,'-B',str(out/'run-control.py'),'controller-'+mode,'/usr/bin/env','T13_DELETE_WINDOW='+mode,sys.executable,'-B',str(out/'controller-replay.py'),str(out/('controller-'+mode))]
 p=subprocess.run(argv,timeout=20);assert p.returncode==0,mode
