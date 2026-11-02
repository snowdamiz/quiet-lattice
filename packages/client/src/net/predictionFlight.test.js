// Drive the shipped controller and reconciliation handlers through a delayed link without a renderer or database.
import { decodeClientMessage, encodeServerMessage, encodeSnapshot } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { Harness, noseTo, pose } from '../../../server/src/sim/movement/testing.ts';
import { describeZoneSystem } from '../../../server/src/zones/system.ts';
import { Game } from '../Game.js';
import { Ship } from '../entities/Ship.js';
import { Net } from './Net.js';
import { MATCH_M, Prediction } from './prediction.js';

describe('Prediction with the flight controller and movement authority', () => {
  it.each(['before', 'after'])('settles delayed pulse corrections delivered %s the flight frame without a correction loop', (delivery) => {
    const start = 100;
    const dt = 1 / 60;
    const lag = 0.8;
    const quat = noseTo([1, 0, 0]);
    const initial = pose(null, [500, 2e9, 0], [20000, 0, 0], quat);
    const h = new Harness(describeZoneSystem(0), { pose: initial, mode: 'pulse' }, {}, { now: start });
    const prediction = new Prediction((id) => (id === null ? null : undefined));
    let now = start;
    let tick = 0;
    let accepted = 0;
    let kicked = false;
    let authority = { ...initial, mode: 'pulse' };
    const inputs = [];
    const outputs = [];
    const corrections = [];
    const net = new Net({ url: '', token: '', characterId: '', now: () => now * 1000 });
    net.state = 'joined';
    net.entityId = h.id;
    net.zone = { id: 'test', systemSeed: h.d.seed };
    // Keep the normal input encoder and sender: the stand-in socket only transports its bytes.
    net.ws = {
      readyState: 1,
      send(text) {
        const msg = decodeClientMessage(text);
        if (msg?.t === 'input') inputs.push({ at: now + lag, msg });
      },
    };
    const input = { mouseDX: 0, mouseDY: 0, down: (key) => key === 'ShiftLeft', hit: () => false, mouse: () => false };
    const game = Object.assign(Object.create(Game.prototype), {
      mode: 'ship', system: { seed: h.d.seed, planets: [] }, station: {}, universe: { networkFrame: () => null },
      net, input, time: now, prediction, cam: {},
    });
    const ship = game.ship = new Ship(game);
    const state = ship.state;
    state.quat.fromArray(quat);
    // The client has left pulse, but authority still holds pulse and an older pose 3 km away.
    state.pos.set(500, 2e9 + 3000, 0);
    state.vel.set(100, 0, 0);
    ship.speed = 100;
    net.input = () => game.inputSample();
    net.on('input', (msg) => prediction.record(msg));
    net.on('correction', (msg) => {
      corrections.push({ seq: msg.seq, fence: prediction.fence, mode: msg.mode });
      game.onCorrection(msg);
    });
    net.on('snapshot', () => game.checkPrediction());
    const deliver = () => {
      while (outputs.length && outputs[0].at <= now + 1e-8) net.received(outputs.shift().bytes);
    };
    try {
      for (let frame = 1; frame <= 60 * 30; frame++) {
        now = start + frame * dt;
        game.time = now;
        if (delivery === 'before') deliver();
        ship.blend.step(dt, state.frame);
        ship.updateFlight(dt, input, true);
        state.pos.addScaledVector(state.vel, dt);
        if (frame % 3 === 0) net.sendInput(now * 1000);
        while (inputs.length && inputs[0].at <= now + 1e-8) {
          const { at, msg } = inputs.shift();
          const verdict = h.send(msg.pose, msg.mode, { dt: at - h.now, at: msg.time, buttons: msg.buttons });
          if (verdict.ok) {
            accepted++;
            authority = { ...msg.pose, vel: verdict.vel, mode: verdict.mode };
          } else if (verdict.correction) {
            authority = { ...verdict.correction.pose, mode: verdict.correction.mode };
            outputs.push({ at: at + lag, bytes: encodeServerMessage({ t: 'correction', ...verdict.correction }) });
            kicked ||= verdict.kick;
          }
          outputs.push({
            at: at + lag,
            bytes: encodeSnapshot({ tick: ++tick, time: at, ack: msg.seq, full: true, entities: [{ id: h.id, kind: 'player', ...authority }], removed: [] }),
          });
        }
        if (kicked) break;
        if (delivery === 'after') deliver();
      }
      expect(kicked).toBe(false);
      // Both corrections were already on their way when the first corrected input reached authority.
      expect(corrections).toHaveLength(2);
      expect(corrections[1].seq).toBeLessThan(corrections[1].fence);
      expect(corrections.map((c) => c.mode)).toEqual(['pulse', 'pulse']);
      expect(accepted).toBeGreaterThan(500);
      expect(prediction.stats.compared).toBeGreaterThan(500);
      expect(prediction.stats.maxError).toBeLessThan(MATCH_M);
      expect(prediction.stats.unheard).toBe(0);
      expect(net.stats).toEqual({ dropped: 0, unsendable: 0, rejectedTicks: 0, unappliedTicks: 0 });
    } finally {
      net.cancelAck();
    }
  });
});
