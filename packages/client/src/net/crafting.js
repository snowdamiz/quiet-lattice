// The client's side of the fabricators (docs/ARCHITECTURE.md §23, DESIGN 15.7): crafts are the server's. The client keeps
// the recipes its character knows (the server's `recipes` state), asks for a craft or a lesson (`craft {seq, op}`) and
// hears the answer; what a craft used and made arrives as the inventory's own state. Before asking, it checks the request
// with the shared rules the server applies (known, made at that fabricator, materials, room), so a request the server
// would refuse for those never leaves and the panel says why at once. In the dev sandbox (offline, nothing kept) the
// same shared rules make the craft on the client's own inventory, so the fabricator screens can be reviewed without a
// server.
import { craft, learn, makeProblem, recipeById, startingKnowledge } from '@astra/shared/crafting';

/** How long a request may go unanswered before the panel stops waiting for it (the gateway drops an over-budget message
 * without a reply), ms. */
export const CRAFT_PENDING_MS = 5000;

export class Crafting {
  constructor(game) {
    this.game = game;
    /** The recipes the character knows: the server's once in the world; the sandbox's pilot knows the starting ones. */
    this.known = startingKnowledge().known;
    this.net = null;
    this.seq = 0;
    /** Requests sent and not yet answered: seq → { op, at } (`at` the time sent, ms). */
    this.pending = new Map();
    this.listeners = new Set();
    /** Bumped whenever the known recipes change, so screens can tell when to redraw. */
    this.rev = 0;
  }

  /** Follows a connection (Game.enterWorld): its `recipes` state and `craft` answers; each session numbers from 1. */
  link(net) {
    this.net = net;
    net.on('welcome', () => {
      this.seq = 0;
      this.pending.clear();
    });
    net.on('recipes', (m) => {
      this.known = [...m.known];
      this.rev++;
    });
    net.on('craft', (m) => {
      if (!this.pending.delete(m.seq)) return;
      this.emit(m);
    });
  }

  /** Hears every answer (the server's, or the sandbox's own). Returns the unsubscribe. */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(m) {
    for (const fn of [...this.listeners]) fn(m);
  }

  knows(recipe) {
    return this.known.includes(recipe);
  }

  /** Whether a request is still waiting for its answer (one at a time from the panel). */
  get waiting() {
    const now = performance.now();
    for (const [seq, p] of this.pending) if (now - p.at > CRAFT_PENDING_MS) this.pending.delete(seq);
    return this.pending.size > 0;
  }

  /**
   * Asks fabricator `at` ('station' | 'ship') for `count` crafts of `recipe` in a system of tier `tier`. Returns the
   * refusal the shared rules predict (`not_known`, `fabricator`, `materials`, `no_room`, …: nothing is sent), or null
   * once it is asked; the answer comes to the listeners.
   */
  make(recipe, count, at, tier) {
    const problem = makeProblem(this.game.inventory.state, this.known, recipe, count, at, tier);
    if (problem) return problem;
    return this.ask({ op: 'make', recipe, count, at });
  }

  /** Asks to learn a recipe from its item; the refusal predicted, or null once asked. */
  learn(recipe) {
    const r = learn(this.game.inventory.state, { known: this.known }, recipe);
    if (!r.ok) return r.reason;
    return this.ask({ op: 'learn', recipe });
  }

  ask(op) {
    const seq = ++this.seq;
    if (this.net) {
      if (!this.net.send({ t: 'craft', seq, op })) return 'zone';
      this.pending.set(seq, { op, at: performance.now() });
      return null;
    }
    if (!import.meta.env.DEV) return 'zone';
    // the dev sandbox: the shared rules on the client's own inventory, as the server would apply them
    const inv = this.game.inventory;
    const base = { t: 'craft', seq, op: op.op, recipe: op.recipe };
    if (op.op === 'learn') {
      const r = learn(inv.state, { known: this.known }, op.recipe);
      if (!r.ok) return r.reason;
      inv.restore(r.inv);
      this.known = r.known.known;
      this.rev++;
      this.emit({ ...base, result: 'learned' });
      return null;
    }
    const r = craft(inv.state, recipeById(op.recipe), op.count);
    if (!r.ok) return r.reason;
    inv.restore(r.inv);
    this.emit({ ...base, result: 'made', item: r.item, count: r.made });
    return null;
  }
}
