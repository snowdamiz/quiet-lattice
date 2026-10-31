// Fabricators over the wire (P1.E13.T05, ARCHITECTURE §23), against the dockerised Postgres and Redis: a new character
// knows the Phase 1 consumables and crafts each at its home Waystation (docked, and on foot at the fabricator terminal);
// the ship's fabricator makes ammo and cartridges aboard anywhere but refuses a warp cell; missing materials, a recipe
// not learned or not in the table, and no room for the output are refused with nothing used up, and asking too fast is
// refused too. A recipe item teaches its recipe, which is written to the character's row and known again on rejoin,
// after a server restart. With movement authority on, a walker that got out of its docked ship uses the ship's
// fabricator beside it and is refused once it has walked 30 m away.
import { STARTING_RECIPES } from '@astra/shared/crafting';
import { STATION_FABRICATOR, WALKER } from '@astra/shared/data';
import { totals } from '@astra/shared/inventory';
import { PROTOCOL_VERSION, type ServerMessage } from '@astra/shared/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { characters } from '../src/db/schema.ts';
import type { RunningServer } from '../src/server.ts';
import { exitFeet } from '../src/sim/movement/testing.ts';
import { homeSystemOf, stationFrame } from '../src/world/home.ts';
import { newAccount, newCharacter, startTestServer, TestSocket, waitFor } from './helpers.ts';
import { Pilot } from './pilot.ts';

type Answer = Extract<ServerMessage, { t: 'craft' }>;
type Vec3 = [number, number, number];

const HOME = homeSystemOf('thalune');
const STATION = stationFrame(HOME);
const TERMINAL: Vec3 = [STATION_FABRICATOR.use.x, STATION_FABRICATOR.use.y, STATION_FABRICATOR.use.z];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const config = parseConfig(process.env);
let database: Database;
let server: RunningServer;

beforeAll(async () => {
  database = createDatabase(config.DATABASE_URL, { max: 2 });
  // (its bots go where they are put with raw poses: no movement authority here; the fabricators read the frame, mode and
  // position the zone holds, which movement authority's believed ones are with it on)
  server = await startTestServer({}, { movement: false });
});

afterAll(async () => {
  await server?.close();
  await database?.close();
});

/** A bot of a character, joined (docked at its home Waystation, as a new character starts): it moves with raw poses, asks
 * the fabricators and hears the answers. */
async function join(token: string, characterId: string) {
  const sock = await TestSocket.open(server.wsUrl);
  sock.send({ t: 'hello', version: PROTOCOL_VERSION, token });
  sock.send({ t: 'join', characterId });
  const welcome = await sock.next('welcome');
  const recipes = await sock.next('recipes');
  await sock.next('quests');
  const zone = server.zones.zone(welcome.zone.id)!;
  const sentAt = Date.now();
  const time = () => welcome.serverTime + (Date.now() - sentAt) / 1000;
  let inputSeq = 0;
  let seq = 0;
  return {
    sock,
    welcome,
    recipes,
    /** goes to a pose in a mode, once the server has it there */
    async go(frame: string | null, pos: Vec3, mode: 'ship' | 'foot') {
      sock.send({ t: 'input', seq: ++inputSeq, time: time(), mode, pose: { frame, pos: [...pos], quat: [0, 0, 0, 1], vel: [0, 0, 0] }, buttons: 0 });
      await waitFor(() => {
        const f = zone.entity(welcome.entityId)?.fields;
        return f?.mode === mode && f.frame === frame && Math.hypot(f.pos[0] - pos[0], f.pos[1] - pos[1], f.pos[2] - pos[2]) < 1e-6;
      });
    },
    /** sends a request without waiting (a burst) */
    send(op: { op: 'make'; recipe: string; count: number; at: 'station' | 'ship' } | { op: 'learn'; recipe: string }): number {
      const s = ++seq;
      sock.send({ t: 'craft', seq: s, op });
      return s;
    },
    /** the answer to request `s` */
    async answer(s: number): Promise<Answer> {
      for (;;) {
        const m = await sock.next('craft');
        if (m.seq === s) return m;
      }
    },
    /** asks to make `count` of a recipe at a fabricator, paced within the rate; the server's answer */
    async make(recipe: string, at: 'station' | 'ship' = 'station', count = 1): Promise<Answer> {
      await sleep(550);
      return this.answer(this.send({ op: 'make', recipe, count, at }));
    },
    async learn(recipe: string): Promise<Answer> {
      await sleep(550);
      return this.answer(this.send({ op: 'learn', recipe }));
    },
  };
}

async function character() {
  const acct = await newAccount(server);
  const id = (await newCharacter(server, acct.token, { people: 'thalune' })).id;
  return { acct, id };
}

const held = (id: string) => totals(server.ws.inventory.get(id)!);
function give(id: string, items: [string, number][]): void {
  for (const [item, n] of items) expect(server.ws.inventory.grant(id, item, n, { partial: false }).ok, item).toBe(true);
}

async function row(id: string) {
  const [r] = await database.db.select().from(characters).where(eq(characters.id, id));
  return r!;
}

describe('fabricators over the wire', () => {
  it('crafts each Phase 1 consumable at the Waystation; the ship’s fabricator makes ammo and cartridges anywhere but no warp cell', async () => {
    const { acct, id } = await character();
    const bot = await join(acct.token, id);
    expect(bot.welcome.mode).toBe('docked');
    expect(bot.recipes).toEqual({ t: 'recipes', known: [...STARTING_RECIPES] });
    give(id, [
      ['dihydrogen', 200],
      ['tritium', 200],
      ['cobalt', 20],
      ['oxygen', 100],
      ['sodium', 100],
      ['ferrite', 200],
      ['carbon', 100],
    ]);
    // docked at the home Waystation: its fabricator makes each of Phase 1's consumables, the inventory pushed with each
    const made = [
      ['warp_cell', 1],
      ['pulse_fuel_cell', 1],
      ['oxygen_cartridge', 1],
      ['sodium_cartridge', 1],
      ['flak_ammo', 50],
    ] as const;
    // (the session hears each change as it is made, before the answer)
    const pushed = () => [...bot.sock.received].reverse().find((m): m is Extract<ServerMessage, { t: 'inventory' }> => m.t === 'inventory')!;
    for (const [recipe, count] of made) {
      expect(await bot.make(recipe)).toEqual({ t: 'craft', seq: expect.any(Number), op: 'make', recipe, result: 'made', item: recipe, count });
      expect(totals(pushed().inventory)).toEqual(held(id));
    }
    // (the starting kit's warp cell, and the one made)
    expect(held(id)).toMatchObject({
      warp_cell: 2,
      pulse_fuel_cell: 1,
      oxygen_cartridge: 1,
      sodium_cartridge: 1,
      flak_ammo: 50,
      dihydrogen: 140,
      tritium: 150,
      cobalt: 15,
      oxygen: 80,
      sodium: 80,
      ferrite: 170,
      carbon: 90,
    });

    // aboard, the ship's own fabricator: ammo and cartridges, never a warp cell
    expect(await bot.make('flak_ammo', 'ship', 2)).toMatchObject({ result: 'made', item: 'flak_ammo', count: 100 });
    let before = held(id);
    expect(await bot.make('warp_cell', 'ship')).toMatchObject({ result: 'refused', reason: 'fabricator' });
    expect(held(id)).toEqual(before);

    // out in open space: the ship's fabricator works, the Waystation's is not there
    await bot.go(null, [4e8, 2e7, -1e8], 'ship');
    expect(await bot.make('oxygen_cartridge', 'ship')).toMatchObject({ result: 'made', item: 'oxygen_cartridge', count: 1 });
    expect(await bot.make('sodium_cartridge', 'ship', 3)).toMatchObject({ result: 'made', item: 'sodium_cartridge', count: 3 });
    before = held(id);
    expect(await bot.make('warp_cell', 'ship')).toMatchObject({ result: 'refused', reason: 'fabricator' });
    expect(await bot.make('warp_cell', 'station')).toMatchObject({ result: 'refused', reason: 'place' });
    expect(held(id)).toEqual(before);

    // back in the hangar on foot: the terminal on the trade deck, not the hangar floor
    await bot.go(STATION, [0, 0.5, 20], 'foot');
    expect(await bot.make('warp_cell')).toMatchObject({ result: 'refused', reason: 'place' });
    await bot.go(STATION, TERMINAL, 'foot');
    expect(await bot.make('warp_cell')).toMatchObject({ result: 'made', item: 'warp_cell', count: 1 });
    expect(held(id)).toMatchObject({ warp_cell: 3, oxygen_cartridge: 2, sodium_cartridge: 4, flak_ammo: 150 });
    bot.sock.close();
  });

  it('refuses, using up nothing, missing materials, a recipe not learned or not in the table, and no room; and asking too fast', async () => {
    const { acct, id } = await character();
    const bot = await join(acct.token, id);
    // nothing to make a warp cell from but the kit
    let before = held(id);
    expect(await bot.make('warp_cell')).toMatchObject({ result: 'refused', reason: 'materials' });
    expect(held(id)).toEqual(before);
    give(id, [
      ['dihydrogen', 49],
      ['tritium', 20],
      ['cobalt', 5],
    ]);
    before = held(id);
    expect(await bot.make('warp_cell')).toMatchObject({ result: 'refused', reason: 'materials' });
    expect(held(id)).toEqual(before);

    // a torpedo's materials, but not its recipe; a recipe that does not exist
    give(id, [
      ['cobalt', 5],
      ['tritium', 5],
      ['cinderglass', 2],
    ]);
    before = held(id);
    expect(await bot.make('torpedo')).toMatchObject({ result: 'refused', reason: 'not_known' });
    expect(await bot.make('no_such_recipe')).toMatchObject({ result: 'refused', reason: 'unknown' });
    expect(held(id)).toEqual(before);

    // every slot taken (the materials' stacks, the kit's warp cell, carbon in the rest): no room for a cartridge
    const inv = server.ws.inventory.get(id)!;
    const free = inv.suit.filter((s) => !s).length + inv.pods.flat().filter((s) => !s).length;
    give(id, [
      ['oxygen', 500],
      ['ferrite', 500],
      ['carbon', (free - 2) * inv.stackMax],
    ]);
    expect(server.ws.inventory.get(id)!.suit.every(Boolean) && server.ws.inventory.get(id)!.pods.flat().every(Boolean)).toBe(true);
    before = held(id);
    expect(await bot.make('oxygen_cartridge')).toMatchObject({ result: 'refused', reason: 'no_room' });
    expect(held(id)).toEqual(before);

    // ten asks at once: the first few answered, the rest refused for the rate
    await sleep(2500);
    const seqs = Array.from({ length: 10 }, () => bot.send({ op: 'make', recipe: 'flak_ammo', count: 1, at: 'station' }));
    const answers = await Promise.all(seqs.map((s) => bot.answer(s)));
    const rate = answers.filter((a) => a.result === 'refused' && a.reason === 'rate').length;
    expect(rate).toBeGreaterThanOrEqual(5);
    expect(answers.filter((a) => a.reason !== 'rate').every((a) => a.result === 'refused' && a.reason === 'no_room')).toBe(true);
    expect(held(id)).toEqual(before);
    bot.sock.close();
  });

  it('teaches a recipe from its item, for good: written to the row and known again on rejoin after a restart', async () => {
    const { acct, id } = await character();
    let bot = await join(acct.token, id);
    give(id, [
      ['recipe_torpedo', 1],
      ['cobalt', 10],
      ['tritium', 10],
      ['cinderglass', 4],
    ]);
    expect(await bot.make('torpedo')).toMatchObject({ result: 'refused', reason: 'not_known' });
    expect(await bot.learn('torpedo')).toMatchObject({ result: 'learned', recipe: 'torpedo' });
    expect(await bot.sock.next('recipes')).toEqual({ t: 'recipes', known: [...STARTING_RECIPES, 'torpedo'] });
    expect(held(id).recipe_torpedo).toBeUndefined();
    expect(await bot.learn('torpedo')).toMatchObject({ result: 'refused', reason: 'known' });
    expect(await bot.make('torpedo')).toMatchObject({ result: 'made', item: 'torpedo', count: 1 });

    // leaving writes it to the character's row
    bot.sock.close();
    await waitFor(() => server.persistence.status(id)?.inPlay !== true, 5000, 'the character out of play');
    expect(await server.persistence.flush()).toBe(true);
    expect((await row(id)).state).toMatchObject({ recipes: { v: 1, data: { known: [...STARTING_RECIPES, 'torpedo'] } } });

    // a new server on the same database: known on rejoin, and made
    await server.close();
    server = await startTestServer({}, { movement: false });
    bot = await join(acct.token, id);
    expect(bot.recipes).toEqual({ t: 'recipes', known: [...STARTING_RECIPES, 'torpedo'] });
    expect(held(id)).toMatchObject({ torpedo: 1, cobalt: 5, tritium: 5, cinderglass: 2 });
    expect(await bot.make('torpedo')).toMatchObject({ result: 'made', item: 'torpedo', count: 1 });
    bot.sock.close();
  });

  it('under movement authority, works the ship’s fabricator on foot beside the docked ship it left, and not 30 m off', async () => {
    const live = await startTestServer();
    try {
      const p = await Pilot.join(live);
      await p.sock.next('recipes');
      const system = live.zones.zone(p.welcome.zone.id)!.system;
      expect(p.welcome.mode).toBe('docked');
      await p.hold('docked', 300);
      // out beside the ship, feet 2 m over the floor, falling to it as the client's walker does
      const feet = exitFeet(system, p.welcome.pose);
      let y = feet[1];
      let vy = 0;
      for (let i = 0; i < 20; i++) {
        vy -= WALKER.stationGravity * 0.05;
        y = Math.max(0, y + vy * 0.05);
        if (y === 0) vy = 0;
        p.send({ ...p.last, pos: [feet[0], y, feet[2]], vel: [0, 0, 0] }, 'foot');
        await sleep(50);
      }
      const zone = live.zones.zone(p.welcome.zone.id)!;
      await waitFor(() => zone.entity(p.entityId)?.fields.mode === 'foot' && zone.entity(p.entityId)?.fields.pos[1] === 0, 5000, 'on the floor');
      expect(zone.movement!.parkedOf(p.entityId)?.pos).toEqual(p.welcome.pose.pos);
      for (const [item, n] of [
        ['ferrite', 100],
        ['carbon', 50],
      ] as const)
        expect(live.ws.inventory.grant(p.characterId, item, n).ok).toBe(true);
      let seq = 0;
      const ask = async (at: 'station' | 'ship') => {
        const s = ++seq;
        p.sock.send({ t: 'craft', seq: s, op: { op: 'make', recipe: 'flak_ammo', count: 1, at } });
        for (;;) {
          const m = await p.sock.next('craft');
          if (m.seq === s) return m;
        }
      };
      expect(await ask('ship')).toMatchObject({ result: 'made', item: 'flak_ammo', count: 50 });
      // (on the hangar floor, not at the trade deck's terminal: no station fabricator here)
      expect(await ask('station')).toMatchObject({ result: 'refused', reason: 'place' });
      // a walk across the floor toward the hangar's middle, 30 m from the ship
      await p.fly(
        [
          [feet[0], 0, feet[2]],
          [0, 0, feet[2]],
        ],
        [4],
        'foot',
      );
      await waitFor(() => zone.entity(p.entityId)?.fields.pos[0] === 0, 5000, 'the walk applied');
      expect(Math.hypot(...zone.entity(p.entityId)!.fields.pos.map((c, i) => c - p.welcome.pose.pos[i]!))).toBeGreaterThan(WALKER.boardRangeM + 5);
      expect(await ask('ship')).toMatchObject({ result: 'refused', reason: 'place' });
      expect(totals(live.ws.inventory.get(p.characterId)!)).toMatchObject({ flak_ammo: 50, ferrite: 80, carbon: 40 });
      expect(p.corrections).toEqual([]);
      p.close();
    } finally {
      await live.close();
    }
  });
});
