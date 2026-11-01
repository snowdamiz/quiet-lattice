// Flora and the server's word on resource nodes (P1.E13.T06): what is drawn and what the beam can reach follow the server's
// state, and the client hides nothing of its own. The cells are made by hand; the scatter itself has golden tests in shared.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createPlanetParams, FLORA_HARVEST } from '@astra/shared/world';
import { FLORA_REMEMBERED, Mining } from '../net/mining.js';
import { Flora } from './Flora.js';

const FRAME = '1:1';

/** A net that only hears the mining module's handlers. */
function fakeNet() {
  const handlers = new Map();
  return {
    joined: true,
    sent: [],
    now: () => 0,
    on: (t, fn) => handlers.set(t, fn),
    send(m) {
      this.sent.push(m);
      return true;
    },
    push(m) {
      handlers.get(m.t)?.(m);
    },
  };
}

const COPPER = { node: 'copper', label: 'Copper', res: 'copper', hp: 6, deposit: true, radius: 300, nearDist: 70, height: 1, hitRadius: 1, lods: [] };
const ROCK = { name: 'rock', label: 'Rock', res: 'ferrite', hp: 1, harvest: 'rock', rock: true, radius: 300, nearDist: 40, height: 1, hitRadius: 1, lods: [] };

function build({ withNet = true } = {}) {
  const net = fakeNet();
  const mining = new Mining(net);
  net.mining = mining;
  const game = { net: withNet ? net : null, system: { seed: 1, planets: [] }, station: {} };
  const flora = new Flora(game);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
  for (const sp of [COPPER, ROCK]) {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 16);
    sp.geo = geo;
    sp.lods = [{ geo, mesh, capacity: 16 }];
  }
  flora.planet = { terrain: { spacingAt: () => 1 }, radius: 1000 };
  flora.frameId = FRAME;
  flora.cellMeters = 64;
  flora.species = [COPPER, ROCK];
  flora.meshRoot = new THREE.Group();
  for (const sp of flora.species) flora.meshRoot.add(sp.lods[0].mesh);
  flora.camLocal.set(0, 1000, 0);
  // two copper deposits (candidates 3 and 4) and two rocks (ids 7 and 8) in cell 2_10_11, a metre or two from the camera
  const at = (n) => [n, 1000, 0, 0, 1, 0, 1, 0];
  const cell = {
    key: '2_10_11',
    ready: true,
    near: false,
    center: new THREE.Vector3(0, 1000, 0),
    data: [
      { species: COPPER, data: new Float32Array([...at(2), ...at(4)]), ids: new Int32Array([3, 4]) },
      { species: ROCK, data: new Float32Array([...at(6), ...at(8)]), ids: new Int32Array([7, 8]) },
    ],
  };
  flora.cellsFar.set(cell.key, cell);
  return { flora, net, mining, cell };
}

const here = new THREE.Vector3(0, 1000, 0);
const near = (flora) => [...flora.instancesNear(here, 50)];
const nodeIds = (flora) => near(flora).filter((i) => i.sp.node).map((i) => i.id);
const rockIds = (flora) => near(flora).filter((i) => i.sp.harvest).map((i) => i.id);
const drawn = (flora) => flora.species.map((sp) => sp.lods[0].mesh.count);

describe('a node the server says is gone', () => {
  it('is not drawn, cannot be reached and does not hold anyone up, until the server says it is back', () => {
    const { flora, net } = build();
    expect(nodeIds(flora)).toEqual([3, 4]);
    net.push({ t: 'nodes', frame: FRAME, cells: [{ cell: '2_10_11', gone: ['copper_3', 'rock_7'], hurt: [] }] });
    expect(nodeIds(flora)).toEqual([4]);
    // (another type's candidate of the same number is another node)
    expect(rockIds(flora)).toEqual([7, 8]);
    flora.rebuild();
    expect(drawn(flora)).toEqual([1, 2]);
    net.push({ t: 'nodes', frame: FRAME, cells: [{ cell: '2_10_11', gone: [], hurt: [] }] });
    expect(nodeIds(flora)).toEqual([3, 4]);
    flora.rebuild();
    expect(drawn(flora)).toEqual([2, 2]);
  });

  it('is gone on its own world only', () => {
    const { flora, net } = build();
    net.push({ t: 'nodes', frame: '1:2', cells: [{ cell: '2_10_11', gone: ['copper_3'], hurt: [] }] });
    expect(nodeIds(flora)).toEqual([3, 4]);
  });

  it('is drawn as hurt as the server says', () => {
    const { flora, net, cell } = build();
    net.push({ t: 'nodes', frame: FRAME, cells: [{ cell: '2_10_11', gone: [], hurt: [['copper_4', 0.5]] }] });
    const server = flora.serverState();
    expect(flora.left(server, cell, 0, COPPER, 3)).toBe(1);
    expect(flora.left(server, cell, 0, COPPER, 4)).toBe(0.5);
  });

  it('can be asked for by its id', () => {
    const { flora } = build();
    const [first] = near(flora);
    expect(flora.mineTarget(first)).toEqual({ node: '2_10_11_copper_3' });
  });
});

describe('the beam on a node', () => {
  it('never hides it: only the server does', () => {
    const { flora, mining } = build();
    const [node] = near(flora);
    for (let i = 0; i < 600; i++) flora.wear(node, 1.6 / 60);
    flora.rebuild();
    expect(nodeIds(flora)).toEqual([3, 4]);
    expect(drawn(flora)).toEqual([2, 2]);
    expect(flora.damage.size).toBe(0);
    expect(mining.cell(FRAME, '2_10_11')).toBeUndefined();
  });

  it('hides it once the server answers that it broke, and shows it again when the cell is as the scatter has it', () => {
    const { flora, net } = build();
    const [node] = near(flora);
    net.mining.beam(1, FRAME, flora.mineTarget(node), node, 1);
    net.push({ t: 'mine', seq: 1, frame: FRAME, node: '2_10_11_copper_3', result: 'depleted', item: 'copper', count: 9, added: 9 });
    expect(nodeIds(flora)).toEqual([4]);
    net.push({ t: 'nodes', frame: FRAME, cells: [{ cell: '2_10_11', gone: [], hurt: [] }] });
    expect(nodeIds(flora)).toEqual([3, 4]);
  });

  it('cannot reach one the server says is gone', () => {
    const { flora, net } = build();
    net.push({ t: 'nodes', frame: FRAME, cells: [{ cell: '2_10_11', gone: ['copper_3', 'copper_4'], hurt: [] }] });
    expect(flora.raycast(new THREE.Vector3(1, 1002, 0), new THREE.Vector3(0, -1, 0), 30)).toBeNull();
  });
});

describe('the plants of the flora', () => {
  it('are worn down by the beam but stay until the server answers that one broke', () => {
    const { flora, net } = build();
    const rock = near(flora).find((i) => i.sp.harvest && i.id === 7);
    for (let i = 0; i < 300; i++) flora.wear(rock, 1.6 / 60);
    flora.rebuild();
    expect(rockIds(flora)).toEqual([7, 8]);
    expect(drawn(flora)[1]).toBe(2);
    expect(flora.mineTarget(rock)).toEqual({ flora: { kind: 'rock', ref: `${FRAME}.${rock.key}`, at: [6, 1000, 0] } });
    net.mining.beam(1, FRAME, flora.mineTarget(rock), rock, 1);
    net.push({ t: 'mine', seq: 1, frame: FRAME, flora: `${FRAME}.${rock.key}`, result: 'depleted', item: 'ferrite', count: 6, added: 6 });
    flora.broke(rock);
    flora.rebuild();
    expect(rockIds(flora)).toEqual([8]);
    expect(drawn(flora)[1]).toBe(1);
    expect(flora.damage.size).toBe(0);
  });

  it('are all drawn with no connection to the server, and none of them can be asked for', () => {
    const { flora } = build({ withNet: false });
    const rock = near(flora).find((i) => i.sp.harvest);
    for (let i = 0; i < 600; i++) flora.wear(rock, 1.6 / 60);
    flora.rebuild();
    expect(rockIds(flora)).toEqual([7, 8]);
    expect(flora.serverState()).toBeNull();
  });

  it('come back with the next session, though the server goes on refusing them for an hour', () => {
    const { flora, net } = build();
    const rock = near(flora).find((i) => i.sp.harvest && i.id === 7);
    net.push({ t: 'mine', seq: 1, frame: FRAME, flora: flora.floraRef(rock.key), result: 'depleted', item: 'ferrite', count: 6, added: 6 });
    expect(rockIds(flora)).toEqual([8]);
    net.push({ t: 'welcome' });
    expect(rockIds(flora)).toEqual([7, 8]);
  });

  it('are named with their world, so the same key on another world is another plant', () => {
    const { flora, net } = build();
    const rock = near(flora).find((i) => i.sp.harvest && i.id === 7);
    net.push({ t: 'mine', seq: 1, frame: FRAME, flora: flora.floraRef(rock.key), result: 'depleted', item: 'ferrite', count: 6, added: 6 });
    expect(rockIds(flora)).toEqual([8]);
    flora.frameId = '1:2';
    expect(rockIds(flora)).toEqual([7, 8]);
    expect(flora.mineTarget(rock).flora.ref).toBe(`1:2.${rock.key}`);
    net.mining.beam(1, '1:2', flora.mineTarget(rock), rock, 1);
    expect(net.sent.at(-1).flora.ref).toBe(`1:2.${rock.key}`);
    flora.frameId = FRAME;
    expect(rockIds(flora)).toEqual([8]);
  });

  it('are let go of together across worlds when the server\'s one list of broken plants is full', () => {
    const { flora, net, mining } = build();
    const rock = near(flora).find((i) => i.sp.harvest && i.id === 7);
    const first = flora.floraRef(rock.key);
    net.push({ t: 'mine', seq: 1, frame: FRAME, flora: first, result: 'depleted', item: 'ferrite', count: 6, added: 6 });
    for (let i = 0; i < FLORA_REMEMBERED - 1; i++) {
      net.push({ t: 'mine', seq: i + 2, frame: i % 2 ? FRAME : '1:2', flora: `${i % 2 ? FRAME : '1:2'}.other_${i}`, result: 'depleted', item: 'carbon', count: 1, added: 1 });
    }
    expect(mining.broken.size).toBe(FLORA_REMEMBERED);
    expect(rockIds(flora)).toEqual([8]);
    net.push({ t: 'mine', seq: 999, frame: '1:2', flora: '1:2.last', result: 'depleted', item: 'carbon', count: 1, added: 1 });
    expect(mining.broken.size).toBe(FLORA_REMEMBERED);
    expect(rockIds(flora)).toEqual([7, 8]);
  });

  it('wear is kept per world, and dropped when the player leaves for another', () => {
    const { flora } = build();
    const rock = near(flora).find((i) => i.sp.harvest && i.id === 7);
    flora.wear(rock, 0.5);
    expect([...flora.damage.keys()]).toEqual([`${FRAME}.${rock.key}`]);
    flora.frameId = '1:2';
    expect(flora.left(null, { key: '2_10_11' }, 1, rock.sp, 7)).toBe(1);
    flora.frameId = FRAME;
    flora.planet = { sampler: null };
    flora.setPlanet({ sampler: null });
    expect(flora.damage.size).toBe(0);
  });
});

describe('clearing ground for a landed ship', () => {
  it('leaves plants and rocks off the cell but not the nodes', () => {
    const { flora, cell } = build();
    flora.clearCell(cell, [{ pos: new THREE.Vector3(6, 1000, 0), r: 1.5 }, { pos: new THREE.Vector3(2, 1000, 0), r: 1.5 }]);
    expect(rockIds(flora)).toEqual([8]);
    expect(nodeIds(flora)).toEqual([3, 4]);
    expect(cell.data[1].data.length).toBe(8);
    expect(cell.data[1].ids.length).toBe(1);
  });
});

describe('the species of a world', () => {
  it('take what a plant is worth from the shared table, and carry no yield of their own', () => {
    const flora = new Flora({ system: { seed: 1, planets: [] }, station: {}, pool: { cancel() {} } });
    flora.tier = 0;
    flora.buildSpecies({ params: createPlanetParams(77, 'lush', 6000) });
    const plants = flora.species.filter((sp) => sp.harvest);
    expect(plants.length).toBeGreaterThan(2);
    for (const sp of plants) {
      expect(sp.hp, sp.name).toBe(FLORA_HARVEST[sp.harvest].hp);
      expect(sp.res, sp.name).toBe(FLORA_HARVEST[sp.harvest].resource);
    }
    for (const sp of flora.species) expect(sp.yield, sp.name).toBeUndefined();
  });
});
