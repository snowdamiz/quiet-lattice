import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { EntityState } from '@astra/shared/protocol';
import { SHIP_GEAR_HEIGHT } from '@astra/shared/ships';
import * as world from '@astra/shared/world';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSourceFile, forEachChild, isFunctionDeclaration, isVariableDeclaration, ScriptTarget, transpileModule, type Node } from 'typescript';
import { resolvePlacement } from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/admin/place.ts';
import { planHere } from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/fauna/terrain.ts';
import { MovementAuthority } from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/sim/movement/authority.ts';
import { exitFeet, LARK } from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/sim/movement/testing.ts';
import { describeZoneSystem } from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/zones/system.ts';
const spec = readFileSync(new URL('./symbiotic-online.spec.ts', "file:///Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/tools/src/smoke/symbiotic-visibility.test.ts"), 'utf8');
const ast = createSourceFile('spec.ts', spec, ScriptTarget.Latest, true);
function fixture(name: string, ports: Record<string, unknown> = {}) {
  const fn = ast.statements.find((s) => isFunctionDeclaration(s) && s.name?.text === name);
  if (!fn) throw new Error(`Missing fixture function ${name}`);
  const code = transpileModule(fn.getText(ast), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(ports), `${code};return ${name};`)(...Object.values(ports));
}
function fixtureValue(name: string, ports: Record<string, unknown>) {
  let text: string | undefined;
  const visit = (node: Node) => {
    if (isVariableDeclaration(node) && node.name.getText(ast) === name) text = node.initializer?.getText(ast);
    forEachChild(node, visit);
  };
  visit(ast);
  if (!text) throw new Error(`Missing live value ${name}`);
  const code = transpileModule(`async function value() { return ${text}; }`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(ports), `${code};return value();`)(...Object.values(ports));
}
const selectArena = fixture('selectArena', world);
const captureGround = fixture('captureGround', { ...world, SHIP_GEAR_HEIGHT });
const arena = selectArena(new world.Galaxy(world.GALAXY_SEED).systems.map((s) => world.tierOf(s)));
const ground = captureGround(arena);
const params = (() => {
  const p = world.describeGalaxySystem(new world.Galaxy(world.GALAXY_SEED).systems[arena.system]!).bodies[arena.body]!.params;
  if (p.type === 'gas') throw new Error('Expected rocky arena');
  return p;
})();
const plan = world.drawnGround(params, 1);
const vectorUrl = pathToFileURL(
  createRequire(new URL('../../../client/package.json', "file:///Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/tools/src/smoke/symbiotic-visibility.test.ts"))
    .resolve('three')
    .replace(/three\.cjs$/, 'three.module.js'),
).href;
const THREE = await import(/* @vite-ignore */ vectorUrl);
const { Player } = await import(/* @vite-ignore */ new URL('../../../client/src/entities/Player.js', "file:///Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/tools/src/smoke/symbiotic-visibility.test.ts").href);
const { Body, FrameState } = await import(/* @vite-ignore */ new URL('../../../client/src/universe/Body.js', "file:///Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/tools/src/smoke/symbiotic-visibility.test.ts").href);
const { Input } = await import(/* @vite-ignore */ new URL('../../../client/src/core/Input.js', "file:///Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/tools/src/smoke/symbiotic-visibility.test.ts").href);
const { Fauna } = await import(/* @vite-ignore */ new URL('../../../client/src/gameplay/Fauna.js', "file:///Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/tools/src/smoke/symbiotic-visibility.test.ts").href);
const { RemoteEntities } = await import(/* @vite-ignore */ new URL('../../../client/src/remote/RemoteEntities.js', "file:///Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/tools/src/smoke/symbiotic-visibility.test.ts").href);
const vec = (a: number[]) => new THREE.Vector3().fromArray(a);
const same = fixture('sameCaptureView');
afterEach(() => vi.unstubAllGlobals());
function scene(at = ground.ownerMark, rows = [{ id: 34, species: arena.companion.index, pos: ground.companion }]) {
  const events = new Map<string, ((e: unknown) => void)[]>();
  const listen = (key: string, fn: (e: unknown) => void) => events.set(key, [...(events.get(key) ?? []), fn]);
  const emit = (key: string, event: unknown) => {
    for (const fn of events.get(key) ?? []) fn(event);
  };
  const doc = { pointerLockElement: null as unknown, addEventListener: listen, hasFocus: () => true, querySelector: () => null };
  const realm = { addEventListener: listen };
  vi.stubGlobal('window', realm);
  vi.stubGlobal('document', doc);
  const canvas = {
    requestPointerLock() {
      doc.pointerLockElement = canvas;
      emit('pointerlockchange', {});
    },
  };
  const input = new Input(canvas);
  const planet = new Body({ kind: 'planet', radius: arena.radius });
  Object.assign(planet, {
    params,
    sampler: plan.sampler,
    surfaceRadius: (dir: { x: number; y: number; z: number }) => arena.radius + plan.sampler.height(dir.x, dir.y, dir.z),
  });
  const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.1, 1e7);
  const game = {
    player: new Player({}),
    input,
    cam: new FrameState(),
    camWorld: new THREE.Vector3(),
    camWorldQuat: new THREE.Quaternion(),
    system: { seed: arena.seed, planets: Array.from({ length: arena.body + 1 }, (_, i) => (i === arena.body ? planet : null)) },
    time: 1000,
    mode: 'foot',
    overlay: null,
    engine: { camera, renderer: { info: { render: { frame: 0 } }, getPixelRatio: () => 1 } },
    net: { joined: true, entityId: 1, store: { tick: 100, time: 1000, ack: 20, entities: new Map<number, unknown>() } },
  };
  const fauna = new Fauna(game);
  const remotes = new RemoteEntities(game, { view: { group: new THREE.Group(), draws: () => false, update() {} }, fauna });
  const g = {
    ...game,
    fauna,
    remotes,
    frame() {
      game.player.update(0, input);
      input.endFrame();
      game.player.cameraState(game.cam, game.time);
      game.cam.worldPosition(game.camWorld);
      game.cam.worldQuaternion(game.camWorldQuat);
      camera.position.set(0, 0, 0);
      camera.quaternion.copy(game.camWorldQuat);
      camera.updateMatrixWorld(true);
      remotes.update(0);
      fauna.group.updateMatrixWorld(true);
      game.engine.renderer.info.render.frame++;
    },
  };
  Object.assign(realm, { game: g });
  game.player.spawn(planet, vec(at), vec(ground.east));
  game.player.grounded = true;
  const entities = rows.map((r) => ({
    ...r,
    kind: 'mob',
    frame: arena.frame,
    quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec(r.pos).normalize()).toArray(),
    vel: [0, 0, 0],
    hp: 1,
    owner: 1,
    mode: 'follow',
  }));
  for (const e of entities) game.net.store.entities.set(e.id, e);
  game.net.store.entities.set(1, { id: 1, kind: 'player', frame: arena.frame, mode: 'foot', pos: at, hp: 1 });
  remotes.ingest(new Map(entities.map((e) => [e.id, e])), game.time, game.time, null);
  g.frame();
  let mouse = [0, 0];
  const calls: string[] = [];
  const page = {
    evaluate: async (fn: (...args: unknown[]) => unknown, arg: unknown) => fn(arg),
    mouse: {
      move: async (x: number, y: number) => {
        calls.push('mouse');
        emit('mousemove', { movementX: x - mouse[0]!, movementY: y - mouse[1]! });
        mouse = [x, y];
      },
    },
    keyboard: {
      down: async (code: string) => {
        calls.push(`down:${code}`);
        emit('keydown', { code, preventDefault() {} });
      },
      up: async (code: string) => {
        calls.push(`up:${code}`);
        emit('keyup', { code });
      },
    },
  };
  const acquireInput = async () => {
    calls.push('gesture');
    input.lock();
  };
  const lookAt = fixture('lookAt', { acquireInput });
  const frameSubjects = fixture('frameSubjects', { lookAt, expect });
  return { g, input, page, lookAt, frameSubjects, calls, close: () => fauna.reset() };
}
function view(s: ReturnType<typeof scene>) {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 720);
  return fixture('captureView')(s.page, [1, 34, 35]);
}
async function followControl(fault?: 'idle' | 'stunned' | 'owner' | 'capture') {
  const { newCreature, orientation } = await import('/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/fauna/ai.ts');
  const { companionStep } = await import('/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/fauna/symbiotic.ts');
  const { Ground } = await import('/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/fauna/terrain.ts');
  const s = scene(),
    g = s.g;
  const herd = { id: 1, species: arena.companion, home: ground.companion, level: 2, members: [], apex: false, intrusion: new Map() };
  const c = newCreature({
    id: 34,
    herd,
    species: arena.companion,
    slot: 0,
    scale: 1,
    pos: [ground.companion[0], ground.companion[1], ground.companion[2]],
    heading: ground.east,
    rng: new world.Random(1),
  });
  if (fault === 'stunned') c.stunUntil = Infinity;
  const terrain = new Ground(params, plan.pads);
  let frozen = true,
    captures = 0,
    steps = 0;
  const store = () => {
    g.net.store.entities.set(1, {
      id: 1,
      kind: 'player',
      mode: 'foot',
      frame: arena.frame,
      hp: 1,
      pos: g.player.state.pos.toArray(),
      quat: g.player.state.quat.toArray(),
      vel: g.player.state.vel.toArray(),
    });
    g.net.store.entities.set(34, {
      id: 34,
      kind: 'mob',
      species: 0,
      mode: fault === 'idle' ? 'idle' : c.state,
      frame: arena.frame,
      hp: 1,
      owner: fault === 'owner' ? 2 : 1,
      pos: [...c.pos],
      quat: orientation(c),
      vel: [0, 0, 0],
    });
  };
  store();
  const page = {
    ...s.page,
    waitForTimeout: async (ms: number) => {
      if (frozen) throw new Error('sampled frozen clock');
      const dt = ms / 1000;
      g.player.update(dt, s.input);
      s.input.endFrame();
      g.time += dt;
      steps++;
      const owner = { id: 1, pos: g.player.state.pos.toArray(), onFoot: true, hidden: false, veiled: false, phase: null };
      companionStep(
        c,
        { dt, now: g.time, ground: terrain, rng: new world.Random(2), players: new Map([[1, owner]]), creatures: new Map([[34, c]]) },
        owner.pos,
        undefined,
      );
      g.net.store.tick++;
      store();
      g.remotes.ingest(new Map([[34, g.net.store.entities.get(34)]]), g.time, g.time, null);
      g.frame();
    },
  };
  const active = fixture('activeFollow', {
    online: {
      clock: {
        freeze: async () => {
          frozen = true;
        },
        thaw: async () => {
          frozen = false;
        },
      },
    },
    EntityState,
    expect,
    distance: (a: number[], b: number[]) => vec(a).distanceTo(vec(b)),
    lookAt: s.lookAt,
    until: async (_page: unknown, source: string) => expect(new Function(`return (${source})`)()).toBe(true),
    frameSubjects: s.frameSubjects,
    pixels: async () => {
      captures++;
      if (fault === 'capture') throw new Error('capture rejected');
      const endpoint = await view(s);
      return [{ before: endpoint, after: endpoint }];
    },
  });
  try {
    const result = await active({}, [page], 34, 1, 2, [ground.owner, ground.observer]);
    return { result, steps, captures, frozen };
  } finally {
    expect(s.input.keys.size).toBe(0);
    s.close();
  }
}
import { Zone } from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/src/zones/zone.ts';
import { SnapshotClient } from '/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521/packages/server/test/snapshotClient.ts';

function liveZone(ownerAt:number[], observerAt:number[]) {
  let now=1000;
  const zone=new Zone({id:'source-review',time:now,systemIndex:arena.system,system:describeZoneSystem(arena.system),fauna:{tier:1,spawner:false,grounds:planHere}});
  const clients=[new SnapshotClient(),new SnapshotClient()],events:any[]=[];
  const viewers=clients.map((client,i)=>({id:i+1,sendBinary:(b:Uint8Array)=>{const snap=client.receive(b);zone.ack(viewers[i],snap.tick);},sendText:(m:string)=>{events.push(JSON.parse(m));}}));
  const join=(i:number,pos:number[])=>zone.join(viewers[i],{kind:'player',frame:arena.frame,pos,quat:[0,0,0,1],vel:[0,0,0],mode:'foot'});
  const owner=join(0,ownerAt),observer=join(1,observerAt);
  const step=(dt=.05)=>{now+=dt;zone.step(now);};step();
  const spawn=(species:number,at:number[])=>zone.fauna!.spawnHerd({body:arena.body,species,at,count:1,level:2})!.creatures[0];
  return {zone,clients,viewers,events,owner,observer,step,spawn,get now(){return now;}};
}
it('frozen world time still publishes the real post-Bond ownership snapshot on both CPU clients',()=>{
  const w=liveZone(ground.ownerMark,ground.observerMark),c=w.spawn(0,ground.companion);
  w.step();const tick=w.zone.tick;
  expect(w.zone.fauna!.bond(w.owner,c,()=>true)).toBe(true);
  w.step(0);
  for(const client of w.clients){expect(client.latestTick).toBeGreaterThan(tick);expect(client.latest.get(c)).toMatchObject({owner:w.owner,mode:'follow'});}
});

it('stagnant follow snapshots exhaust exactly 120 samples without freezing or capturing',async()=>{
  let waits=0,freezes=0,captures=0;const keys=new Set();
  const p={id:1,kind:'player',pos:[1,0,0],frame:arena.frame,mode:'foot',hp:1};
  const c={id:34,kind:'mob',pos:[10,0,0],frame:arena.frame,owner:1,mode:'follow',hp:1,species:0};
  vi.stubGlobal('window',{game:{net:{store:{tick:1,entities:new Map([[1,p],[34,c]])}}}});
  const page={evaluate:async(fn:any,arg:any)=>fn(arg),keyboard:{down:async(k:string)=>keys.add(k),up:async(k:string)=>keys.delete(k)},waitForTimeout:async()=>{waits++;}};
  const active=fixture('activeFollow',{online:{clock:{thaw:async()=>{},freeze:async()=>{freezes++;}}},EntityState,expect,distance:(a:number[],b:number[])=>vec(a).distanceTo(vec(b)),lookAt:async()=>{},until:async()=>{},frameSubjects:async()=>{},pixels:async()=>{captures++;return [];}});
  await expect(active({},[page],34,1,2,[])).rejects.toThrow();
  expect({waits,freezes,captures,keys:keys.size}).toEqual({waits:120,freezes:0,captures:0,keys:0});
});

// CPU characterization of the actual hostile/companion/combat producer while the owner's actual walk runs.
// No networking, health seeds, creature-transform writes, native mesh loading or raster output.
it.each([0,0.2,0.5,1])('real hostile combat with %ss post-hit scheduler delay',async(delay)=>{
  const frame=world.cityFrame(arena.city),origin=world.cityPoint(arena.city,frame,arena.radius,-arena.plaza*.65-20,-7,0);
  const toward=vec(ground.east).multiplyScalar(8).addScaledVector(vec(ground.north),3).normalize();
  const cAt=origin.clone().addScaledVector(toward,3).normalize().multiplyScalar(arena.radius+arena.city.base).toArray();
  const s=scene(origin.toArray(),[{id:34,species:0,pos:cAt}]);
  const observerAt=await fixtureValue('observerMark',{a:{page:s.page},ground});
  const w=liveZone(origin.toArray(),observerAt),c=w.spawn(0,cAt);
  expect(w.zone.fauna!.bond(w.owner,c,()=>true)).toBe(true);w.step();
  const sync=()=>{
    s.g.net.store.entities=new Map(w.clients[0].latest);s.g.net.store.tick=w.zone.tick;s.g.time=w.now;s.g.remotes.game.time=w.now;
    s.g.remotes.ingest(new Map([...w.clients[0].latest].filter(([,e])=>e.kind==='mob')),w.now,w.now,null);s.g.frame();
  };sync();
  const eAt=await fixtureValue('enemyAt',{a:{page:s.page},companion:c});
  const enemy=w.spawn(4,eAt);w.step(.05);sync();
  const combatMark=await fixtureValue('combatMark',{a:{page:s.page},ground});
  let hitAt:number|undefined;
  const advance=()=>{
    s.g.player.update(.05,s.input);s.input.endFrame();
    w.zone.patch(w.owner,{pos:s.g.player.state.pos.toArray(),vel:s.g.player.state.vel.toArray()});
    w.step();sync();
    if(w.zone.entity(enemy)!.fields.hp!<1)hitAt??=w.now;
  };
  const until=async(_p:any,source:string,timeout:number)=>{
    for(let ms=0;ms<timeout;ms+=50){advance();if(new Function('return ('+source+')')())return;}
    throw new Error('walk timeout');
  };
  try {
    await fixture('walkTo',{lookAt:s.lookAt,until})(s.page,combatMark);
    for(let i=0;i<400&&hitAt===undefined;i++)advance();
    expect(hitAt).toBeDefined();
    for(let i=0;i<Math.round(delay/.05);i++)advance();
    const rows=[c,enemy].map(id=>({id,species:w.zone.entity(id)!.fields.species!,pos:w.zone.entity(id)!.fields.pos!}));
    const out:any={delay,hitAt,now:w.now,health:w.zone.entity(enemy)!.fields.hp,modes:rows.map(r=>w.zone.entity(r.id)!.fields.mode),views:[]};
    for(const role of ['owner','observer']){
      const viewScene=scene(role==='owner'?s.g.player.state.pos.toArray():observerAt,rows);
      for(const id of [c,enemy])viewScene.g.net.store.entities.set(id,w.clients[0].latest.get(id));
      viewScene.g.remotes.ingest(new Map([c,enemy].map(id=>[id,w.clients[0].latest.get(id)])),w.now,w.now,null);viewScene.g.frame();
      try{const framing=await viewScene.frameSubjects(viewScene.page,[c,enemy],[ground.owner,ground.observer]);out.views.push({role,result:'PASS',bounds:framing.bounds});}
      catch(error){out.views.push({role,result:'REJECT',error:String(error)});}
      finally{viewScene.close();}
    }
    console.log('REAL_COMBAT',JSON.stringify(out));
    expect(out.views.map((v:any)=>v.result)).toEqual(delay<.5?['PASS','PASS']:['REJECT','REJECT']);
  }finally{s.close();}
});

it.each(['none','before','during','camera'])('post-retirement capture interval fault: %s',async(fault)=>{
  const s=scene(ground.observerMark),w=liveZone(ground.ownerMark,ground.observerMark);
  const companion=w.spawn(0,ground.companion),enemy=w.spawn(4,vec(ground.companion).addScaledVector(vec(ground.east),5).toArray());
  expect(w.zone.fauna!.bond(w.owner,companion,()=>true)).toBe(true);
  const owner=w.owner,observer=w.observer;
  const sync=()=>{
    s.g.net.entityId=observer;s.g.net.store.entities=new Map(w.clients[1].latest);s.g.net.store.tick=w.zone.tick;s.g.time=w.now;s.g.remotes.game.time=w.now;
    s.g.remotes.ingest(new Map([...w.clients[1].latest].filter(([,e])=>e.kind==='mob')),w.now,w.now,null);s.g.frame();
  };
  w.step();for(let i=0;i<400&&w.zone.entity(enemy)!.fields.hp===1;i++)w.step();sync();
  expect(w.zone.entity(enemy)!.fields.hp).toBeGreaterThan(0);expect(w.zone.entity(enemy)!.fields.hp).toBeLessThan(1);
  expect(w.events.some(m=>m.t==='event'&&m.event.kind==='combat'&&m.event.source===companion&&m.event.target===enemy&&m.event.amount>0)).toBe(true);
  const release={tick:w.zone.tick};
  const before=await view(s),observerBefore={before,after:before};
  w.zone.leave(w.viewers[0]);w.step();sync();w.step(.2);sync();
  expect(w.clients[1].latest.has(owner)).toBe(false);expect(w.clients[1].latest.has(companion)).toBe(false);
  const captures:any[]=[];
  const die=()=>{w.zone.combat.applyDamage(null,enemy,{base:1e6,kind:'attack'});w.step(0);sync();expect(w.clients[1].latest.get(enemy)?.hp).toBe(0);};
  const page={...s.page,waitForFunction:async(fn:any)=>{expect(fn()).toBe(true);if(fault==='before')die();},screenshot:async()=>{
    if(fault==='during')die();
    if(fault==='camera')await s.lookAt(s.page,ground.owner);
    return Buffer.from('inert dead-target capture port; no pixels');
  }};
  // Actual trailing caller: live retired-state read/assertions, capture, then camera and error assertions.
  const begin=spec.indexOf('    const retired ='),end=spec.indexOf('\n  } finally {',begin);
  const code=transpileModule(spec.slice(begin,end),{compilerOptions:{target:ScriptTarget.ES2022}}).outputText;
  const capture=fixture('capture',{captureView:fixture('captureView'),createHash,expect});
  const ports={b:{page},companion,observer,enemy,owner,release,arena,evidence:{},errors:[],observerBefore,
    EntityState,expect,sameCaptureView:same,capture,online:{serverOutput:()=>''},info:{attach:async(name:any,value:any)=>captures.push({name,...value})}};
  try{
    const run=new Function(...Object.keys(ports),`return (async()=>{${code}})();`);
    let error;try{await run(...Object.values(ports));}catch(e){error=e;}console.log('CALLER_RESULT',JSON.stringify({fault,error:String(error)}));expect(captures.filter(x=>x.contentType==='application/json')).toHaveLength(1);if(fault==='none')expect(error).toBeUndefined();else expect(error).toBeDefined();
  }finally{
    const binding=captures.find(x=>x.contentType==='application/json');
    if(binding){const receipt=JSON.parse(binding.body);console.log('RETIREMENT_CAPTURE',JSON.stringify({fault,hash:receipt.pngSha256,before:{tick:receipt.before.tick,subjects:receipt.before.subjects},after:{tick:receipt.after.tick,subjects:receipt.after.subjects},sameCamera:same(receipt.before,receipt.after)}));}else console.log('RETIREMENT_CAPTURE no binding');s.close();
  }
});
