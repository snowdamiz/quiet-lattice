import ast,bpy,numpy as np
from pathlib import Path
program=ast.parse(Path('packages/tools/blender/characters/refine_ixari_geometry.py').read_text())
exec(compile(ast.Module(body=[n for n in program.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),'<geometry helpers>','exec'))
obj=bpy.data.objects['IX_Body_head1_L0'];mesh=obj.data;points=coords(mesh.vertices)
weight=np.clip(sum(attr(mesh,'p_'+part) for part in ['hand','finger','thumb','foot','toe']),0,1)
points=relax(points,edges(mesh),weight,iterations=48)
mesh.vertices.foreach_set('co',points.astype(np.float32).ravel());mesh.update()
bpy.ops.wm.save_as_mainfile(filepath=str(Path('.claude/pause/characters-resume/ixari5/smooth_probe.blend').resolve()),compress=True)
