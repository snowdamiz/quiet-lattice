"""Author the shared motion source once. Export never imports or calls this module.

Explicit pose boards below are the editable choreography. Limb targets are solved
to preserve bone lengths and baked into saved ordinary Blender pose keyframes.
CPU only: no mesh authoring, render, bake, browser, or mutation of body sources.
"""
from pathlib import Path
import hashlib
import json
import math
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[5]
SOURCE = ROOT / 'assets/blend/characters/thalune.blend'
OUTPUT = ROOT / 'assets/blend/characters/animations/shared_motion.blend'
SOURCE_SHA = 'd1fc6986ad5fc164279e12a299aa6bc62b499084a6e8afee1b87315832c8d74b'
FPS = 60


def pose(**changes):
    p = dict(hip=(0, 0, -.025), chest=(0, 0, 0), head=(0, 0, 0),
             left=(.26, -.04, .98), right=(-.26, -.04, .98),
             footL=(.1021683, .0313962, .11098225), footR=(-.1021683, .0313962, .11098225),
             wristL=(0, 0, 0), wristR=(0, 0, 0), curlL=.12, curlR=.12,
             pitchL=0, pitchR=0, yaw=0)
    p.update(changes)
    return p


CLIPS = []


def add(name, family, seconds, board, loop=False, contacts=None, direction=None, beats=None):
    assert abs(seconds * FPS - round(seconds * FPS)) < 1e-6
    assert board[0][0] == 0 and board[-1][0] == 1
    CLIPS.append(dict(name=name, family=family, duration=seconds, loop=loop, board=board,
                      contacts=contacts or {}, direction=direction, beats=beats or []))


N = pose()
add('idle_breathe', 'idle', 4, [(0, N), (.28, pose(hip=(.004, 0, -.018), chest=(-2, 0, 1), left=(.27, -.035, .99))),
    (.58, pose(hip=(-.004, 0, -.028), chest=(1, 0, -1), head=(0, -3, 0))), (1, N)], True)
add('idle_alert', 'idle', 3, [(0, pose(left=(.25, -.2, 1.18), right=(-.25, -.22, 1.14))),
    (.25, pose(left=(.24, -.22, 1.18), right=(-.25, -.22, 1.14), head=(0, 0, 28), chest=(0, 0, 5))),
    (.65, pose(left=(.25, -.2, 1.2), right=(-.25, -.22, 1.15), head=(-5, 0, -22), chest=(-2, 0, -4))),
    (1, pose(left=(.25, -.2, 1.18), right=(-.25, -.22, 1.14)))], True)


def gait(name, duration, direction, stride, lift, lean, run=False):
    # Eight authored gait events: contact, recoil, passing, high point, mirrored.
    # Ground contact travels opposite virtual velocity; all world placement is T04's.
    phases = [(0, 1, -1, 0, 0, -.04), (.125, .5, -.6, 0, lift*.62, -.065),
              (.25, 0, 0, 0, lift, -.035), (.375, -.5, .65, 0, lift*.6, -.01),
              (.5, -1, 1, 0, 0, -.04), (.625, -.6, .5, lift*.62, 0, -.065),
              (.75, 0, 0, lift, 0, -.035), (.875, .65, -.5, lift*.6, 0, -.01),
              (1, 1, -1, 0, 0, -.04)]
    dx, dy = direction
    board = []
    for t, l, r, zl, zr, hip in phases:
        hip -= .065 if name=='sprint_forward' else .045 if run else 0
        swing = .12 if run else .07
        board.append((t, pose(hip=(.009*(l-r), 0, hip), chest=(lean, 0, (l-r)*2), head=(-lean*.35, 0, -(l-r)),
            footL=(.1021683+dx*l*stride, .0313962+dy*l*stride, .11098225+zl),
            footR=(-.1021683+dx*r*stride, .0313962+dy*r*stride, .11098225+zr),
            left=(.24, -.05-r*swing, 1.05+abs(r)*.025), right=(-.24, -.05-l*swing, 1.05+abs(l)*.025),
            curlL=.35 if run else .15, curlR=.35 if run else .15)))
    add(name, 'locomotion', duration, board, True,
        {'L': [[0, .5]], 'R': [[.5, 1]]}, [dx, 0, -dy], ['contact L', 'passing R', 'contact R', 'passing L'])


gait('walk_forward', 1.2, (0, -1), .21, .105, 3)
gait('walk_backward', 1.4, (0, 1), .16, .11, -3)
gait('walk_left', 1.4, (1, 0), .14, .12, 0)
gait('walk_right', 1.4, (-1, 0), .14, .12, 0)
gait('run_forward', .8, (0, -1), .3, .22, 10, True)
gait('run_backward', 1, (0, 1), .22, .18, -5, True)
gait('sprint_forward', .6, (0, -1), .36, .29, 17, True)
for side, sign in [('left', 1), ('right', -1)]:
    add('turn_'+side, 'locomotion', .8, [(0, N), (.25, pose(hip=(sign*.02, 0, -.05), yaw=sign*18,
        footL=(.16, -.06, .15), head=(0, 0, sign*12))), (.6, pose(yaw=sign*65, footR=(-.14, .08, .18), chest=(0, 0, sign*8))),
        (1, pose(yaw=sign*90))], beats=['look', 'lead foot', 'plant', 'face new heading'])

CROUCH = pose(hip=(0, .015, -.23), chest=(18, 0, 0), left=(.28, .02, .95), right=(-.28, .02, .95))
AIR = pose(hip=(0, 0, .08), chest=(7, 0, 0), left=(.32, -.13, 1.38), right=(-.32, -.13, 1.38),
           footL=(.12, .18, .4), footR=(-.12, .22, .43))
add('jump_takeoff', 'jump', .5, [(0, N), (.38, CROUCH), (.72, pose(hip=(0, -.01, -.08), chest=(-5,0,0),
    left=(.3,-.23,1.2), right=(-.3,-.23,1.2))), (1, AIR)], beats=['anticipation', 'compression', 'push', 'release'])
add('jump_air', 'jump', .8, [(0, AIR), (.5, pose(hip=(0,0,.06), chest=(12,0,0), left=(.34,-.12,1.34), right=(-.34,-.1,1.36),
    footL=(.12,.24,.44), footR=(-.12,.28,.46))), (1,AIR)], True)
add('jump_land', 'jump', .7, [(0, AIR), (.25, CROUCH), (.56, pose(hip=(0,0,-.11), chest=(10,0,0))), (1,N)], beats=['contact','absorb','recover'])

HOVER = pose(hip=(0,0,.06), chest=(-6,0,0), left=(.36,-.08,1.08), right=(-.36,-.08,1.08),
    footL=(.15,.15,.3), footR=(-.15,.18,.32), pitchL=15, pitchR=12)
JET = pose(hip=(0,0,.08), chest=(22,0,0), head=(-10,0,0), left=(.3,.05,1.12), right=(-.3,.05,1.12),
    footL=(.13,.38,.38), footR=(-.13,.4,.4), pitchL=28, pitchR=28)
add('jet_ignite','jet',.6,[(0,N),(.28,CROUCH),(.65,pose(hip=(0,0,.04),chest=(-12,0,0),left=(.38,0,1.06),right=(-.38,0,1.06))), (1,HOVER)])
add('jet_hover','jet',1.6,[(0,HOVER),(.25,pose(**{**HOVER,'hip':(.015,0,.085),'left':(.39,-.09,1.09),'chest':(-4,0,2)})),
    (.7,pose(**{**HOVER,'hip':(-.012,0,.045),'right':(-.38,-.1,1.1),'chest':(-7,0,-2)})),(1,HOVER)],True)
add('jet_forward','jet',1.2,[(0,JET),(.4,pose(**{**JET,'chest':(25,0,2),'footL':(.13,.36,.42),'left':(.32,.03,1.14)})),
    (.75,pose(**{**JET,'chest':(20,0,-2),'footR':(-.13,.36,.44)})),(1,JET)],True)
add('jet_brake','jet',.7,[(0,JET),(.35,pose(hip=(0,0,.06),chest=(-20,0,0),left=(.42,-.2,1.2),right=(-.42,-.2,1.2),
    footL=(.16,-.2,.26),footR=(-.16,-.2,.26))),(.7,pose(**{**HOVER,'chest':(-12,0,0)})),(1,HOVER)])
add('jet_land','jet',.8,[(0,HOVER),(.28,pose(**{**HOVER,'hip':(0,0,0),'footL':N['footL'],'footR':N['footR']})),(.48,CROUCH),(1,N)])

SWIM = pose(hip=(0,0,.1),chest=(55,0,0),head=(-25,0,0),left=(.35,-.26,1.26),right=(-.35,-.26,1.26),
    footL=(.16,.34,.31),footR=(-.16,.34,.31))
add('swim_idle','swim',2.4,[(0,pose(left=(.42,-.18,1.2),right=(-.42,-.18,1.2),footL=(.18,.1,.3),footR=(-.18,.1,.3))),
    (.5,pose(hip=(0,0,.02),left=(.3,-.29,1.13),right=(-.3,-.29,1.13),footL=(.2,.16,.4),footR=(-.2,.16,.4))),
    (1,pose(left=(.42,-.18,1.2),right=(-.42,-.18,1.2),footL=(.18,.1,.3),footR=(-.18,.1,.3)))],True)
add('swim_forward','swim',1.8,[(0,SWIM),(.2,pose(**{**SWIM,'left':(.18,-.49,1.43),'right':(-.18,-.49,1.43),'footL':(.16,.2,.42)})),
    (.52,pose(**{**SWIM,'left':(.51,-.18,1.22),'right':(-.51,-.18,1.22),'footR':(-.16,.18,.43)})),
    (.8,pose(**{**SWIM,'left':(.27,.08,1.08),'right':(-.27,.08,1.08)})),(1,SWIM)],True)
add('swim_fast','swim',1,[(0,pose(**{**SWIM,'left':(.18,-.49,1.42),'right':(-.3,.02,1.06)})),
    (.25,pose(**{**SWIM,'left':(.48,-.25,1.22),'right':(-.2,-.39,1.4),'footL':(.13,.19,.45)})),
    (.5,pose(**{**SWIM,'left':(.3,.02,1.06),'right':(-.18,-.49,1.42)})),
    (.75,pose(**{**SWIM,'left':(.2,-.39,1.4),'right':(-.48,-.25,1.22),'footR':(-.13,.19,.45)})),
    (1,pose(**{**SWIM,'left':(.18,-.49,1.42),'right':(-.3,.02,1.06)}))],True)
add('swim_dive','swim',1,[(0,SWIM),(.3,pose(**{**SWIM,'chest':(70,0,0),'left':(.18,-.42,1.1),'right':(-.18,-.42,1.1)})),
    (.65,pose(**{**SWIM,'chest':(85,0,0),'head':(-12,0,0),'footL':(.14,.42,.5),'footR':(-.14,.42,.5)})),(1,SWIM)])
add('swim_surface','swim',1.2,[(0,SWIM),(.3,pose(**{**SWIM,'chest':(28,0,0),'head':(-30,0,0),'left':(.28,-.4,1.5),'right':(-.28,-.4,1.5)})),
    (.65,pose(chest=(-10,0,0),head=(-15,0,0),left=(.45,-.16,1.12),right=(-.45,-.16,1.12),footL=(.2,.1,.3),footR=(-.2,.1,.3))),
    (1,pose(left=(.42,-.18,1.2),right=(-.42,-.18,1.2),footL=(.18,.1,.3),footR=(-.18,.1,.3)))])

MINE = pose(hip=(0,0,-.07),chest=(10,0,-8),head=(12,0,6),left=(.12,-.37,1.16),right=(-.13,-.46,1.14),curlL=.65,curlR=.7)
add('mine_start','mine',.7,[(0,N),(.35,pose(left=(.22,-.18,1.08),right=(-.18,-.22,1.16),chest=(5,0,-12))),(.75,pose(**{**MINE,'right':(-.14,-.42,1.2)})),(1,MINE)])
add('mine_loop','mine',1,[(0,MINE),(.2,pose(**{**MINE,'chest':(12,0,-9),'right':(-.12,-.44,1.12),'left':(.12,-.35,1.14)})),
    (.5,pose(**{**MINE,'chest':(8,0,-7),'right':(-.14,-.47,1.18),'left':(.13,-.39,1.18)})),(.8,pose(**{**MINE,'head':(15,0,5)})),(1,MINE)],True)
add('mine_end','mine',.6,[(0,MINE),(.3,pose(left=(.16,-.28,1.12),right=(-.2,-.32,1.1),chest=(5,0,-4))),(.65,pose(left=(.23,-.12,1.04),right=(-.24,-.15,1.06))),(1,N)])

add('cast_gravitic','cast',1.2,[(0,N),(.24,pose(hip=(0,0,-.13),chest=(14,0,0),left=(.32,-.1,1.05),right=(-.32,-.1,1.05),curlL=.8,curlR=.8)),
    (.55,pose(hip=(0,0,-.03),chest=(-9,0,0),left=(.3,-.38,1.48),right=(-.3,-.38,1.48),wristL=(0,0,-35),wristR=(0,0,35))),
    (.72,pose(chest=(-3,0,0),left=(.37,-.43,1.3),right=(-.37,-.43,1.3))),(1,N)],beats=['gather low','lift mass with both palms','release'])
add('cast_thermal','cast',.8,[(0,N),(.25,pose(chest=(3,0,-20),left=(.18,-.14,1.22),right=(-.31,.04,1.3),curlR=.75)),
    (.46,pose(chest=(6,0,16),left=(.19,-.12,1.14),right=(-.08,-.53,1.44),curlR=.2,wristR=(0,0,-20))),
    (.7,pose(chest=(4,0,8),left=(.2,-.12,1.12),right=(-.15,-.47,1.4))),(1,N)],beats=['coil','single arm lance','recoil'])
add('cast_resonance','cast',1.5,[(0,N),(.25,pose(chest=(-4,0,0),head=(-5,0,0),left=(.2,-.26,1.5),right=(-.2,-.26,1.5))),
    (.5,pose(chest=(-8,0,0),left=(.12,-.3,1.6),right=(-.12,-.3,1.6),wristL=(0,0,-35),wristR=(0,0,35))),
    (.66,pose(chest=(5,0,0),left=(.54,-.17,1.4),right=(-.54,-.17,1.4),head=(3,0,0))),(.8,pose(left=(.48,-.1,1.3),right=(-.48,-.1,1.3))),(1,N)],
    beats=['listen at brow','hold resonance','radial open hand pulse'])

for name, chest, hip, hands in [
    ('front',(-16,0,0),(0,.025,-.07),((.29,-.14,1.16),(-.29,-.14,1.16))),
    ('back',(21,0,0),(0,-.025,-.08),((.32,.03,1.02),(-.32,.03,1.02))),
    ('left',(6,-14,-9),(-.03,0,-.08),((.23,-.17,1.26),(-.33,-.08,1.1))),
    ('right',(6,14,9),(.03,0,-.08),((.33,-.08,1.1),(-.23,-.17,1.26)))]:
    add('hit_'+name,'hit',.6,[(0,N),(.16,pose(hip=hip,chest=chest,head=tuple(-x*.5 for x in chest),left=hands[0],right=hands[1])),
        (.4,pose(hip=(hip[0]*.7,hip[1]*.7,-.05),chest=tuple(x*.6 for x in chest),left=hands[0],right=hands[1])),(1,N)])

KNEEL = pose(hip=(0,0,-.4),chest=(12,0,0),head=(24,0,0),left=(.2,-.17,.91),right=(-.2,-.17,.91),
    footL=(.12,-.14,.111),footR=(-.12,.36,.16),pitchR=30)
add('recall_dissolve','recall',1.4,[(0,N),(.18,pose(hip=(0,0,-.08),chest=(13,0,0),head=(18,0,0),left=(.22,-.2,1.14),right=(-.22,-.2,1.14))),
    (.46,pose(hip=(0,0,-.14),chest=(-12,0,0),head=(-20,0,0),left=(.42,-.16,1.38),right=(-.42,-.16,1.38))),
    (.72,pose(hip=(0,0,-.1),chest=(-18,0,0),head=(-26,0,0),left=(.5,-.08,1.43),right=(-.5,-.08,1.43))),
    (1,pose(hip=(0,0,-.1),chest=(-18,0,0),head=(-26,0,0),left=(.5,-.08,1.43),right=(-.5,-.08,1.43)))],
    beats=['glyph ignition','body opens to light','held silhouette for dissolve; VFX external'])
add('recall_reform','recall',2.6,[(0,KNEEL),(.18,KNEEL),(.4,pose(**{**KNEEL,'head':(-8,0,0),'left':(.22,-.23,1.08)})),
    (.65,pose(hip=(0,0,-.22),chest=(18,0,0),left=(.24,-.2,1.07),right=(-.22,-.14,1.04))),(.85,pose(hip=(0,0,-.07),head=(-7,0,0))),(1,N)],
    beats=['wake kneeling at anchor','orient','rise','recover'])

add('emote_wave','emote',2.2,[(0,N),(.2,pose(right=(-.37,-.06,1.71),wristR=(0,0,-15))),
    (.35,pose(right=(-.48,-.03,1.7),wristR=(0,0,18),head=(0,0,-6))),(.5,pose(right=(-.32,-.04,1.73),wristR=(0,0,-18))),
    (.65,pose(right=(-.47,-.03,1.7),wristR=(0,0,18))),(.8,pose(right=(-.35,-.07,1.63))),(1,N)])
add('emote_point','emote',2,[(0,N),(.25,pose(chest=(0,0,10),head=(0,0,12),right=(-.13,-.53,1.44),curlR=.8)),
    (.7,pose(chest=(0,0,10),head=(0,0,12),right=(-.13,-.53,1.44),curlR=.8)),(1,N)])
add('emote_agree','emote',1.4,[(0,N),(.2,pose(head=(16,0,0))),(.38,pose(head=(-4,0,0))),(.57,pose(head=(12,0,0))),(.75,pose(head=(-2,0,0))),(1,N)])
add('emote_disagree','emote',1.6,[(0,N),(.2,pose(head=(0,0,22),left=(.3,-.1,1.06))),(.4,pose(head=(0,0,-22),left=(.33,-.12,1.06))),
    (.6,pose(head=(0,0,17))),(.8,pose(head=(0,0,-12))),(1,N)])
add('emote_celebrate','emote',2.4,[(0,N),(.2,CROUCH),(.4,pose(hip=(0,0,.08),chest=(-10,0,0),left=(.41,-.05,1.78),right=(-.41,-.05,1.78),curlL=.8,curlR=.8)),
    (.58,pose(hip=(.025,0,-.025),chest=(0,0,-10),left=(.4,-.05,1.68),right=(-.42,-.05,1.78),curlL=.8,curlR=.8)),
    (.75,pose(hip=(-.025,0,-.025),chest=(0,0,10),left=(.42,-.05,1.78),right=(-.4,-.05,1.68),curlL=.8,curlR=.8)),(1,N)])
add('emote_rest','emote',3,[(0,N),(.25,pose(hip=(.025,0,-.04),chest=(0,-3,-4),left=(.11,-.25,1.28),right=(-.11,-.3,1.24),head=(4,0,-8))),
    (.72,pose(hip=(.025,0,-.04),chest=(0,-3,-4),left=(.11,-.25,1.28),right=(-.11,-.3,1.24),head=(4,0,8))),(1,N)])


def interpolate(board, t):
    for (a, p), (b, q) in zip(board, board[1:]):
        if a <= t <= b:
            u = (t-a)/(b-a)
            # Smooth key-pose timing, but linear stance travel avoids foot-speed pulses.
            smooth = u*u*(3-2*u)
            out = {}
            for key in p:
                k = u if key.startswith('foot') else smooth
                out[key] = tuple(x+(y-x)*k for x,y in zip(p[key],q[key])) if isinstance(p[key],tuple) else p[key]+(q[key]-p[key])*k
            return out
    return board[-1][1]


def set_global_rotation(rig, name, angles):
    pb = rig.pose.bones[name]
    rotation = Euler(tuple(math.radians(a) for a in angles), 'XYZ').to_quaternion()
    q = rotation @ pb.matrix.to_quaternion()
    pb.matrix = Matrix.LocRotScale(pb.head, q, Vector((1,1,1)))
    bpy.context.view_layer.update()


def aim(rig, name, head, tail, normal, rest_normal):
    pb = rig.pose.bones[name]
    rest = rig.data.bones[name]
    # A pole-defined frame remains continuous when the limb points opposite its
    # bind direction. A shortest-arc quaternion has an ambiguous axis there.
    y=(tail-head).normalized()
    rest_y=(rest.tail_local-rest.head_local).normalized()
    rest_x=rest.matrix_local.to_3x3().col[0]
    x=(normal*rest_x.dot(rest_normal)+y.cross(normal)*rest_x.dot(rest_y.cross(rest_normal))).normalized()
    z=x.cross(y).normalized()
    rotation=Matrix((x,y,z)).transposed().to_quaternion()
    pb.matrix = Matrix.LocRotScale(head, rotation, Vector((1,1,1)))
    bpy.context.view_layer.update()


def limb(rig, upper, lower, end, target, pole):
    a, b = rig.data.bones[upper].length, rig.data.bones[lower].length
    start = rig.pose.bones[upper].head.copy()
    target = Vector(target)
    axis = target-start
    distance = max(.02,min(axis.length, a+b-.001))
    axis.normalize()
    target = start+axis*distance
    side = Vector(pole)-start
    side = (side-axis*side.dot(axis)).normalized()
    along = (a*a-b*b+distance*distance)/(2*distance)
    elbow = start+axis*along+side*math.sqrt(max(0,a*a-along*along))
    normal=axis.cross(side).normalized()
    rest_upper=rig.data.bones[upper]
    rest_lower=rig.data.bones[lower]
    rest_normal=(rest_upper.tail_local-rest_upper.head_local).cross(rest_lower.tail_local-rest_lower.head_local).normalized()
    aim(rig,upper,start,elbow,normal,rest_normal)
    aim(rig,lower,elbow,target,normal,rest_normal)
    pb = rig.pose.bones[end]
    pb.matrix = Matrix.LocRotScale(target,rig.data.bones[end].matrix_local.to_quaternion(),Vector((1,1,1)))
    bpy.context.view_layer.update()


def apply_pose(rig, p, clip_name):
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    rig.pose.bones['pelvis'].location = Vector((p['hip'][0],p['hip'][2],-p['hip'][1]))
    bpy.context.view_layer.update()
    for name,factor in [('spine_01',.25),('spine_02',.35),('spine_03',.4)]:
        set_global_rotation(rig,name,tuple(a*factor for a in p['chest']))
    set_global_rotation(rig,'head',p['head'])
    for side, sign in [('L',1),('R',-1)]:
        limb(rig,'thigh_'+side,'calf_'+side,'foot_'+side,p['foot'+side],(sign*.13,-1,.5))
        set_global_rotation(rig,'foot_'+side,(p['pitch'+side],0,0))
        limb(rig,'upperarm_'+side,'lowerarm_'+side,'hand_'+side,p['left' if side=='L' else 'right'],(sign*.7,.15,1.3))
        set_global_rotation(rig,'hand_'+side,p['wrist'+side])
        for digit in ('index','middle','ring','thumb'):
            for n in range(1,4):
                pb=rig.pose.bones[f'{digit}_{n:02}_{side}']
                curl=p['curl'+side]
                if clip_name=='emote_point' and side=='R' and digit=='index':
                    curl=0
                pb.rotation_quaternion = Quaternion((1,0,0),curl*(.6 if digit=='thumb' else 1))
    if p['yaw']:
        set_global_rotation(rig,'root',(0,0,p['yaw']))
    bpy.context.view_layer.update()


def main():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==SOURCE_SHA
    assert len(CLIPS)==42 and len({c['name'] for c in CLIPS})==42
    refine='--refine-saved' in sys.argv
    if refine:
        bpy.ops.wm.open_mainfile(filepath=str(OUTPUT))
        authored=[]
        for action in bpy.data.actions:
            meta=json.loads(action['motion_metadata'])
            events=json.loads(action['authored_pose_events'])
            meta['board']=[(e['phase'], {k:tuple(v) if isinstance(v,list) else v for k,v in e['pose'].items()}) for e in events]
            authored.append(meta)
        rig=bpy.data.objects['RIG_shared_motion']
    else:
        assert not OUTPUT.exists(), 'Preserve an existing authored source; use --refine-saved to edit its saved pose boards'
        bpy.ops.wm.read_factory_settings(use_empty=True)
        with bpy.data.libraries.load(str(SOURCE),link=False) as (available,loaded):
            loaded.objects=['RIG_thalune','REF_Grid','REF_Biped']
        for obj in loaded.objects:
            if obj:
                bpy.context.scene.collection.objects.link(obj)
        rig=bpy.data.objects['RIG_thalune']
        rig.name='RIG_shared_motion'
        rig.animation_data_clear()
        rig.animation_data_create()
        authored=CLIPS
    scene=bpy.context.scene
    references=bpy.data.collections.get('REF') or bpy.data.collections.new('REF')
    if references.name not in scene.collection.children:
        scene.collection.children.link(references)
    references.hide_render=True
    for name in ('REF_Grid','REF_Biped'):
        obj=bpy.data.objects[name]
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        references.objects.link(obj)
    scene.render.fps=FPS
    scene.render.threads_mode='FIXED'
    scene.render.threads=2
    scene['source_body_blend_sha256']=SOURCE_SHA
    scene['source_profile_id']=json.loads((ROOT/'packages/client/public/models/characters/animations/source-bind.json').read_text())['profile']['id']
    scene['authoring_notes']='42 explicit pose boards, two-link limb solutions baked to ordinary pose keyframes. Export reads saved actions only. In-place locomotion; world travel and VFX external.'
    for c in authored:
        current_name=c['name']
        action=bpy.data.actions[current_name] if refine else bpy.data.actions.new(current_name)
        if refine:
            rig.animation_data.action=None
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for curve in list(bag.fcurves):
                            bag.fcurves.remove(curve)
        action.use_fake_user=True
        action['motion_metadata']=json.dumps({k:v for k,v in c.items() if k!='board'})
        action['source_profile_id']=scene['source_profile_id']
        action['authored_pose_events']=json.dumps([{'phase':t,'pose':p} for t,p in c['board']])
        rig.animation_data.action=action
        frames=round(c['duration']*FPS)
        for frame in range(frames+1):
            apply_pose(rig,interpolate(c['board'],frame/frames),current_name)
            for pb in rig.pose.bones:
                pb.rotation_mode='QUATERNION'
                pb.keyframe_insert('location',frame=frame,group=pb.name)
                pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        for key in fc.keyframe_points:
                            key.interpolation='LINEAR'
        print('AUTHORED',current_name,frames+1,flush=True)
    rig.animation_data.action=None
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
    scene.frame_set(0)
    scene.frame_start=0
    scene.frame_end=240
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT),compress=True)
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==SOURCE_SHA
    print('SAVED_AUTHORED_SOURCE',str(OUTPUT),flush=True)


if __name__=='__main__':
    main()
