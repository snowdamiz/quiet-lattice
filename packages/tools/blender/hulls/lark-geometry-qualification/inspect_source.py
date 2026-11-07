"""Read-only saved Blender geometry facts; no evaluation, repair, save or render."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from collections import defaultdict
import bpy

ap = argparse.ArgumentParser()
ap.add_argument('--source', required=True)
ap.add_argument('--sha256', required=True)
ap.add_argument('--output', required=True)
a = ap.parse_args(sys.argv[sys.argv.index('--')+1:])
source = Path(a.source)
def digest(data):
    return hashlib.sha256(json.dumps(data, separators=(',', ':')).encode()).hexdigest()
def file_hash():
    with source.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()
assert file_hash() == a.sha256
bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
rows = []
for variant in ('lark', 'lark_damaged', 'lark_husked'):
    for lod in range(4):
        collection = bpy.data.collections[f'{variant}_LOD{lod}']
        for obj in collection.all_objects:
            if obj.type != 'MESH': continue
            mesh = obj.data
            mesh.calc_loop_triangles()
            verts = [list(v.co) for v in mesh.vertices]
            faces = [list(p.vertices) for p in mesh.polygons]
            world = [list(obj.matrix_world @ v.co) for v in mesh.vertices]
            matrix = [list(r) for r in obj.matrix_world]
            materials = [m.name if m else None for m in mesh.materials]
            face_materials = [p.material_index for p in mesh.polygons]
            groups = defaultdict(list)
            for p in mesh.polygons:
                groups[materials[p.material_index]].append(p.index)
            parent = list(range(len(verts)))
            def find(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]
                    i = parent[i]
                return i
            for f in faces:
                for v in f[1:]: parent[find(v)] = find(f[0])
            components = defaultdict(list)
            for i, f in enumerate(faces): components[find(f[0])].append(i)
            attrs = []
            for attr in mesh.attributes:
                entry = dict(name=attr.name, domain=attr.domain, data_type=attr.data_type,
                             length=len(attr.data))
                if attr.domain == 'FACE' and attr.data_type in ('INT', 'BOOLEAN', 'FLOAT'):
                    values = [v.value for v in attr.data]
                    entry['values_sha256'] = digest(values)
                    entry['unique'] = sorted(set(values))[:100]
                    if attr.data_type == 'INT' and not attr.name.startswith('.'):
                        entry['values'] = values
                attrs.append(entry)
            props = {k:repr(obj[k]) for k in obj.keys()}
            row = dict(scene=collection.name, object=obj.name, mesh=mesh.name,
                       parent=obj.parent.name if obj.parent else None, matrix_world=matrix,
                       vertices=len(verts), polygons=len(faces), triangles=len(mesh.loop_triangles),
                       topology_sha256=digest(dict(vertices=verts,faces=faces,materials=face_materials,
                                                   slots=materials,world=matrix)),
                       modifiers=[dict(name=m.name,type=m.type,show_render=m.show_render) for m in obj.modifiers],
                       properties=props,mesh_properties={k:repr(mesh[k]) for k in mesh.keys()},
                       face_attributes=attrs,vertex_groups=[v.name for v in obj.vertex_groups],
                       material_polygons=dict(groups),
                       components=[dict(candidate_only=True,polygon_ids=v) for v in components.values()])
            if obj.name.startswith(('CanopyGlass', 'CanopyFrame')):
                row.update(local_vertices=verts,world_vertices=world,faces=faces,
                           triangles_to_polygons=[dict(vertices=list(t.vertices),polygon=t.polygon_index)
                                                  for t in mesh.loop_triangles])
            if obj.name.startswith('Body'):
                pid = mesh.attributes.get('pid')
                plate = mesh.attributes.get('plate')
                row['pid_groups'] = []
                if pid:
                    by_pid = defaultdict(list)
                    for p in mesh.polygons: by_pid[int(pid.data[p.index].value)].append(p.index)
                    for identity, ids in sorted(by_pid.items()):
                        vi = sorted({v for i in ids for v in faces[i]})
                        flags = sorted({plate.data[v].value for v in vi}) if plate else []
                        row['pid_groups'].append(dict(pid=identity,polygon_ids=ids,
                            materials=sorted({materials[face_materials[i]] for i in ids}),
                            plate_vertex_values=flags, bounds_min=[min(world[v][k] for v in vi) for k in range(3)],
                            bounds_max=[max(world[v][k] for v in vi) for k in range(3)]))
            rows.append(row)
assert file_hash() == a.sha256
result = dict(source_sha256=a.sha256, blender=bpy.app.version_string,
              unit_settings=dict(system=bpy.context.scene.unit_settings.system,
                                 scale_length=bpy.context.scene.unit_settings.scale_length),
              objects=rows, saved_construction_texts=[dict(name=t.name,sha256=hashlib.sha256(t.as_string().encode()).hexdigest(),text=t.as_string()) for t in bpy.data.texts],
              no_save_export_render=True,
              meaning='Current saved source polygon identities and connectivity. Components/material groups are not semantic plates or structural members.')
Path(a.output).write_text(json.dumps(result, separators=(',', ':'))+'\n')
print(json.dumps(dict(objects=len(rows),canopy_objects=sum(o['object'].startswith('Canopy') for o in rows),
                     modifiers=[(o['object'],o['modifiers']) for o in rows if o['modifiers']])))
