// Parties (DESIGN 14.1, 16.6, 17; docs/ARCHITECTURE.md §6.1, §11): server-owned groups of up to PARTY_MAX characters
// with a leader.
//
// - An online character invites another online character by name; the invite lapses after a minute. Accepting puts the
//   invitee in the inviter's party as it is then, or in a new party the inviter leads. Declining tells the inviter.
// - Any member may leave and invite; only the leader kicks and promotes. When the leader goes, the longest-standing
//   member still online leads (the longest-standing of all when none is). A party left with one member disbands.
// - A member whose connection drops keeps its place for the grace (the phases' 15 s) and is shown offline; its character
//   entering again in time takes the place back, past the grace it leaves the party. A zone handoff changes nothing:
//   membership is the character's, not its entity's.
// - Every member's zone entity carries the party's id as its party tag (zone.setParty), so members see each other
//   anywhere in a zone and the phase manager's placement (phaseFor) puts them in one story phase. Tags are set on every
//   change and on joining, and checked each tick, so an entity that is new since (a handoff, a respawn) gets its tag.
// - Members get the party's state (members in join order, the leader, each member's system and health in tenths) when
//   it changes; each tick the state is rebuilt per party and sent only if it differs from the last one sent, encoded
//   once for all its members. Party news (`event` kind `party`) goes to whom it concerns; refusals go to the asker only.
import type { PartyOp, PartyView, ServerMessage } from '@astra/shared/protocol';
import { TokenBucket } from '../gateway/rateLimit.ts';
import { deny, fanOut, sendEncoded, type SocialContext } from './context.ts';
import { key, type Online } from './roster.ts';

type PartyNews = Extract<Extract<ServerMessage, { t: 'event' }>['event'], { kind: 'party' }>['what'];

interface Member {
  readonly characterId: string;
  readonly name: string;
  /** monotonic ms its connection dropped; null while it is online */
  offlineSince: number | null;
}

class Party {
  /** in join order */
  readonly members = new Map<string, Member>();
  /** the state last sent to its members: the view as a key, and encoded */
  sentKey: string | null = null;
  sent: string | null = null;

  constructor(
    readonly id: string,
    public leader: string,
  ) {}
}

/** A pending invite from one character to another. */
interface Invite {
  readonly from: string;
  readonly fromName: string;
  readonly to: string;
  readonly toName: string;
  /** monotonic ms it lapses at */
  readonly expires: number;
}

/** A party as the rest of the server may look at it. */
export interface PartyInfo {
  readonly id: string;
  /** the leader's character id */
  readonly leader: string;
  /** character ids, in join order */
  readonly members: readonly string[];
}

export class Parties {
  private readonly parties = new Map<string, Party>();
  private readonly byCharacter = new Map<string, Party>();
  /** pending invites by invitee, then by inviter */
  private readonly invites = new Map<string, Map<string, Invite>>();
  /** invite allowances by account */
  private readonly allowances = new Map<string, TokenBucket>();
  private nextId = 1;

  constructor(private readonly ctx: SocialContext) {}

  /** Parties that exist. */
  get count(): number {
    return this.parties.size;
  }

  /** The id of the character's party (its entity's party tag), or null. */
  partyIdOf(characterId: string): string | null {
    return this.byCharacter.get(characterId)?.id ?? null;
  }

  /** The character's party, or undefined. */
  of(characterId: string): PartyInfo | undefined {
    const p = this.byCharacter.get(characterId);
    return p && { id: p.id, leader: p.leader, members: [...p.members.keys()] };
  }

  /** The online members of the character's party (itself included), or null when it is in none. */
  online(characterId: string): Online[] | null {
    const p = this.byCharacter.get(characterId);
    return p ? [...this.onlineIn(p)] : null;
  }

  /** Invites pending for the character, from whom (names). */
  invitesFor(characterId: string): string[] {
    return [...(this.invites.get(characterId)?.values() ?? [])].map((i) => i.fromName);
  }

  /** Carries out a party request, or tells the asker why not. */
  request(o: Online, op: PartyOp): void {
    switch (op.op) {
      case 'invite':
        return this.invite(o, op.name);
      case 'accept':
        return this.accept(o, op.name);
      case 'decline':
        return this.decline(o, op.name);
      case 'leave': {
        const p = this.byCharacter.get(o.characterId);
        if (!p) return deny(o, 'leave', 'no_party');
        return this.remove(p, o.characterId, 'left');
      }
      case 'kick':
      case 'promote':
        return this.lead(o, op.op, op.name);
    }
  }

  /** The character came online (joined, or entered again): it takes back its place, and hears its party's state. */
  joined(o: Online): void {
    const p = this.byCharacter.get(o.characterId);
    if (!p) {
      o.session.send({ t: 'party', party: null });
      return;
    }
    p.members.get(o.characterId)!.offlineSince = null;
    this.tag(o.characterId, p.id);
    this.flush(p, o);
  }

  /** The character is in another zone, or has a new entity: its tag follows, and its party sees where it is. */
  moved(o: Online): void {
    const p = this.byCharacter.get(o.characterId);
    if (!p) return;
    this.tag(o.characterId, p.id);
    this.flush(p);
  }

  /** The character's connection dropped: it keeps its place for the grace; the invites it held lapse. */
  left(o: Online): void {
    const held = this.invites.get(o.characterId);
    for (const inv of [...(held?.values() ?? [])]) this.lapse(inv);
    const p = this.byCharacter.get(o.characterId);
    if (!p) return;
    p.members.get(o.characterId)!.offlineSince = this.ctx.mono();
    this.flush(p);
  }

  /** Lapses invites, takes out members whose grace ran out, checks tags and sends whatever state changed. */
  tick(now: number): void {
    for (const held of [...this.invites.values()]) for (const inv of [...held.values()]) if (inv.expires <= now) this.lapse(inv);
    for (const p of [...this.parties.values()]) {
      for (const m of [...p.members.values()]) {
        if (m.offlineSince === null || now - m.offlineSince < this.ctx.limits.graceMs) continue;
        this.remove(p, m.characterId, 'dropped');
        if (!this.parties.has(p.id)) break;
      }
      if (!this.parties.has(p.id)) continue;
      for (const id of p.members.keys()) this.tag(id, p.id);
      this.flush(p);
    }
    for (const [account, b] of this.allowances) if (b.level(now) >= b.burst) this.allowances.delete(account);
  }

  // ---------- requests ----------

  private invite(o: Online, name: string): void {
    const { ctx } = this;
    const now = ctx.mono();
    let allowance = this.allowances.get(o.accountId);
    if (!allowance) this.allowances.set(o.accountId, (allowance = new TokenBucket(ctx.limits.inviteBurst, ctx.limits.invitePerSecond, now)));
    if (!allowance.take(now)) return deny(o, 'invite', 'rate', { retryS: allowance.retryAfterSeconds(now), name });
    const target = ctx.roster.named(name);
    if (!target) return deny(o, 'invite', 'not_found', { name });
    if (target.characterId === o.characterId) return deny(o, 'invite', 'self', { name: target.name });
    if (this.byCharacter.has(target.characterId)) return deny(o, 'invite', 'in_party', { name: target.name });
    const p = this.byCharacter.get(o.characterId);
    if (p && p.members.size >= ctx.limits.partyMax) return deny(o, 'invite', 'party_full', { name: target.name });
    let held = this.invites.get(target.characterId);
    if (held?.has(o.characterId)) return deny(o, 'invite', 'pending', { name: target.name });
    if (held && held.size >= ctx.limits.maxInvitesHeld) return deny(o, 'invite', 'busy', { name: target.name });
    if (!held) this.invites.set(target.characterId, (held = new Map()));
    held.set(o.characterId, { from: o.characterId, fromName: o.name, to: target.characterId, toName: target.name, expires: now + ctx.limits.inviteTtlMs });
    news(target, 'invite', o.name);
    news(o, 'invited', target.name);
    ctx.log?.debug({ from: o.characterId, to: target.characterId, party: p?.id ?? null }, 'party invite');
  }

  private accept(o: Online, name: string): void {
    const inv = this.findInvite(o.characterId, name);
    if (!inv) return deny(o, 'accept', 'no_invite', { name });
    if (this.byCharacter.has(o.characterId)) return deny(o, 'accept', 'in_party', { name: inv.fromName });
    let p = this.byCharacter.get(inv.from);
    if (p && p.members.size >= this.ctx.limits.partyMax) return deny(o, 'accept', 'party_full', { name: inv.fromName });
    if (!p) {
      const inviter = this.ctx.roster.get(inv.from);
      if (!inviter) {
        this.drop(inv);
        return deny(o, 'accept', 'gone', { name: inv.fromName });
      }
      p = this.form(inviter);
    }
    this.drop(inv);
    this.add(p, o);
    this.tell(p, 'joined', o.name);
    this.flush(p);
  }

  private decline(o: Online, name: string): void {
    const inv = this.findInvite(o.characterId, name);
    if (!inv) return deny(o, 'decline', 'no_invite', { name });
    this.drop(inv);
    const inviter = this.ctx.roster.get(inv.from);
    if (inviter) news(inviter, 'declined', o.name);
  }

  /** Kick or promote: the leader names a member. */
  private lead(o: Online, op: 'kick' | 'promote', name: string): void {
    const p = this.byCharacter.get(o.characterId);
    if (!p) return deny(o, op, 'no_party', { name });
    if (p.leader !== o.characterId) return deny(o, op, 'not_leader', { name });
    const k = key(name);
    const m = [...p.members.values()].find((x) => key(x.name) === k);
    if (!m) return deny(o, op, 'not_member', { name });
    if (m.characterId === o.characterId) return deny(o, op, 'self', { name: m.name });
    if (op === 'kick') return this.remove(p, m.characterId, 'kicked');
    p.leader = m.characterId;
    this.ctx.log?.info({ party: p.id, leader: m.characterId, by: o.characterId }, 'party leader promoted');
    this.tell(p, 'leader', m.name);
    this.flush(p);
  }

  // ---------- inside ----------

  /** A new party led by `leader`. */
  private form(leader: Online): Party {
    const p = new Party(`party:${this.nextId++}`, leader.characterId);
    this.parties.set(p.id, p);
    this.add(p, leader);
    this.ctx.log?.info({ party: p.id, leader: leader.characterId }, 'party formed');
    return p;
  }

  /** Puts an online character in the party. Any invite it still holds is spent, and its inviter hears so. */
  private add(p: Party, o: Online): void {
    p.members.set(o.characterId, { characterId: o.characterId, name: o.name, offlineSince: null });
    this.byCharacter.set(o.characterId, p);
    for (const inv of [...(this.invites.get(o.characterId)?.values() ?? [])]) {
      this.drop(inv);
      const inviter = this.ctx.roster.get(inv.from);
      if (inviter) news(inviter, 'expired', o.name);
    }
    this.tag(o.characterId, p.id);
    this.ctx.log?.info({ party: p.id, character: o.characterId, members: p.members.size }, 'party member joined');
  }

  /**
   * Takes a member out: it asked to ('left'), the leader kicked it, or its connection stayed down past the grace
   * ('dropped'). Its leaving may hand the lead on, or disband a party it leaves with one member.
   */
  private remove(p: Party, characterId: string, why: 'left' | 'kicked' | 'dropped'): void {
    const m = p.members.get(characterId)!;
    p.members.delete(characterId);
    this.byCharacter.delete(characterId);
    this.tag(characterId, null);
    const o = this.ctx.roster.get(characterId);
    if (o) {
      o.session.send({ t: 'party', party: null });
      news(o, why === 'kicked' ? 'kicked' : 'left', m.name);
    }
    this.ctx.log?.info({ party: p.id, character: characterId, why, members: p.members.size }, 'party member left');
    this.tell(p, why === 'kicked' ? 'kicked' : 'left', m.name);
    if (p.members.size < 2) return this.disband(p);
    if (p.leader === characterId) {
      p.leader = this.successor(p);
      this.ctx.log?.info({ party: p.id, leader: p.leader }, 'party leader handed on');
      this.tell(p, 'leader', p.members.get(p.leader)!.name);
    }
    this.flush(p);
  }

  /** The longest-standing member online, else the longest-standing. */
  private successor(p: Party): string {
    for (const m of p.members.values()) if (this.ctx.roster.get(m.characterId)) return m.characterId;
    return p.members.keys().next().value!;
  }

  private disband(p: Party): void {
    for (const m of p.members.values()) {
      this.byCharacter.delete(m.characterId);
      this.tag(m.characterId, null);
      const o = this.ctx.roster.get(m.characterId);
      if (o) {
        o.session.send({ t: 'party', party: null });
        news(o, 'disbanded');
      }
    }
    p.members.clear();
    this.parties.delete(p.id);
    this.ctx.log?.info({ party: p.id }, 'party disbanded');
  }

  /**
   * Sends the party's state to its online members when it changed since last sent, and to `also` regardless. The view
   * is compared as plain JSON and validated and encoded only when it changed.
   */
  private flush(p: Party, also?: Online): void {
    const view = this.view(p);
    const k = JSON.stringify(view);
    if (k !== p.sentKey) {
      p.sentKey = k;
      p.sent = this.ctx.encode({ t: 'party', party: view });
      for (const o of this.onlineIn(p)) sendEncoded(o.session, p.sent);
    } else if (also) {
      sendEncoded(also.session, p.sent!);
    }
  }

  /** The party as its members see it. */
  private view(p: Party): PartyView {
    const members = [...p.members.values()].map((m) => {
      const o = this.ctx.roster.get(m.characterId);
      if (!o) return { name: m.name, online: false, system: null, health: null };
      const zone = this.ctx.zones.zoneOf(o.session);
      const id = zone?.entityOf(o.session);
      const e = id === undefined ? undefined : zone!.entity(id);
      // (no damage model sets hp on players yet: an entity without one is whole)
      const health = e ? Math.round(Math.min(1, Math.max(0, e.fields.hp ?? 1)) * 10) : null;
      return { name: m.name, online: true, system: zone?.systemIndex ?? null, health };
    });
    return { leader: p.members.get(p.leader)!.name, members };
  }

  /** Puts the character's zone entity in `party` (its party tag), when it is online and in a zone. */
  private tag(characterId: string, party: string | null): void {
    const o = this.ctx.roster.get(characterId);
    if (!o) return;
    const zone = this.ctx.zones.zoneOf(o.session);
    const id = zone?.entityOf(o.session);
    if (zone === undefined || id === undefined || zone.entity(id)?.party === party) return;
    zone.setParty(id, party);
  }

  /** The party's online members. */
  private *onlineIn(p: Party): Generator<Online> {
    for (const id of p.members.keys()) {
      const o = this.ctx.roster.get(id);
      if (o) yield o;
    }
  }

  /** Party news to every online member, encoded once. */
  private tell(p: Party, what: PartyNews, name?: string): void {
    fanOut(this.ctx, this.onlineIn(p), { t: 'event', event: { kind: 'party', what, ...(name === undefined ? {} : { name }) } });
  }

  private findInvite(to: string, fromName: string): Invite | undefined {
    const k = key(fromName);
    for (const inv of this.invites.get(to)?.values() ?? []) if (key(inv.fromName) === k) return inv;
    return undefined;
  }

  private drop(inv: Invite): void {
    const held = this.invites.get(inv.to);
    held?.delete(inv.from);
    if (held?.size === 0) this.invites.delete(inv.to);
  }

  /** An invite lapsed (its minute ran out, or the invitee's connection dropped): both sides hear of it. */
  private lapse(inv: Invite): void {
    this.drop(inv);
    const to = this.ctx.roster.get(inv.to);
    const from = this.ctx.roster.get(inv.from);
    if (to) news(to, 'expired', inv.fromName);
    if (from) news(from, 'expired', inv.toName);
  }
}

/** Party news for one character. */
function news(o: Online, what: PartyNews, name?: string): void {
  o.session.send({ t: 'event', event: { kind: 'party', what, ...(name === undefined ? {} : { name }) } });
}
