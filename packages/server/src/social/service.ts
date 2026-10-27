// The social service (DESIGN 16.6 "Social", 17; docs/ARCHITECTURE.md §13): chat and parties for every character in
// play on the shard. The gateway tells it who joined (with the character's name) and whose connection closed, and hands
// it `chat` and `party` requests from joined sessions; everything else happens here, on a timer of its own (invites
// lapsing, graces running out, party states refreshed). It holds nothing that must survive a restart.
import { encodeServerMessage, type ClientMessage, type PartyOp, type ServerMessage } from '@astra/shared/protocol';
import { performance } from 'node:perf_hooks';
import type { Session } from '../session/session.ts';
import type { ServerClock } from '../world/clock.ts';
import { Chat } from './chat.ts';
import type { SocialContext, SocialLog, SocialZones } from './context.ts';
import { SOCIAL_LIMITS, type SocialLimits } from './limits.ts';
import { Parties } from './parties.ts';
import { Roster } from './roster.ts';
import { ZoneIndex } from './zoneIndex.ts';

export interface SocialOptions {
  zones: SocialZones;
  clock: ServerClock;
  log?: SocialLog;
  /** monotonic milliseconds (performance.now); tests drive it by hand */
  mono?: () => number;
  /** overrides of SOCIAL_LIMITS */
  limits?: Partial<SocialLimits>;
  /** validates and serialises a server message (encodeServerMessage); tests count its calls */
  encode?: (m: ServerMessage) => string;
}

export class SocialService {
  /** The limits in force. Mutable so a test can shorten the grace on a running server; read when each is applied. */
  readonly limits: SocialLimits;
  readonly roster = new Roster();
  readonly parties: Parties;
  readonly chats: Chat;
  /** who is online in each zone, for system chat */
  readonly zoneIndex: ZoneIndex;
  private readonly mono: () => number;
  private readonly log?: SocialLog;
  private timer: NodeJS.Timeout | undefined;
  private nextSweep = -Infinity;

  constructor(opts: SocialOptions) {
    this.limits = { ...SOCIAL_LIMITS, ...opts.limits };
    this.mono = opts.mono ?? (() => performance.now());
    this.log = opts.log;
    const ctx: SocialContext = {
      roster: this.roster,
      zones: opts.zones,
      limits: this.limits,
      clock: opts.clock,
      mono: this.mono,
      log: opts.log,
      encode: opts.encode ?? encodeServerMessage,
    };
    this.parties = new Parties(ctx);
    this.zoneIndex = new ZoneIndex(this.roster, opts.zones);
    this.chats = new Chat(ctx, (characterId) => this.parties.online(characterId), this.zoneIndex);
  }

  /** The session's character is in play (its entity in a zone) under `name`: it is online, and hears its party's state. */
  joined(s: Session, name: string): void {
    const o = this.roster.add(s, name);
    this.zoneIndex.place(o);
    this.parties.joined(o);
  }

  /**
   * The session's connection closed. Its character goes offline, unless a newer connection holds it already (it entered
   * again); a party keeps its place for the grace.
   */
  left(s: Session): void {
    const o = this.roster.remove(s);
    if (!o) return;
    this.zoneIndex.remove(o);
    this.parties.left(o);
  }

  /** A chat message from a joined session. */
  chat(s: Session, msg: Extract<ClientMessage, { t: 'chat' }>): void {
    const o = this.roster.of(s);
    if (o) this.chats.send(o, msg.channel, msg.text);
  }

  /** A party request from a joined session. */
  party(s: Session, op: PartyOp): void {
    const o = this.roster.of(s);
    if (o) this.parties.request(o, op);
  }

  /**
   * The character's party id, which its zone entity carries as its party tag: what to pass phaseFor as `partyId` when
   * placing it in a phase (null: in no party).
   */
  partyIdOf(characterId: string): string | null {
    return this.parties.partyIdOf(characterId);
  }

  /**
   * The session's character is in another zone now (a handoff) or has a new entity: its party tag follows at once
   * rather than at the next tick.
   */
  moved(s: Session): void {
    const o = this.roster.of(s);
    if (!o) return;
    this.zoneIndex.place(o);
    this.parties.moved(o);
  }

  /** Mutes an account's chat for `seconds` (moderation; logged). */
  mute(accountId: string, seconds: number, reason: string): void {
    this.chats.mute(accountId, seconds, reason);
  }

  unmute(accountId: string): boolean {
    return this.chats.unmute(accountId);
  }

  /**
   * Lapses invites and refreshes the parties due (graces, tags, states); once a refresh, checks the zone index and
   * forgets idle allowances and spent mutes.
   */
  tick(now = this.mono()): void {
    this.parties.tick(now);
    if (now < this.nextSweep) return;
    this.nextSweep = now + this.limits.refreshMs;
    this.zoneIndex.check();
    this.chats.sweep(now);
  }

  /** Runs tick() every `limits.tickMs`. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.log?.error({ err }, 'social tick failed');
      }
    }, this.limits.tickMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
