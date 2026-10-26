// The seam between a cutscene and the server (docs/ARCHITECTURE.md "Cutscenes"). Cutscenes are always phased: before
// one plays, the server opens (or joins) a story phase at the player's place, so the cutscene's actors are seen only
// by the player and its party (DESIGN 14.1, 17). The networked client (P1.E04.T01) sends `cutscene {op: 'request'}`
// and plays once the server answers `cutscene {op: 'play', phase}`, and reports `done` when it ends or is skipped. Until
// the client is networked this link answers for the server: the cutscene plays in a local layer of its own (the client
// is alone in its world), and the messages it would have sent are checked against the protocol and kept.
import { encodeClientMessage } from '@astra/shared/protocol';

export class OfflineCutsceneLink {
  constructor() {
    /** the control messages a networked client would have sent, encoded (newest last, at most 16) */
    this.sent = [];
  }

  /** Asks to play cutscene `id` where the player is; resolves to the phase it plays in (null: the local layer). */
  async request(id) {
    this.send({ t: 'cutscene', op: 'request', id });
    return { phase: null, offline: true };
  }

  /** The cutscene ended, or was skipped. */
  done(id, skipped) {
    this.send({ t: 'cutscene', op: 'done', id, skipped });
  }

  send(msg) {
    this.sent.push(encodeClientMessage(msg));
    if (this.sent.length > 16) this.sent.shift();
  }
}
