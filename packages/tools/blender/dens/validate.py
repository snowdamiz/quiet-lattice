"""Den-specific geometry contracts in addition to unchanged family validation.

Checks the real saved/exported meshes, radial planner footprint, origin markers,
fitted collider bounds and the unobstructed standing approach to the spawn.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from artlib import core, rules as R, scene as S

RADII={'den_burrow_0':4,'den_burrow_1':4,'den_nest_0':6,'den_nest_1':6,
       'den_roost_0':5,'den_roost_1':5,'den_apex_lair_0':10}
p=argparse.ArgumentParser()
p.add_argument('--report',type=Path,required=True)
p.add_argument('files',nargs='+')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
reports=[]
for file in a.files:
    path=Path(file); radius=RADII[path.stem]
    rules=R.load()
    report=core.validate_path(rules,path,family='sites')
    assert report.status=='PASS', f'Family validation failed for {file}'
    model=report.model
    variant=model.assets[0].variants[path.stem]
    meshes=S.render_meshes(rules,variant.lods[0])
    if path.suffix=='.blend':
        assert bpy.context.scene.unit_settings.system=='METRIC'
        assert bpy.context.scene.unit_settings.scale_length==1
        paint=bpy.data.objects.get('PaintSource_'+path.stem)
        assert paint and paint.type=='MESH' and paint.data.color_attributes.get('Wear')
        assert paint.library is None and paint.data.library is None and paint.vertex_groups
        assert bpy.data.collections['_PaintSource'].hide_render
        for mesh in meshes:
            assert mesh.library is None and mesh.data.library is None
            assert mesh.vertex_groups and mesh.data.uv_layers
            assert not mesh.data.color_attributes, 'Wear must not multiply the baked base colour twice'
            for material in mesh.data.materials:
                images=[node.image for node in material.node_tree.nodes if node.type=='TEX_IMAGE' and node.image]
                assert images and all(image.packed_file for image in images), (path,material.name,'unpacked atlas')
    verts=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
    radial=max((v.x*v.x+v.y*v.y)**.5 for v in verts)
    assert radial<=radius+.02, (file,radial,radius)
    for name in ('Interact_Spawn','Spawn'):
        marker=bpy.data.objects.get(name)
        assert marker is not None and marker.type=='EMPTY', (file,name)
        assert marker.matrix_world.translation.length<.002, (file,name,'must match existing server anchor at origin')
    colliders=[o for o in bpy.context.scene.objects if o.name.startswith('COL_')]
    assert colliders
    # Quantized GLBs put their decode scale on the mesh node. Build the BVHs in
    # metres so nearest/ray distance limits do not accidentally run past origin.
    trees=[BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],
                               [tuple(p.vertices) for p in o.data.polygons]) for o in meshes]
    collider_bounds=[]
    for o in colliders:
        bb=[o.matrix_world@Vector(c) for c in o.bound_box]
        lo=Vector(tuple(min(v[k] for v in bb) for k in range(3)))
        hi=Vector(tuple(max(v[k] for v in bb) for k in range(3)))
        # The site's current collision route uses these axis-aligned local boxes.
        assert not(lo.x<.38 and hi.x>-.38 and lo.y<.38 and hi.y>-radius and lo.z<1.85 and hi.z>.05), (file,o.name,'blocks spawn approach')
        center=(lo+hi)*.5
        dist=min(t.find_nearest(center)[3] for t in trees)
        assert dist<(hi-lo).length*.65+.05, (file,o.name,'collider detached from its visible shape',dist)
        collider_bounds.append({'name':o.name,'min':list(lo),'max':list(hi)})
    # The visual geometry must leave the same entrance open, not just its boxes.
    for x in (-.38,0,.38):
        for z in (.5,1.05,1.8):
            origin=Vector((x,-radius,z))
            for t in trees:
                hit=t.ray_cast(origin,Vector((0,1,0)),radius)
                assert hit[0] is None, (file,'visual blocks approach',x,z,tuple(hit[0]))
    reports.append({'asset':path.stem,'file':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                    'status':'PASS','radius':radius,'actualRadius':radial,'colliders':collider_bounds,
                    'spawn':[0,0,0],'approach':'clear: 0.76 m wide, 1.85 m high, south to origin'})
a.report.parent.mkdir(parents=True,exist_ok=True)
a.report.write_text(json.dumps(reports,indent=2)+'\n')
print(f'DEN CONTRACT PASS: {len(reports)} files -> {a.report}')
