// Chat (DESIGN 16.6 "Social", 17; docs/ARCHITECTURE.md §12): three channels. `shard` reaches everyone online on the
// shard, `system` everyone whose entity is in the sender's star system's zone, `party` the sender's party wherever its
// members are; the sender always hears its own line back, as the server relays it.
//
// The protocol has already refused blank, over-long and control-laden text (ChatText, §5); here the line is trimmed and
// the sender's account rate-limited (per account, so its sockets share one limit, well inside each socket's message
// budget). The shard channel also has one limit for the whole shard, so a crowded shard stays readable and the cost of
// its fan-out is bounded. An account that keeps sending past its limit is muted for a while. The line goes out with the
// server's name for the sender and the server's time, encoded once for all its recipients. Refusals (rate, busy, muted,
// no zone, no party) go to the sender only, as `denied`. Nothing is persisted: every line and every mute goes to the
// server log, for moderation.
import type { ClientMessage } from '@astra/shared/protocol';
import { TokenBucket } from '../gateway/rateLimit.ts';
import { deny, fanOut, type SocialContext } from './context.ts';
import type { Online } from './roster.ts';
import type { ZoneIndex } from './zoneIndex.ts';

type Channel = Extract<ClientMessage, { t: 'chat' }>['channel'];

/** An account's chat allowance: its message bucket and, once that is empty, how much more flooding it gets away with. */
interface Allowance {
  readonly messages: TokenBucket;
  readonly floods: TokenBucket;
}

/** A mute: until when (monotonic ms) and why. */
interface Mute {
  readonly until: number;
  readonly reason: string;
}

export class Chat {
  private readonly allowances = new Map<string, Allowance>();
  private readonly mutes = new Map<string, Mute>();
  private shard: TokenBucket | null = null;

  constructor(
    private readonly ctx: SocialContext,
    /** the online members of a character's party, or null when it is in none */
    private readonly partyOf: (characterId: string) => Online[] | null,
    /** who is online in each zone */
    private readonly zoneIndex: ZoneIndex,
  ) {}

  /** Relays a line from `from` on `channel`, or tells it why not. */
  send(from: Online, channel: Channel, text: string): void {
    const { ctx } = this;
    const now = ctx.mono();
    const muted = this.mutedFor(from.accountId, now);
    if (muted > 0) return deny(from, 'chat', 'muted', { retryS: muted });
    const allowance = this.allowance(from.accountId, now);
    if (!allowance.messages.take(now)) {
      if (allowance.floods.take(now)) return deny(from, 'chat', 'rate', { retryS: allowance.messages.retryAfterSeconds(now) });
      this.mute(from.accountId, ctx.limits.muteS, 'flood', from);
      return deny(from, 'chat', 'muted', { retryS: ctx.limits.muteS });
    }

    let to: Iterable<Online>;
    const zone = ctx.zones.zoneOf(from.session);
    if (channel === 'shard') {
      this.shard ??= new TokenBucket(ctx.limits.shardBurst, ctx.limits.shardPerSecond, now);
      if (!this.shard.take(now)) return deny(from, 'chat', 'busy', { retryS: this.shard.retryAfterSeconds(now) });
      to = ctx.roster.values();
    } else if (channel === 'system') {
      if (!zone) return deny(from, 'chat', 'no_zone');
      to = this.zoneIndex.in(zone);
    } else {
      const members = this.partyOf(from.characterId);
      if (!members) return deny(from, 'chat', 'no_party');
      to = members;
    }

    const line = text.trim();
    const recipients = fanOut(ctx, to, { t: 'event', event: { kind: 'chat', channel, from: from.name, text: line, at: ctx.clock.now() } });
    ctx.log?.info({ account: from.accountId, character: from.characterId, name: from.name, channel, zone: zone?.id ?? null, recipients, text: line }, 'chat');
  }

  /** Mutes an account's chat for `seconds` (from now; a longer mute already running stands). */
  mute(accountId: string, seconds: number, reason: string, who?: Online): void {
    const until = this.ctx.mono() + seconds * 1000;
    const current = this.mutes.get(accountId);
    if (current && current.until >= until) return;
    this.mutes.set(accountId, { until, reason });
    this.ctx.log?.warn({ account: accountId, character: who?.characterId, name: who?.name, seconds, reason }, 'chat muted');
  }

  /** Lifts an account's mute; false when it had none. */
  unmute(accountId: string): boolean {
    const had = this.mutes.delete(accountId);
    if (had) this.ctx.log?.info({ account: accountId }, 'chat unmuted');
    return had;
  }

  /** Seconds (rounded up) the account stays muted; 0 when it is not. */
  mutedFor(accountId: string, now = this.ctx.mono()): number {
    const m = this.mutes.get(accountId);
    if (!m) return 0;
    if (m.until <= now) {
      this.mutes.delete(accountId);
      return 0;
    }
    return Math.ceil((m.until - now) / 1000);
  }

  /** Forgets allowances that have refilled (they behave exactly like a missing one) and mutes that have run out. */
  sweep(now: number): void {
    for (const [account, a] of this.allowances) {
      if (a.messages.level(now) >= a.messages.burst && a.floods.level(now) >= a.floods.burst) this.allowances.delete(account);
    }
    for (const [account, m] of this.mutes) if (m.until <= now) this.mutes.delete(account);
  }

  /** Accounts with an allowance being tracked. */
  get tracked(): number {
    return this.allowances.size;
  }

  private allowance(accountId: string, now: number): Allowance {
    let a = this.allowances.get(accountId);
    if (!a) {
      const { limits } = this.ctx;
      a = {
        messages: new TokenBucket(limits.chatBurst, limits.chatPerSecond, now),
        floods: new TokenBucket(limits.floodAllowance, limits.floodPerSecond, now),
      };
      this.allowances.set(accountId, a);
    }
    return a;
  }
}
