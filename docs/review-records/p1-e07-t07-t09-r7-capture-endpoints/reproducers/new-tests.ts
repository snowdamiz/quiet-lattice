
// Actual server producers and binary decoding, with inert transport/screenshot ports. No server or pixels.
const tuple = (a: number[]): [number, number, number] => [a[0]!, a[1]!, a[2]!];
function liveZone(ownerAt: number[], observerAt: number[]) {
  let now = 1000;
  const zone = new Zone({ id: 'capture-cpu', time: now, systemIndex: arena.system, system: describeZoneSystem(arena.system), fauna: { tier: 1, spawner: false, grounds: planHere } });
  const clients = [new SnapshotClient(), new SnapshotClient()];
  const events: ServerMessage[][] = [[], []];
  const order: { kind: string; client: number; time: number; tick: number }[] = [];
  const viewers: ZoneViewer[] = clients.map((client, i) => ({
    id: i + 1,
    sendBinary(bytes) {
      const snap = client.receive(bytes);
      zone.ack(viewers[i]!, snap.tick);
      order.push({ kind: 'snapshot', client: i, time: now, tick: snap.tick });
    },
    sendText(text) {
      const message = ServerMessage.parse(JSON.parse(text));
      events[i]!.push(message);
      if (message.t === 'event' && message.event.kind === 'combat') order.push({ kind: 'combat', client: i, time: now, tick: zone.tick });
    },
  }));
  const join = (i: number, pos: number[]) => zone.join(viewers[i]!, { kind: 'player', frame: arena.frame, pos: tuple(pos), quat: [0, 0, 0, 1], vel: [0, 0, 0], mode: 'foot' });
  const owner = join(0, ownerAt), observer = join(1, observerAt);
  const step = (dt = 0.05) => { now += dt; zone.step(now); };
  step();
  const spawn = (species: number, at: number[]) => {
    const id = zone.fauna!.spawnHerd({ body: arena.body, species, at: tuple(at), count: 1, level: 2 })?.creatures[0];
    if (id === undefined) throw new Error('Real creature spawn refused');
    return id;
  };
  return { zone, clients, viewers, events, order, owner, observer, step, spawn, get now() { return now; } };
}
function syncScene(s: ReturnType<typeof scene>, w: ReturnType<typeof liveZone>, client: number) {
  s.activate();
  s.g.net.entityId = client === 0 ? w.owner : w.observer;
  s.g.net.store.entities = new Map(w.clients[client]!.latest);
  s.g.net.store.tick = w.zone.tick;
  s.g.net.store.time = w.now;
  s.g.time = w.now;
  s.g.remotes.game.time = w.now;
  s.g.remotes.ingest(w.clients[client]!.latest, w.now, w.now, s.g.net.entityId);
  s.g.frame();
}
function caller(start: string, end: string, ports: Record<string, unknown>) {
  const from = spec.indexOf(start), to = spec.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error('Missing exact live caller boundary');
  const code = transpileModule(spec.slice(from, to), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(ports), `return (async () => {${code}})();`)(...Object.values(ports));
}

it.each(['none', 'before', 'during', 'camera', 'observer-before', 'observer-during', 'undrawn-before', 'undrawn-during'])('real post-retirement caller capture interval: %s', async (fault) => {
  const s = scene(ground.observerMark), w = liveZone(ground.ownerMark, ground.observerMark);
  const companion = w.spawn(0, ground.companion), enemy = w.spawn(4, vec(ground.companion).addScaledVector(vec(ground.east), 5).toArray());
  expect(w.zone.fauna!.bond(w.owner, companion, () => true)).toBe(true);
  const owner = w.owner, observer = w.observer;
  w.step();
  for (let i = 0; i < 400 && w.zone.entity(enemy)!.fields.hp === 1; i++) w.step();
  syncScene(s, w, 1);
  expect(w.zone.entity(enemy)!.fields.hp).toBeGreaterThan(0);
  expect(w.zone.entity(enemy)!.fields.hp).toBeLessThan(1);
  for (const messages of w.events) expect(messages.some(m => m.t === 'event' && m.event.kind === 'combat' && m.event.source === companion && m.event.target === enemy && m.event.amount > 0)).toBe(true);
  const release = { tick: w.zone.tick };
  const before = await view(s), observerBefore = { before, after: before };
  w.zone.leave(w.viewers[0]!);
  w.step(); syncScene(s, w, 1);
  w.step(0.2); syncScene(s, w, 1); // normal remote playback/removal delay
  expect(w.clients[1]!.latest.has(owner)).toBe(false);
  expect(w.clients[1]!.latest.has(companion)).toBe(false);
  const attachments: { name: string; body: Buffer; contentType: string }[] = [];
  const faultAt = (when: string) => {
    if (!fault.endsWith(when)) return;
    if (fault.startsWith('undrawn')) s.g.fauna.update([], 0); // actual draw-list retirement, wire stays alive
    else {
      const target = fault.startsWith('observer') ? observer : enemy;
      w.zone.combat.applyDamage(null, target, { base: 1e6, kind: 'attack' });
      w.step(0); syncScene(s, w, 1);
      expect(w.clients[1]!.latest.get(target)?.hp).toBe(0);
    }
  };
  const page = { ...s.page,
    waitForFunction: async (fn: () => unknown) => { expect(fn()).toBe(true); faultAt('before'); },
    screenshot: async () => {
      faultAt('during');
      if (fault === 'camera') await s.lookAt(s.page, ground.owner);
      return Buffer.from('inert retirement screenshot port; NOT native pixels');
    },
  };
  const capture = fixture('capture', { captureView: fixture('captureView'), createHash, expect });
  const evidence: Record<string, unknown> = {};
  try {
    let error: unknown;
    try {
      await caller('    const retired =', '\n  } finally {', {
        b: { page }, companion, observer, enemy, owner, release, arena, evidence, errors: [], observerBefore,
        EntityState, expect, sameCaptureView: same, capture, online: { serverOutput: () => '' },
        info: { attach: async (name: string, value: { body: Buffer; contentType: string }) => attachments.push({ name, ...value }) },
      });
    } catch (caught) { error = caught; }
    // Even rejected intervals keep both exact bytes and binding, before endpoint assertions execute.
    expect(attachments.map(a => a.name)).toEqual(['disconnect-observer', 'disconnect-observer-binding']);
    expect(evidence).toHaveProperty('retired');
    expect(evidence).toHaveProperty('observerAfter');
    if (fault === 'none') expect(error).toBeUndefined();
    else expect(error).toBeDefined();
    console.log('RETIREMENT_INTERVAL_CPU', JSON.stringify({ fault, error: String(error), binding: JSON.parse(attachments[1]!.body.toString()) }));
  } finally { s.close(); }
});

// Characterization, not a latency promise: real hostile reaction runs concurrently with the live walk/caller.
// The bounded late-follow starting arrangement and inert scheduler are not a complete native path or GLB render.
it.each([0, 0.2, 0.5, 1])('actual walk/event/replication/freeze order with %ss freeze latency', async (delay) => {
  const frame = world.cityFrame(arena.city), origin = world.cityPoint(arena.city, frame, arena.radius, -arena.plaza * 0.65 - 20, -7, 0);
  const toward = vec(ground.east).multiplyScalar(8).addScaledVector(vec(ground.north), 3).normalize();
  const cAt = origin.clone().addScaledVector(toward, 3).normalize().multiplyScalar(arena.radius + arena.city.base).toArray();
  const s = scene(origin.toArray(), [{ id: 34, species: 0, pos: cAt }]);
  const observerAt = await fixtureValue('observerMark', { a: { page: s.page }, ground });
  const w = liveZone(origin.toArray(), observerAt), companion = w.spawn(0, cAt);
  expect(w.zone.fauna!.bond(w.owner, companion, () => true)).toBe(true);
  w.step(); syncScene(s, w, 0);
  const enemyAt = await fixtureValue('enemyAt', { a: { page: s.page }, companion });
  const enemy = w.spawn(4, enemyAt);
  w.step(); syncScene(s, w, 0);
  const beforeHp = w.clients.map(c => c.latest.get(enemy)!.hp);
  expect(beforeHp).toEqual([1, 1]);
  const enemyStart = vec(w.zone.entity(enemy)!.fields.pos);
  const stages: { kind: string; time: number; tick: number }[] = [];
  let frozen = true, hitAt: number | undefined;
  const advance = () => {
    expect(frozen).toBe(false);
    s.g.player.update(0.05, s.input); s.input.endFrame();
    w.zone.patch(w.owner, { pos: tuple(s.g.player.state.pos.toArray()), vel: tuple(s.g.player.state.vel.toArray()) });
    w.step(); syncScene(s, w, 0);
    if (w.zone.entity(enemy)!.fields.hp! < 1) hitAt ??= w.now;
  };
  const ownerPage = s.page, observerPage = { ...s.page };
  const until = async (page: typeof ownerPage, source: string, timeout: number) => {
    const index = page === ownerPage ? 0 : 1;
    for (let ms = 0; ms < timeout; ms += 50) {
      advance();
      // The predicate reads the corresponding real decoded snapshot and encoded event delivery.
      vi.stubGlobal('window', { game: { ...s.g, net: { ...s.g.net, store: { ...s.g.net.store, entities: w.clients[index]!.latest } } }, symbioticQa: { messages: w.events[index] } });
      if (new Function(`return (${source})`)()) {
        stages.push({ kind: source.includes('symbioticQa') ? `event-hp-${index}` : 'walk-wait', time: w.now, tick: w.zone.tick });
        s.activate(); return;
      }
    }
    throw new Error('Real caller CPU wait timed out');
  };
  const walkTo = fixture('walkTo', { lookAt: s.lookAt, until });
  const online = { clock: {
    thaw: async () => { frozen = false; stages.push({ kind: 'thaw', time: w.now, tick: w.zone.tick }); },
    freeze: async () => {
      stages.push({ kind: 'freeze-request', time: w.now, tick: w.zone.tick });
      for (let i = 0; i < Math.round(delay / 0.05); i++) advance();
      frozen = true; stages.push({ kind: 'freeze-effective', time: w.now, tick: w.zone.tick });
    },
  } };
  try {
    await caller('    await online.clock.thaw();\n    // A short ordinary sidestep', '    const combat = [];', {
      online, a: { page: ownerPage }, pages: [ownerPage, observerPage], ground, walkTo, until, evidence: {}, EntityState, companion, enemy, beforeHp,
    });
    expect(s.input.keys.size).toBe(0);
    expect(frozen).toBe(true);
    expect(hitAt).toBeDefined();
    expect(s.g.player.state.pos.distanceTo(origin)).toBeGreaterThan(2.5);
    expect(vec(w.zone.entity(enemy)!.fields.pos).distanceTo(enemyStart)).toBeGreaterThan(0.1);
    expect(stages.filter(s => !s.kind.startsWith('walk')).map(s => s.kind)).toEqual(['thaw', 'event-hp-0', 'event-hp-1', 'freeze-request', 'freeze-effective']);
    // Zone publishes each snapshot before its combat event. Both real clients have damaged living enemy state.
    for (const index of [0, 1]) {
      const event = w.order.findIndex(e => e.kind === 'combat' && e.client === index);
      expect(event).toBeGreaterThan(0);
      expect(w.order.slice(0, event).some(e => e.kind === 'snapshot' && e.client === index && e.tick === w.order[event]!.tick)).toBe(true);
      expect(w.clients[index]!.latest.get(enemy)!.hp).toBeGreaterThan(0);
      expect(w.clients[index]!.latest.get(enemy)!.hp).toBeLessThan(1);
    }
    const views: { role: string; result: string; detail: unknown }[] = [];
    const rows = [companion, enemy].map(id => ({ id, species: w.zone.entity(id)!.fields.species!, pos: w.zone.entity(id)!.fields.pos }));
    for (const [index, role] of ['owner', 'observer'].entries()) {
      const v = scene(index === 0 ? s.g.player.state.pos.toArray() : observerAt, rows);
      syncScene(v, w, index);
      try { views.push({ role, result: 'PASS', detail: await v.frameSubjects(v.page, [companion, enemy], [ground.owner, ground.observer]) }); }
      catch (error) { views.push({ role, result: 'REJECT', detail: String(error) }); }
      finally { v.close(); }
    }
    console.log('CONCURRENT_COMBAT_CPU', JSON.stringify({ delay, hitAt, eventToFreeze: w.now - hitAt!, stages, views }));
    expect(views.map(v => v.result)).toEqual(delay < 0.5 ? ['PASS', 'PASS'] : ['REJECT', 'REJECT']);
  } finally { s.close(); }
});
