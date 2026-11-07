from pathlib import Path
import json,subprocess,os
O=Path(__file__).parent;R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-11167406');A=R/'packages/tools/blender/characters/animations/thalune-run-candidate';G=O/'green-final';G.mkdir();s=(O/'red/additional.py').read_text()
start=s.index(" if mode=='entry-type':\n");end=s.index("# A partial enumeration",start)
s=s[:start]+''' assert result['status']=='HOLD'
 if mode=='entry-type':
  assert not events, 'The permissive is_dir boundary must not be used'
  assert result['outputInventory']['complete'] is True
  assert str(extra.relative_to(p/'packet')) in result['outputInventory']['paths']
  assert result['outputBytes']>=extra.stat().st_size
  assert result['terminalDelivery']['proof']['status']=='written'
  assert result['terminalDelivery']['packet']['status']=='written'
  assert json.loads((p/'proof/result.json').read_text())['status']=='HOLD'
  assert json.loads((p/'packet/integration-result.json').read_text())['status']=='HOLD'
 save(dict(name='packet-'+mode,status='PASS',injection=events,result=result,hiddenBytes=extra.stat().st_size,nativeProcesses=0))
'''+s[end:]
s=s.replace('one classification-error defect manifestation','all safe/refusal expectations');(G/'additional.py').write_text(s)
ready=json.loads((A/'readiness.json').read_text());argv=[ready['rgbPrimary']['python'],'-B',str(G/'additional.py')];r=subprocess.run(argv,cwd=R,env={**os.environ,'PATH':ready['pathEnvironment'],'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=60)
(G/'additional.stdout').write_text(r.stdout);(G/'additional.stderr').write_text(r.stderr);(O/'green-final-command.json').write_text(json.dumps(dict(argv=argv,cwd=str(R),exitCode=r.returncode),indent=2)+'\n');print(r.returncode,r.stdout);assert r.returncode==0,r.stderr
