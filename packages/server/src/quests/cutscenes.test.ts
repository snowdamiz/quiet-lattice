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
import { emptyQuestLog, getQuest, questDefSchema, type QuestDef, type QuestLog } from '@astra/shared/quests';
import { doneEndsQuestStep, questCutsceneNotify, questCutscenePermit, questCutscenes } from './cutscenes.ts';
import { CUTSCENE_RETRY_S, QuestRuntime } from './runtime.ts';

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

function quest(id: string, steps: unknown[]): QuestDef {
  return questDefSchema.parse({ id, title: id, category: 'board', giver: 'board:test', prerequisites: {}, steps, rewards: {}, flags: [], repeat: 'once' });
}

function world(dev = true, extra: QuestDef[] = []) {
  let time = 1000;
  const clock = { now: () => time };
  const zones = new ZoneManager({ clock });
  const inventory = new InventoryService();
  const progress = new CharacterProgress();
  const defs = new Map(extra.map((d) => [d.id, d]));
  const catalog = (id: string) => defs.get(id) ?? getQuest(id);
  // (each reads the other once both exist, as server.ts builds them)
  const runtime: QuestRuntime = new QuestRuntime({ zones, inventory, progress, clock, catalog, cutscenes: questCutscenes(() => service), dev });
  const service: CutsceneService = new CutsceneService({ zones, now: () => time, notify: questCutsceneNotify(() => runtime) });
  service.may = questCutscenePermit(runtime, service.may);
  let n = 0;
  /** A character entering the world docked at home (`id` and `log`: coming back), as the gateway puts it in play. */
  const join = (again?: { id: string; log: QuestLog }) => {
    const id = again?.id ?? `c${n + 1}`;
    const viewer = new Viewer(++n, id);
    const homeSystem = homeSystemOf('thalune');
    const joined = zones.join(viewer, { id, name: `Tes ${id}`, people: 'thalune', level: 1, homeSystem });
    if (!inventory.get(id)) inventory.open(id);
    progress.set(id, { level: 1, xp: 0, homeSystem });
    runtime.open({ id, name: `Tes ${id}`, people: 'thalune', homeSystem }, again?.log ?? emptyQuestLog());
    runtime.joined(viewer);
    // (the zone's next tick: the entity's world position, which the service places cutscenes by; then the quest tick)
    zones.runTick(time);
    runtime.tickAll();
    return { id, viewer, zone: joined.zone, entity: joined.entityId };
  };
  const advance = (s: number) => {
    time += s;
    zones.runTick(time);
  };
  return { runtime, service, zones, join, advance };
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

  it('starts a cutscene step refused while the player was in another phase once it has left that phase', () => {
    const w = world(true, [
      quest('yard', [
        {
          id: 'wait',
          type: 'interact',
          text: 'Wait',
          target: 'npc:never',
          phase: { at: { body: 'station', pos: [0, 0, 0], radius: 500 }, actors: [{ kind: 'npc', name: 'Guard', offset: [0, 0, 5] }] },
        },
      ]),
      quest('watcher', [
        { id: 'go', type: 'interact', text: 'Go', target: 'npc:go' },
        { id: 'watch', type: 'cutscene', text: 'Watch', cutscene: 'test' },
      ]),
    ]);
    const a = w.join();
    w.runtime.startQuest(a.id, 'yard');
    w.runtime.startQuest(a.id, 'watcher');
    w.advance(0.5);
    w.runtime.tickAll();
    const yard = a.zone.phases.phaseOf(a.entity);
    expect(yard).not.toBeNull();
    // the cutscene step begins while the player is in the yard's phase: the service refuses (never out of a phase)
    w.runtime.event(a.id, { type: 'interact', target: 'npc:go' });
    expect(a.viewer.sent.filter((m) => m.op === 'play')).toEqual([]);
    expect(w.runtime.stateOf(a.id)!.active.watcher?.step).toBe('watch');
    // out of the yard (still within the cutscene's place): past the phase's grace the step plays, tried every few seconds
    a.zone.patch(a.entity, { pos: [0, 0, 1500] });
    for (let t = 0; t < 30 && !a.viewer.sent.some((m) => m.op === 'play'); t++) {
      w.advance(1);
      w.runtime.tickAll();
    }
    expect(a.zone.phases.phaseOf(a.entity)).not.toBe(yard);
    expect(a.viewer.sent.filter((m) => m.op === 'play')).toHaveLength(1);
    expect(w.service.playingOf(a.viewer)?.id).toBe('test');
    // watching it, the tick never starts it again
    for (let t = 0; t < 3 * CUTSCENE_RETRY_S; t++) {
      w.advance(1);
      w.runtime.tickAll();
    }
    expect(a.viewer.sent.filter((m) => m.op === 'play')).toHaveLength(1);
  });

  it('starts a cutscene step again when its player comes back after its connection dropped mid-cutscene', () => {
    const w = world();
    const a = w.join();
    w.runtime.request(a.id, 1, { op: 'accept', quest: 'cutscene_test' });
    expect(a.viewer.sent.filter((m) => m.op === 'play')).toHaveLength(1);
    // the connection drops (the gateway on close: the service forgets the session, the zone keeps its place, persistence
    // saves and unloads)
    const saved = structuredClone(w.runtime.stateOf(a.id)!);
    w.service.forget(a.viewer);
    w.zones.leave(a.viewer, 'disconnected');
    w.runtime.close(a.id);
    const b = w.join({ id: a.id, log: saved });
    expect(b.viewer.sent.filter((m) => m.op === 'play')).toHaveLength(1);
    expect(w.service.playingOf(b.viewer)?.id).toBe('test');
    expect(w.runtime.stateOf(a.id)!.active.cutscene_test?.step).toBe('watch');
  });

  /** The gateway's path for a client's done: the service ends it, and a played or skipped one ends the quest step. */
  const done = (w: ReturnType<typeof world>, viewer: Viewer, reason: 'finished' | 'skipped' | 'returned') => {
    const msg = { t: 'cutscene' as const, op: 'done' as const, id: 'test', skipped: reason !== 'finished', reason };
    const r = w.service.handle(viewer, msg);
    if (doneEndsQuestStep(msg, r)) w.runtime.cutsceneEnded(viewer, 'test');
    return r;
  };

  it('does not end a step whose cutscene the client gave back unplayed, and plays it again later', () => {
    const w = world();
    const a = w.join();
    w.runtime.request(a.id, 1, { op: 'accept', quest: 'cutscene_test' });
    expect(a.viewer.sent.filter((m) => m.op === 'play')).toHaveLength(1);
    // another cutscene was on screen: the client gives it back; the service ends its phase, the step stays
    expect(done(w, a.viewer, 'returned')).toMatchObject({ op: 'ended' });
    expect(w.service.playingOf(a.viewer)).toBeNull();
    expect(w.runtime.stateOf(a.id)!.active.cutscene_test?.step).toBe('watch');
    expect(w.runtime.stateOf(a.id)!.done.cutscene_test).toBeUndefined();
    // the retry plays it again
    for (let t = 0; t <= CUTSCENE_RETRY_S; t++) {
      w.advance(1);
      w.runtime.tickAll();
    }
    expect(a.viewer.sent.filter((m) => m.op === 'play')).toHaveLength(2);
    expect(w.service.playingOf(a.viewer)?.id).toBe('test');
    // played through this time: the step ends
    done(w, a.viewer, 'finished');
    expect(w.runtime.stateOf(a.id)!.done.cutscene_test).toMatchObject({ n: 1 });
  });

  it('ends the step when the player skips its cutscene', () => {
    const w = world();
    const a = w.join();
    w.runtime.request(a.id, 1, { op: 'accept', quest: 'cutscene_test' });
    done(w, a.viewer, 'skipped');
    expect(w.runtime.stateOf(a.id)!.done.cutscene_test).toMatchObject({ n: 1 });
    expect(w.runtime.stateOf(a.id)!.active.cutscene_test).toBeUndefined();
  });
});
