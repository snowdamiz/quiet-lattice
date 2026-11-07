"""Bind partial semantic evidence; never infer a complete plate denominator."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

ap=argparse.ArgumentParser()
ap.add_argument('--receipts',required=True)
ap.add_argument('--author-root',required=True)
ap.add_argument('--output',required=True)
a=ap.parse_args();r=Path(a.receipts)
def read(name):
    p=r/name
    if p.exists():return json.loads(p.read_text())
    return json.load(gzip.open(str(p)+'.gz','rt'))
s=read('source-semantic-facts.json');d=read('decoded.json')
body=json.load(gzip.open(r/'body-mapping.json.gz','rt'))
construction=Path(a.author_root)/'docs/review-records/p1-e12-t02/lark-r3-source-review-8b6c360/revise_r3_fix.py'
evidence=dict(path=str(construction),sha256=hashlib.sha256(construction.read_bytes()).hexdigest(),
              lines='121-184',meaning='Historical removal routine explicitly uses positive pid and plate-flagged corners as authored plate identities. Current saved face attributes provide exact present polygon identities; historical script is not current completeness evidence.')
binding=dict(source_sha256=s['source_sha256'],glb_sha256=d['sha256'],
             source_topology={f"{o['scene']}/{o['object']}":o['topology_sha256'] for o in s['objects']},
             decoded_topology={o['id']:o['topologyHash']for o in d['objects']})
base=next(o for o in s['objects']if o['object']=='Body')
outer=[g for g in base['pid_groups'] if g['pid']>0 and set(g['materials'])<= {'Lark_Hull','Lark_Accent'} and all(abs(x-1)<1e-5 for x in g['plate_vertex_values'])]
plates=[]
for g in outer:
    correspondences=[]
    for o in s['objects']:
        if not o['object'].startswith('Body'):continue
        group=next((x for x in o['pid_groups']if x['pid']==g['pid']),None)
        correspondences.append(dict(scene=o['scene'],object=o['object'],
                                    source_faces_reference=dict(artifact='receipts/source-semantic-facts.json.gz',pid=g['pid'],field='objects[].pid_groups[].polygon_ids'),
                                    source_face_count=len(group['polygon_ids'])if group else 0,
                                    observation='tagged_geometry_present'if group else 'tag_absent; removal vs LOD simplification not established'))
    plates.append(dict(id=f"legacy-pid-{g['pid']}",pid=g['pid'],construction_evidence='legacy_pid_construction_evidence',
                       source_faces=dict(artifact='receipts/source-semantic-facts.json.gz',object='Body',scene='lark_LOD0',pid=g['pid'],field='objects[].pid_groups[].polygon_ids'),source_face_count=len(g['polygon_ids']),source_object='Body',source_scene='lark_LOD0',
                       state='unknown',classification='authored outer plate group in historical construction and current saved attributes; not a certified whole-shell denominator',correspondences=correspondences))
pid0=next(g for g in base['pid_groups']if g['pid']==0)
outer_faces=set(base['material_polygons'].get('Lark_Hull',[])+base['material_polygons'].get('Lark_Accent',[]))
missing=dict(base_pid0_hull_accent_polygons=sorted(outer_faces.intersection(pid0['polygon_ids'])),
             other_positive_pid_groups=[g['pid']for g in base['pid_groups']if g['pid']>0 and g not in outer],
             body_triangle_mappings=[dict(scene=x['scene'],primitive=x['exportPrimitive'],unresolved_triangles=[u['exportTriangle']for u in x['unresolved']])for x in body['rows']if x['unresolved']],
             structural_members='No saved hull member/load-path identities found. All Body pid=0 polygons and all non-Body hits require construction-backed role review; material names cannot supply it.',
             source_polygons_reference='source-semantic-facts.json(.gz): objects[*].pid_groups / material_polygons / topology_sha256',
             all_decoded_triangle_ranges=[dict(primitive=o['id'],object=o['name'],triangle_count=o['triangleCount'],topology_sha256=o['topologyHash']) for o in d['objects']])
inventory=dict(schema=2,binding=binding,denominator_complete=False,legacy_pid_construction_evidence=evidence,plates=plates,structural_members=[],
               decoded_body_mapping=dict(file='receipts/body-mapping.json.gz',exact_triangles=sum(x['exactTriangleMatches']for x in body['rows']),unresolved_triangles=sum(len(x['unresolved'])for x in body['rows']),
                                         schema='rows[].identities: [export triangle, source polygon, pid, method (0 exact triangle, 1 polygon membership)]'),
               missing_identities=missing,
               invalidation='Any source bytes, GLB bytes, object/material membership, vertex/index ordering, transforms, skin influences, or referenced topology hash change invalidates the mapping. Re-run decode and source inspection; do not transfer acceptance.',
               next_source_requests=[
                   'Identify authored seams/plate ancestry for the exact base pid=0 Hull/Accent polygon list; classify whether each region belongs to an existing plate, an added plate, or a non-plate surface.',
                   'Review the 100 other positive pid groups for outer-shell membership; their Dark material is not a structural-frame classification.',
                   'Provide saved polygon groups and load-path roles for actual hull ribs/longerons/backing. Bind them to topology hashes and decode triangle identities before classifying first hits.',
                   'Resolve the listed 4088 Body export triangle mappings and LOD3 loss of pid tags; supply plate-presence/removal correspondence independent of decimator ID survival.',
                   'Specify intended pane seating/overlap and frame cross-section acceptance from construction. Measured unsigned surface distances and the 6 mm construction offset are not a generic gap tolerance.'],
               qualification='UNQUALIFIED')
fields=[]
for key,value in inventory.items():
    formatted='[\n'+',\n'.join('    '+json.dumps(p,separators=(',',':'))for p in value)+'\n  ]'if key=='plates'else json.dumps(value,indent=2).replace('\n','\n  ')
    fields.append('  '+json.dumps(key)+': '+formatted)
Path(a.output).write_text('{\n'+',\n'.join(fields)+'\n}\n')
print(json.dumps(dict(tagged_outer_plate_groups=len(plates),unmapped_base_outer_pid0_polygons=len(missing['base_pid0_hull_accent_polygons']),other_positive_pid_groups=len(missing['other_positive_pid_groups']),status='UNQUALIFIED')))
