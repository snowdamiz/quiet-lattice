// Parties: invites (by name, to online characters, lapsing after a minute), accept, decline, leave, kick and promote
// (leader only), the lead handed on and the party disbanded, a dropped member's place kept for the grace, the zone's party
// tags following every change (so placement puts members in one story phase), the party's state sent only when it
// changed, and joining a party without an invite (a story beacon's answer).
import type { PartyView } from '@astra/shared/protocol';
import { describe, expect, it } from 'vitest';
import type { PhaseLocation } from '../../src/phases/manager.ts';
import { denials, harness, partyStates, type Player } from './harness.ts';

/** Ana invites the others in turn and each accepts: a party Ana leads, in that join order. */
function party(h: ReturnType<typeof harness>, leader: Player, ...others: Player[]): void {
  for (const p of others) {
    leader.party({ op: 'invite', name: p.name });
    p.party({ op: 'accept', name: leader.name });
  }
  for (const p of [leader, ...others]) p.take();
}

const tagOf = (p: Player) => p.zone.entity(p.entityId)?.party;
const member = (name: string, system: number | null = 0, health: number | null = 10) => ({ name, online: system !== null, system, health });

describe('parties', () => {
  it('forms a party when an invite is accepted, led by the inviter, with both entities tagged', () => {
    const h = harness();
    const ana = h.player('Ana');
    const bex = h.player('Bex');
    const cor = h.player('Cor');

    ana.party({ op: 'invite', name: 'bex' });
    expect(ana.news()).toEqual(['invited:Bex']);
    expect(bex.news()).toEqual(['invite:Ana']);
    expect(h.social.parties.invitesFor('char-Bex')).toEqual(['Ana']);

    bex.party({ op: 'accept', name: 'ANA' });
    const view: PartyView = { leader: 'Ana', members: [member('Ana'), member('Bex')] };
    for (const p of [ana, bex]) {
      const ms = p.take();
      expect(partyStates(ms)).toEqual([view]);
      expect(ms.some((m) => m.t === 'event' && m.event.kind === 'party' && m.event.what === 'joined' && m.event.name === 'Bex')).toBe(true);
    }
    expect(cor.take()).toEqual([]);
    const id = h.social.partyIdOf('char-Ana');
    expect(id).not.toBeNull();
    expect(h.social.partyIdOf('char-Bex')).toBe(id);
    expect([tagOf(ana), tagOf(bex), tagOf(cor)]).toEqual([id, id, null]);
    expect(h.social.parties.of('char-Bex')).toEqual({ id, leader: 'char-Ana', members: ['char-Ana', 'char-Bex'] });
    expect(h.social.parties.invitesFor('char-Bex')).toEqual([]);
  });

  it('joins the inviter’s party as it is when the invite is accepted', () => {
    const h = harness();
    const [ana, bex, cor] = ['Ana', 'Bex', 'Cor'].map((n) => h.player(n));
    party(h, ana, bex);
    // a member who is not the leader may invite
    bex.party({ op: 'invite', name: 'Cor' });
    cor.party({ op: 'accept', name: 'Bex' });
    expect(partyStates(ana.take())).toEqual([{ leader: 'Ana', members: [member('Ana'), member('Bex'), member('Cor')] }]);
    expect(h.social.parties.count).toBe(1);
  });

  it('refuses invites it cannot carry out, to the inviter only', () => {
    const h = harness({ partyMax: 2, maxInvitesHeld: 1 });
    const [ana, bex, cor, dax, eli] = ['Ana', 'Bex', 'Cor', 'Dax', 'Eli'].map((n) => h.player(n));
    ana.party({ op: 'invite', name: 'Nobody' });
    ana.party({ op: 'invite', name: 'ana' });
    expect(denials(ana.take())).toEqual(['invite:not_found:Nobody', 'invite:self:Ana']);

    ana.party({ op: 'invite', name: 'Bex' });
    ana.party({ op: 'invite', name: 'Bex' });
    expect(denials(ana.take())).toEqual(['invite:pending:Bex']);
    bex.party({ op: 'accept', name: 'Ana' });
    bex.take();
    // the party holds two: full; Bex is in a party: in_party
    ana.party({ op: 'invite', name: 'Cor' });
    dax.party({ op: 'invite', name: 'Bex' });
    expect(denials(ana.take())).toEqual(['invite:party_full:Cor']);
    expect(denials(dax.take())).toEqual(['invite:in_party:Bex']);
    // Cor may hold one invite at a time
    dax.party({ op: 'invite', name: 'Cor' });
    eli.party({ op: 'invite', name: 'Cor' });
    expect(denials(eli.take())).toEqual(['invite:busy:Cor']);
    expect(denials(cor.take())).toEqual([]);
    expect(bex.news()).toEqual([]);
  });

  it('limits how fast an account invites', () => {
    const h = harness({ inviteBurst: 2, invitePerSecond: 0.1 });
    const [ana, ...others] = ['Ana', 'Bex', 'Cor', 'Dax'].map((n) => h.player(n));
    for (const p of others) ana.party({ op: 'invite', name: p.name });
    expect(ana.take().filter((m) => m.t === 'denied')).toEqual([{ t: 'denied', of: 'invite', code: 'rate', retryS: 10, name: 'Dax' }]);
    h.advance(10_000);
    ana.party({ op: 'invite', name: 'Dax' });
    expect(ana.news()).toEqual(['invited:Dax']);
  });

  it('lapses an invite after a minute, telling both, and tells the inviter of a decline', () => {
    const h = harness();
    const [ana, bex, cor] = ['Ana', 'Bex', 'Cor'].map((n) => h.player(n));
    ana.party({ op: 'invite', name: 'Bex' });
    ana.party({ op: 'invite', name: 'Cor' });
    for (const p of [ana, bex, cor]) p.take();
    h.advance(59_000);
    cor.party({ op: 'decline', name: 'Ana' });
    expect(ana.news()).toEqual(['declined:Cor']);
    expect(bex.take()).toEqual([]);
    h.advance(1000);
    expect(ana.news()).toEqual(['expired:Bex']);
    expect(bex.news()).toEqual(['expired:Ana']);
    bex.party({ op: 'accept', name: 'Ana' });
    cor.party({ op: 'accept', name: 'Ana' });
    cor.party({ op: 'decline', name: 'Ana' });
    expect(denials(bex.take())).toEqual(['accept:no_invite:Ana']);
    expect(denials(cor.take())).toEqual(['accept:no_invite:Ana', 'decline:no_invite:Ana']);
    expect(h.social.parties.count).toBe(0);
  });

  it('spends the other invites a character holds when it joins a party, and refuses an invite whose inviter has gone', () => {
    const h = harness();
    const [ana, bex, cor, dax] = ['Ana', 'Bex', 'Cor', 'Dax'].map((n) => h.player(n));
    ana.party({ op: 'invite', name: 'Cor' });
    bex.party({ op: 'invite', name: 'Cor' });
    dax.party({ op: 'invite', name: 'Bex' });
    for (const p of [ana, bex, cor, dax]) p.take();
    cor.party({ op: 'accept', name: 'Ana' });
    expect(bex.news()).toEqual(['expired:Cor']);
    expect(h.social.parties.invitesFor('char-Cor')).toEqual([]);
    // Dax's invite to Bex outlives Dax's connection, but Dax is in no party to join
    h.drop(dax);
    bex.party({ op: 'accept', name: 'Dax' });
    expect(denials(bex.take())).toEqual(['accept:gone:Dax']);
    expect(h.social.parties.invitesFor('char-Bex')).toEqual([]);
  });

  it('puts a character in another’s party without an invite, as a story beacon’s answer does, refusing as accept would', () => {
    const h = harness({ partyMax: 3 });
    const [ana, bex, cor, dax, eli] = ['Ana', 'Bex', 'Cor', 'Dax', 'Eli'].map((n) => h.player(n));
    const { parties } = h.social;
    const online = (p: Player) => h.social.roster.get(p.characterId)!;
    dax.party({ op: 'invite', name: 'Bex' });
    bex.take();
    // Ana in no party: a new party she leads, Bex's pending invite spent (Dax hears it expired)
    expect(parties.joinRefusal(online(bex), 'char-Ana')).toBeNull();
    expect(parties.joinWith(online(bex), 'char-Ana')).toBeNull();
    expect(parties.of('char-Ana')).toMatchObject({ leader: 'char-Ana', members: ['char-Ana', 'char-Bex'] });
    expect(bex.news()).toEqual(['joined:Bex']);
    expect(dax.news()).toEqual(['invited:Bex', 'expired:Bex']);
    expect(partyStates(ana.take())).toEqual([{ leader: 'Ana', members: [member('Ana'), member('Bex')] }]);
    // asked again, or for a member of the same party: nothing changes
    expect(parties.joinWith(online(bex), 'char-Ana')).toBeNull();
    expect(parties.joinWith(online(ana), 'char-Bex')).toBeNull();
    expect(parties.of('char-Ana')?.members).toEqual(['char-Ana', 'char-Bex']);
    // into an existing party, until it is full
    expect(parties.joinWith(online(cor), 'char-Bex')).toBeNull();
    expect(parties.joinRefusal(online(dax), 'char-Ana')).toBe('party_full');
    expect(parties.joinWith(online(dax), 'char-Ana')).toBe('party_full');
    // in another party; with one offline in no party
    dax.party({ op: 'invite', name: 'Eli' });
    eli.party({ op: 'accept', name: 'Dax' });
    const fay = h.player('Fay');
    h.drop(fay);
    expect(parties.joinWith(online(eli), 'char-Fay')).toBe('in_party');
    const gil = h.player('Gil');
    expect(parties.joinWith(online(gil), 'char-Fay')).toBe('gone');
    expect([parties.partyIdOf('char-Gil'), parties.partyIdOf('char-Fay'), parties.of('char-Ana')?.members.length]).toEqual([null, null, 3]);
  });

  it('lets any member leave, and only the leader kick and promote', () => {
    const h = harness();
    const [ana, bex, cor] = ['Ana', 'Bex', 'Cor'].map((n) => h.player(n));
    party(h, ana, bex, cor);
    const id = h.social.partyIdOf('char-Ana');

    bex.party({ op: 'kick', name: 'Cor' });
    bex.party({ op: 'promote', name: 'Bex' });
    expect(denials(bex.take())).toEqual(['kick:not_leader:Cor', 'promote:not_leader:Bex']);

    ana.party({ op: 'promote', name: 'bex' });
    for (const p of [ana, bex, cor]) {
      const ms = p.take();
      expect(partyStates(ms)).toEqual([{ leader: 'Bex', members: [member('Ana'), member('Bex'), member('Cor')] }]);
      expect(ms.filter((m) => m.t === 'event').map((m) => m.t === 'event' && m.event)).toEqual([{ kind: 'party', what: 'leader', name: 'Bex' }]);
    }
    ana.party({ op: 'kick', name: 'Cor' });
    bex.party({ op: 'kick', name: 'Dax' });
    bex.party({ op: 'kick', name: 'bex' });
    expect(denials([...ana.take(), ...bex.take()])).toEqual(['kick:not_leader:Cor', 'kick:not_member:Dax', 'kick:self:Bex']);

    bex.party({ op: 'kick', name: 'Cor' });
    const corSaw = cor.take();
    expect(partyStates(corSaw)).toEqual([null]);
    expect(corSaw.find((m) => m.t === 'event')).toEqual({ t: 'event', event: { kind: 'party', what: 'kicked', name: 'Cor' } });
    for (const p of [ana, bex]) {
      const ms = p.take();
      expect(partyStates(ms)).toEqual([{ leader: 'Bex', members: [member('Ana'), member('Bex')] }]);
      expect(ms.some((m) => m.t === 'event' && m.event.kind === 'party' && m.event.what === 'kicked' && m.event.name === 'Cor')).toBe(true);
    }
    expect([tagOf(ana), tagOf(bex), tagOf(cor)]).toEqual([id, id, null]);
    cor.party({ op: 'leave' });
    expect(denials(cor.take())).toEqual(['leave:no_party']);

    // one leaves a party of two: the party disbands
    ana.party({ op: 'leave' });
    expect(ana.take()).toEqual([
      { t: 'party', party: null },
      { t: 'event', event: { kind: 'party', what: 'left', name: 'Ana' } },
    ]);
    expect(bex.take()).toEqual([
      { t: 'event', event: { kind: 'party', what: 'left', name: 'Ana' } },
      { t: 'party', party: null },
      { t: 'event', event: { kind: 'party', what: 'disbanded' } },
    ]);
    expect([tagOf(ana), tagOf(bex)]).toEqual([null, null]);
    expect([h.social.partyIdOf('char-Ana'), h.social.partyIdOf('char-Bex'), h.social.parties.count]).toEqual([null, null, 0]);
  });

  it('hands the lead to the longest-standing member still online when the leader leaves', () => {
    const h = harness();
    const [ana, bex, cor, dax] = ['Ana', 'Bex', 'Cor', 'Dax'].map((n) => h.player(n));
    party(h, ana, bex, cor, dax);
    // Bex's connection has dropped: Cor, the next online, leads
    h.drop(bex);
    ana.party({ op: 'leave' });
    expect(dax.news()).toEqual(['left:Ana', 'leader:Cor']);
    // with nobody else online, the longest-standing leads
    h.drop(dax);
    cor.party({ op: 'leave' });
    expect(h.social.parties.of('char-Bex')).toMatchObject({ leader: 'char-Bex', members: ['char-Bex', 'char-Dax'] });
  });

  it('keeps a dropped member’s place through the grace, and gives it back when the character enters again', () => {
    const h = harness();
    const [ana, bex] = ['Ana', 'Bex'].map((n) => h.player(n));
    party(h, ana, bex);
    const id = h.social.partyIdOf('char-Ana');
    h.drop(bex);
    expect(partyStates(ana.take())).toEqual([{ leader: 'Ana', members: [member('Ana'), member('Bex', null, null)] }]);
    h.advance(14_000);
    expect(ana.take()).toEqual([]);
    expect(h.social.partyIdOf('char-Bex')).toBe(id);

    // back in another system: a new entity, tagged at once, and the party's state for the new connection
    h.reconnect(bex, 1);
    expect(tagOf(bex)).toBe(id);
    const view = { leader: 'Ana', members: [member('Ana'), member('Bex', 1)] };
    expect(partyStates(bex.take())).toEqual([view]);
    expect(partyStates(ana.take())).toEqual([view]);
    // its grace is over: it stays
    h.advance(10_000);
    expect(h.social.parties.of('char-Bex')?.members).toEqual(['char-Ana', 'char-Bex']);
  });

  it('takes a member out once its grace runs out, handing on a leader’s lead, and disbands at one', () => {
    const h = harness();
    const [ana, bex, cor] = ['Ana', 'Bex', 'Cor'].map((n) => h.player(n));
    party(h, ana, bex, cor);
    h.drop(ana);
    h.advance(1000);
    for (const p of [bex, cor]) p.take();
    // still the leader while its grace runs: no one may kick or promote meanwhile
    bex.party({ op: 'kick', name: 'Cor' });
    expect(denials(bex.take())).toEqual(['kick:not_leader:Cor']);
    h.advance(15_000); // its grace, and the refresh that sees it end (once a second)
    for (const p of [bex, cor]) {
      const ms = p.take();
      expect(ms.flatMap((m) => (m.t === 'event' && m.event.kind === 'party' ? [`${m.event.what}:${m.event.name}`] : []))).toEqual(['left:Ana', 'leader:Bex']);
      expect(partyStates(ms)).toEqual([{ leader: 'Bex', members: [member('Bex'), member('Cor')] }]);
    }
    expect(h.lines.some((l) => l.msg === 'party member left' && l.obj.why === 'dropped')).toBe(true);
    // Ana entering again is in no party
    h.reconnect(ana);
    expect(ana.take()).toEqual([{ t: 'party', party: null }]);
    expect(tagOf(ana)).toBeNull();

    h.drop(cor);
    h.advance(16_000);
    expect(bex.news()).toEqual(['left:Cor', 'disbanded']);
    expect(tagOf(bex)).toBeNull();
    expect(h.social.parties.count).toBe(0);
  });

  it('keeps the party, and the member online, when its character enters again before the old connection closes', () => {
    const h = harness();
    const [ana, bex] = ['Ana', 'Bex'].map((n) => h.player(n));
    party(h, ana, bex);
    const old = bex.session;
    h.zones.leave(old, 'disconnected');
    h.reconnect(bex);
    h.social.left(old); // the old socket's close, after the new connection joined
    h.advance(20_000);
    expect(h.social.parties.of('char-Bex')?.members).toEqual(['char-Ana', 'char-Bex']);
    expect(partyStates(ana.take())).toEqual([]);
    expect(partyStates(bex.take())).toEqual([{ leader: 'Ana', members: [member('Ana'), member('Bex')] }]);
  });

  it('refreshes members’ systems and coarse health each tick, sending nothing when nothing changed', () => {
    const h = harness();
    const [ana, bex] = ['Ana', 'Bex'].map((n) => h.player(n));
    party(h, ana, bex);
    const encodes = h.encodes.n;
    h.advance(1000);
    h.advance(1000);
    expect([...ana.take(), ...bex.take(), h.encodes.n - encodes]).toEqual([0]);

    bex.zone.patch(bex.entityId, { hp: 0.53 });
    h.advance(1000);
    expect(partyStates(ana.take())).toEqual([{ leader: 'Ana', members: [member('Ana'), member('Bex', 0, 5)] }]);
    bex.zone.patch(bex.entityId, { hp: 0.51 });
    h.advance(1000);
    expect(ana.take()).toEqual([]);

    // a handoff to another zone: a new entity without the tag; the tick restores it
    const id = h.social.partyIdOf('char-Bex');
    h.zones.leave(bex.session);
    const joined = h.zones.join(bex.session, { id: 'char-Bex', name: 'Bex', people: 'thalune', level: 1, homeSystem: 1 });
    bex.zone = joined.zone;
    bex.entityId = joined.entityId;
    expect(tagOf(bex)).toBeNull();
    h.advance(1000);
    expect(tagOf(bex)).toBe(id);
    expect(partyStates(ana.take())).toEqual([{ leader: 'Ana', members: [member('Ana'), member('Bex', 1)] }]);
    // or at once, when the handoff says so
    h.zones.leave(bex.session);
    const back = h.zones.join(bex.session, { id: 'char-Bex', name: 'Bex', people: 'thalune', level: 1, homeSystem: 0 });
    bex.zone = back.zone;
    bex.entityId = back.entityId;
    h.social.moved(bex.session);
    expect(tagOf(bex)).toBe(id);
    expect(partyStates(ana.take())).toEqual([{ leader: 'Ana', members: [member('Ana'), member('Bex')] }]);
  });

  it('puts party members placed at one place in one story phase, and a player in no party in its own', () => {
    const h = harness();
    const [ana, bex, cor] = ['Ana', 'Bex', 'Cor'].map((n) => h.player(n));
    party(h, ana, bex);
    const { zone } = ana;
    const site: PhaseLocation = { key: 'chapter-6', frame: zone.stationFrame, center: [0, 0, 0], radius: 300 };
    // by their entities' party tags
    const p = zone.phases.phaseFor(ana.session, 'story', site);
    expect(zone.phases.phaseFor(bex.session, 'story', site)).toBe(p);
    expect(zone.phases.phaseFor(cor.session, 'story', site)).not.toBe(p);
    expect([...p.members].sort()).toEqual([ana.entityId, bex.entityId].sort());
    // and under the party id the service gives (which a member keeps in its phase)
    const next: PhaseLocation = { ...site, key: 'chapter-7' };
    const at = (x: Player) => zone.phases.phaseFor(x.session, 'story', next, h.social.partyIdOf(x.characterId));
    const r = at(ana);
    expect(at(bex)).toBe(r);
    expect(at(cor)).not.toBe(r);
    // Cor joins the party; the next place the three are placed at, they share
    ana.party({ op: 'invite', name: 'Cor' });
    cor.party({ op: 'accept', name: 'Ana' });
    const last: PhaseLocation = { ...site, key: 'chapter-8' };
    const s = zone.phases.phaseFor(cor.session, 'story', last);
    expect([ana, bex].map((x) => zone.phases.phaseFor(x.session, 'story', last))).toEqual([s, s]);
    expect(s.members.size).toBe(3);
  });

  it('gives a member kicked while its connection was down no way back into the party’s story phase', () => {
    const h = harness();
    const [ana, bex, cor] = ['Ana', 'Bex', 'Cor'].map((n) => h.player(n));
    party(h, ana, bex, cor);
    const site: PhaseLocation = { key: 'chapter-9', frame: ana.zone.stationFrame, center: [0, 0, 0], radius: 300 };
    const s = ana.zone.phases.phaseFor(ana.session, 'story', site);
    expect(ana.zone.phases.phaseFor(bex.session, 'story', site)).toBe(s);
    expect(ana.zone.phases.phaseFor(cor.session, 'story', site)).toBe(s);
    // Cor drops and comes back within the grace, still a member: its place is its own again
    h.drop(cor);
    h.advance(2000);
    h.reconnect(cor);
    expect(cor.zone.phases.phaseFor(cor.session, 'story', site)).toBe(s);
    // Bex drops and is kicked meanwhile: back within the grace, in no party, it is placed afresh, by tag or by id
    h.drop(bex);
    ana.party({ op: 'kick', name: 'Bex' });
    h.advance(2000);
    h.reconnect(bex);
    expect(bex.zone.entity(bex.entityId)?.party).toBeNull();
    const fresh = bex.zone.phases.phaseFor(bex.session, 'story', site);
    expect(fresh).not.toBe(s);
    expect(bex.zone.phases.phaseFor(bex.session, 'story', site, h.social.partyIdOf('char-Bex'))).toBe(fresh);
    expect([...s.members].sort()).toEqual([ana.entityId, cor.entityId].sort());
    expect(s.held.size).toBe(0);
  });

  it('refuses to accept into a party that filled up after the invite, and to promote a member who is offline', () => {
    const h = harness({ partyMax: 3 });
    const [ana, bex, cor, dax] = ['Ana', 'Bex', 'Cor', 'Dax'].map((n) => h.player(n));
    party(h, ana, bex);
    ana.party({ op: 'invite', name: 'Cor' });
    ana.party({ op: 'invite', name: 'Dax' });
    cor.party({ op: 'accept', name: 'Ana' });
    dax.party({ op: 'accept', name: 'Ana' });
    expect(denials(dax.take())).toEqual(['accept:party_full:Ana']);
    expect(h.social.parties.of('char-Ana')?.members).toEqual(['char-Ana', 'char-Bex', 'char-Cor']);
    // the invite stands, should a place open up before it lapses
    bex.party({ op: 'leave' });
    dax.party({ op: 'accept', name: 'Ana' });
    expect(h.social.parties.of('char-Dax')?.members).toEqual(['char-Ana', 'char-Cor', 'char-Dax']);

    h.drop(cor);
    ana.take();
    ana.party({ op: 'promote', name: 'Cor' });
    expect(ana.take()).toEqual([{ t: 'denied', of: 'promote', code: 'offline', name: 'Cor' }]);
    expect(h.social.parties.of('char-Ana')?.leader).toBe('char-Ana');
  });

  it('shows a member whose hp is not a number as whole, logging it once, and keeps every party’s refresh going', () => {
    const h = harness();
    const [ana, bex, cor, dax] = ['Ana', 'Bex', 'Cor', 'Dax'].map((n) => h.player(n));
    party(h, ana, bex);
    party(h, cor, dax);
    bex.zone.patch(bex.entityId, { hp: Number.NaN });
    h.drop(dax);
    h.advance(1000);
    expect(partyStates(ana.take())).toEqual([]);
    expect(h.lines.filter((l) => l.msg.startsWith('party member hp is not a number'))).toHaveLength(1);
    // a request touching that party still works, and the other party's grace still runs out
    ana.party({ op: 'invite', name: 'Eli' });
    bex.party({ op: 'leave' });
    expect(denials([...ana.take(), ...bex.take()])).toEqual(['invite:not_found:Eli']);
    h.advance(16_000);
    expect([h.social.partyIdOf('char-Cor'), h.social.partyIdOf('char-Dax')]).toEqual([null, null]);
    expect(cor.news()).toEqual(['left:Dax', 'disbanded']);
  });

  it('logs and skips a party whose refresh fails, and refreshes the rest', () => {
    const h = harness(
      {},
      {
        encode: (m, encode) => {
          if (m.t === 'party' && m.party?.members.some((x) => x.name === 'Bex' && x.health === 2)) throw new Error('boom');
          return encode(m);
        },
      },
    );
    const [ana, bex, cor, dax] = ['Ana', 'Bex', 'Cor', 'Dax'].map((n) => h.player(n));
    party(h, ana, bex);
    party(h, cor, dax);
    bex.zone.patch(bex.entityId, { hp: 0.2 });
    dax.zone.patch(dax.entityId, { hp: 0.5 });
    h.advance(1000);
    expect(h.lines.filter((l) => l.msg === 'party refresh failed')).toHaveLength(1);
    expect(partyStates(cor.take())).toEqual([{ leader: 'Cor', members: [member('Cor'), member('Dax', 0, 5)] }]);
  });

  it('spreads the parties’ refresh over the ticks of a second, each party once', () => {
    const h = harness();
    const players = Array.from({ length: 40 }, (_, i) => h.player(`P${'abcdefghijklmnopqrst'[i % 20]}${'xy'[Math.floor(i / 20)]}`));
    const leaders = players.filter((_, i) => i % 2 === 0);
    for (let i = 0; i < 40; i += 2) party(h, players[i]!, players[i + 1]!);
    h.advance(1000);
    for (const p of players) p.take();
    for (let i = 1; i < 40; i += 2) players[i]!.zone.patch(players[i]!.entityId, { hp: 0.5 });
    const refreshed = () => leaders.filter((p) => partyStates(p.take()).length > 0).length;
    const perTick: number[] = [];
    for (let t = 0; t < 10; t++) {
      h.advance(100);
      perTick.push(refreshed());
    }
    expect(perTick).toEqual(Array(10).fill(2));
  });
});
