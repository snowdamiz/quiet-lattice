"""Prepare diagnostic pose geometry without saving source or rendering.
Anthropometric proxy is explicitly not the production actor or a fit certification.
"""
exec(compile((__import__('pathlib').Path(__file__).parent/'objective_evidence.py').read_text(),'objective_evidence.py','exec'))
def beam(name,a,b,r):
 a,b=Vector(a),Vector(b)
 bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=(b-a).length,location=(a+b)/2)
 o=bpy.context.object;o.name=name;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
poses={}
seat=bpy.data.objects['PilotSeat'].matrix_world.translation.copy()
foot=bpy.data.objects['BoardingFoot'].matrix_world.translation.copy()
sill=bpy.data.objects['BoardingSill'].matrix_world.translation.copy()
for name,hip,seated in [('seated',seat,True)]+[(f'boarding_{i}',foot.lerp(sill,i/4)+Vector((0,0,.9)),False) for i in range(5)]:
 pieces=[]
 # Fixed segment lengths; standing total height 1.85 m from sole to crown.
 neck=hip+Vector((0,0,.65));head=hip+Vector((0,0,.80))
 pieces.append(beam(name+'_torso',hip,neck,.19))
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.15,location=head);pieces.append(bpy.context.object)
 for side in (-1,1):
  h=hip+Vector((side*.11,0,0));k=h+Vector((0,.45,0) if seated else (0,0,-.45));ank=k+Vector((0,0,-.45))
  pieces.extend([beam(name+'_thigh',h,k,.085),beam(name+'_shin',k,ank,.065)])
 bpy.context.view_layer.update()
 pts=[o.matrix_world@v.co for o in pieces for v in o.data.vertices]
 poses[name]={'hip':list(hip),'nearest_canopy_vertex_sample_m':min(canopy.find_nearest(p)[3] for p in pts),'warning':'Unsigned surface distance cannot establish containment; boarding pose uses linear marker interpolation and must be checked against actual ladder.'}
 for o in pieces:o.hide_render=True
report['proxy_poses']=poses
report['ground_z_m']=min(p.z for p in points)
report['grid_spacing_m']=1
report['remaining']=['Production rig seated/boarding with collider containment and rung contact','Actual three-livery lineup','Mounted module envelope and articulated geometry samples','Semantic full outerplate denominator and historical loss split','Glyph finish and runtime flicker']
(D/'objective-pose-measurements.json').write_text(json.dumps(report,indent=2))
