import os,sys,json,subprocess,hashlib
from pathlib import Path
E=Path(__file__).resolve().parent;P=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-8301ecc8/packages/tools/src/capture/viewmodel_packet');sys.path.insert(0,str(P));from test_protocol import repository
# Current implementation; exact-base proof is retained separately.
root,repo=repository();repo.grant(0);argv=[sys.executable,'-B',str(E/'growth-child.py'),'--inert-cpu-fixture',str(root),'0','success'];env={**os.environ,'VM_PACKET_UNDER_TEST':str(P)}
p=subprocess.run(argv,env=env,capture_output=True,timeout=90);(E/'sealed-green.stdout').write_bytes(p.stdout);(E/'sealed-green.stderr').write_bytes(p.stderr)
facts=json.loads((root/'growth.json').read_text());facts.update(argv=argv,exit=p.returncode,root=str(root));(E/'sealed-green-measurement.json').write_text(json.dumps(facts,indent=2)+'\n');print(json.dumps(facts));assert p.returncode==0 and facts['journal']['valid'] and not facts['publication']
