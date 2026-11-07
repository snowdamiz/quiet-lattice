"""R2 review: exact production and stock callers, isolated CPU dependency fixtures."""
import importlib.util, pathlib, sys, tempfile
ROOT=pathlib.Path('/private/tmp/t08-r2-source-25d38590-x6AaWJ')
REPO=pathlib.Path('/Users/andreyyurlov/.t3/worktrees/space/t3-8895fab5')
source=REPO/'packages/tools/blender/t08/revision_r1/test_lifecycle.py'
spec=importlib.util.spec_from_file_location('retained_harness',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=tempfile.mkdtemp
def scoped_temp(*args,**kwargs):
 if kwargs.get('dir')=='/tmp':kwargs['dir']=str(ROOT)
 return original(*args,**kwargs)
tempfile.mkdtemp=scoped_temp
class ReviewHarness(m.Harness):
 def prepare(self,*args,**kwargs):
  result=super().prepare(*args,**kwargs)
  root=result[0]
  with (root/'cpu_dependencies/sitecustomize.py').open('a') as f:
   f.write('\n# Review-only scratch routing; production bytes remain exact.\nimport tempfile\n_t08_mkdtemp=tempfile.mkdtemp\ndef _r2_temp(*args,**kwargs):\n if kwargs.get("dir")=="/tmp": kwargs["dir"]=str(root)\n return _t08_mkdtemp(*args,**kwargs)\ntempfile.mkdtemp=_r2_temp\n')
  return result
m.Harness=ReviewHarness
sys.exit(m.main())
