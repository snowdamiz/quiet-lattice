// Quest steps and the cutscene service, wired as server.ts wires them: a cutscene step plays through the service at its
// place and its `play` is pushed to the client unrequested; the service lets a client ask for that cutscene only while
// the step plays it; and the step ends when the client says done (the gateway's path) or when the service ends it (its
// sweep's `ended`). The development server's test-cutscene quest is taken without an offer there, and is unknown elsewhere.
import type { ServerMessage } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import { CUTSCENES } from '../cutscenes/catalog.ts';
import { CutsceneService } from '../cutscenes/service.ts';
import { InventoryService } from '../inventory/service.ts';
import { CharacterProgress } from '../persistence/components.ts';
import { homeSystemOf } from '../world/home.ts';
import { ZoneManager } from '../zones/manager.ts';
import type { ZoneViewer } from '../zones/zone.ts';
import { questCutsceneNotify, questCutscenePermit, questCutscenes } from './cutscenes.ts';
import { QuestRuntime } from './runtime.ts';

type CutsceneState = Extract<ServerMessage, { t: 'cutscene' }>;

class Viewer implements ZoneViewer {
  readonly sent: CutsceneState[] = [];
  constructor(
    readonly id: number,
    readonly characterId: string,
  ) {}
  sendBinary(): void {}
  send(m: CutsceneState): void {
    this.sent.push(m);
  }
}

function world(dev = true) {
  let time = 1000;
  const clock = { now: () => time };
  const zones = new ZoneManager({ clock });
  const inventory = new InventoryService();
  const progress = new CharacterProgress();
  // (each reads the other once both exist, as server.ts builds them)
  const runtime: QuestRuntime = new QuestRuntime({ zones, inventory, progress, clock, cutscenes: questCutscenes(() => service), dev });
  const service: CutsceneService = new CutsceneService({ zones, now: () => time, notify: questCutsceneNotify(() => runtime) });
  service.may = questCutscenePermit(runtime, service.may);
  let n = 0;
  const join = () => {
    const id = `c${++n}`;
    const viewer = new Viewer(n, id);
    const homeSystem = homeSystemOf('thalune');
    zones.join(viewer, { id, name: `Tes ${id}`, people: 'thalune', level: 1, homeSystem });
    inventory.open(id);
    progress.set(id, { level: 1, xp: 0, homeSystem });
    runtime.open({ id, name: `Tes ${id}`, people: 'thalune', homeSystem }, { active: {}, done: {}, flags: [], owed: [], paid: {} });
    runtime.joined(viewer);
    // (one zone tick: the entity's world position, which the service measures the place against)
    zones.runTick(time);
    return { id, viewer };
  };
  return { runtime, service, join, advance: (s: number) => (time += s) };
}

describe('quest cutscenes through the cutscene service', () => {
  it('plays a step’s cutscene unrequested, lets the client ask for it only while on the step, and ends the step on done', () => {
    const w = world();
    const a = w.join();
    expect(w.service.may(a.viewer, 'test', CUTSCENES.test!)).toBe(false);
    const r = w.runtime.request(a.id, 1, { op: 'accept', quest: 'cutscene_test' });
    expect(r.error).toBeUndefined();
    const play = a.viewer.sent.find((m) => m.op === 'play');
    expect(play).toMatchObject({ t: 'cutscene', op: 'play', id: 'test' });
    expect(w.service.playingOf(a.viewer)).toEqual({ id: 'test', phase: play!.phase });
    expect(w.service.may(a.viewer, 'test', CUTSCENES.test!)).toBe(true);
    // the client says done (the gateway's path): the step ends, and with it the quest
    const ended = w.service.handle(a.viewer, { t: 'cutscene', op: 'done', id: 'test' });
    expect(ended).toMatchObject({ op: 'ended', phase: play!.phase });
    w.runtime.cutsceneEnded(a.viewer, 'test');
    expect(w.runtime.stateOf(a.id)!.done.cutscene_test).toMatchObject({ n: 1 });
    expect(w.service.may(a.viewer, 'test', CUTSCENES.test!)).toBe(false);
  });

  it('ends the step when the service ends the cutscene (past its bound), and the client is told', () => {
    const w = world();
    const a = w.join();
    w.runtime.request(a.id, 1, { op: 'accept', quest: 'cutscene_test' });
    w.advance(60);
    w.service.sweep();
    expect(a.viewer.sent.at(-1)).toMatchObject({ op: 'ended', id: 'test' });
    expect(w.runtime.stateOf(a.id)!.done.cutscene_test).toMatchObject({ n: 1 });
  });

  it('keeps the development quest off a production server', () => {
    const w = world(false);
    const a = w.join();
    expect(w.runtime.request(a.id, 1, { op: 'accept', quest: 'cutscene_test' }).error).toBe('unknown_quest');
    expect(w.runtime.offer(a.id, 'cutscene_test')).toBe('unknown_quest');
    expect(a.viewer.sent).toEqual([]);
  });
});
