// A light guided path through the core loop, shown under the location panel.
const GATHER = 25;
export class Objectives {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.timer = 0;
    this.flags = {};
    this.steps = [
      { text: (g) => `Land on ${g.system.homePlanet.name}`, done: (g) => g.ship.mode === 'landed' && g.ship.frame?.sampler },
      // (a deposit or two: at 40 the step outlasted a whole first visit)
      { text: (g) => `Gather resources · ${Math.min(GATHER, totalItems(g))}/${GATHER}`, done: (g) => totalItems(g) >= GATHER },
      { text: () => 'Find a point of interest', done: (g) => g.structures.visited.size > 0 },
      { text: () => 'Analyze a creature', done: (g) => g.fauna.scannedNames.size > 0 },
      { text: () => 'Return to orbit', done: (g) => g.mode === 'ship' && g.ship.frame?.sampler && g.ship.atmoDensity < 0.002 },
      { text: () => 'Dock at the station', done: (g) => this.flags.docked },
      { text: () => 'Reach another star system', done: (g) => g.galaxy.systems.filter((s) => s.visited).length > 1 },
    ];
  }

  restore(index) {
    this.index = index || 0;
  }

  update(dt) {
    const g = this.game;
    if (g.mode === 'title') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    // after a discovery banner, not on top of it (the same success was reported three times at once)
    if (g.hud.now() < (g.hud.bannerUntil || 0)) return;
    // skip already-satisfied steps (e.g. after loading a save, or a creature analyzed early): one
    // notice for the step that is actually next, not one per step skipped
    const from = this.index;
    while (this.index < this.steps.length && this.steps[this.index].done(g)) this.index++;
    if (this.index === from) return;
    if (this.index < this.steps.length) {
      g.hud.toast(`Next: ${this.steps[this.index].text(g)}`, 'good');
      g.audio.play('sell');
    } else {
      g.hud.showBanner('THE STARS ARE YOURS', 'Training complete', ['Explore freely. There is always another horizon.']);
    }
  }

  get current() {
    return this.index < this.steps.length ? this.steps[this.index].text(this.game) : null;
  }
}

function totalItems(g) {
  return Object.values(g.inventory.items).reduce((a, b) => a + b, 0);
}
