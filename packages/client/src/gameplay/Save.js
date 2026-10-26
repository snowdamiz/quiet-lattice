// Persistent progress in localStorage (inventory, upgrades, discoveries, current system).
// v2: worlds and orbits were rescaled, so older positions no longer line up
const KEY = 'next-horizon-save-v2';

// the game was called Astra Nullius: carry a save (and the settings) over from under the old name
try {
  for (const [from, to] of [['astra-nullius-save-v2', KEY], ['astra-nullius-settings', 'next-horizon-settings']]) {
    const old = localStorage.getItem(from);
    if (old !== null && localStorage.getItem(to) === null) localStorage.setItem(to, old);
    localStorage.removeItem(from);
  }
} catch {
  /* storage unavailable */
}

// what each hazard upgrade does to the starship (on purchase, and again when a save is loaded)
export function applyUpgrade(game, id) {
  const r = game.ship.resist;
  if (id === 'thermal') r.heat = r.cryo = 3;
  if (id === 'pressure') r.pressure = 3;
  if (id === 'coating') r.acid = r.radiation = r.storm = 3;
}

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function saveGame(game) {
  if (game.mode === 'title') return false;
  const data = {
    v: 1,
    systemId: game.galaxy.current.id,
    visited: game.galaxy.systems.filter((s) => s.visited).map((s) => s.id),
    items: game.inventory.items,
    units: game.inventory.units,
    warpCells: game.inventory.warpCells,
    // the suit and cargo pods as laid out (items, units and warpCells stay for older builds)
    inventory: game.inventory.snapshot(),
    bought: [...game.menus.bought],
    discovered: [...game.discoveredNames],
    species: [...game.fauna.scannedNames],
    sites: [...game.structures.visited],
    cities: [...game.cities.met],
    greeted: [...game.cities.citizens.greeted],
    hints: game.hints || {},
    objective: game.objectives.index,
    docked: !!game.objectives.flags.docked,
    shield: game.ship.shield,
    hull: game.ship.hull,
    pulseFuel: game.ship.pulseFuel,
    time: game.time,
  };
  // out between the stars: where exactly (the galactic anchor, and the ship about it)
  const u = game.universe;
  if (u.deep) {
    const st = game.ship.state;
    data.deep = { anchor: u.anchor.toArray(), pos: st.pos.toArray(), quat: st.quat.toArray() };
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function applySave(game, data) {
  const sys = game.galaxy.systems[data.systemId] || game.galaxy.systems[0];
  for (const id of data.visited || []) if (game.galaxy.systems[id]) game.galaxy.systems[id].visited = true;
  game.galaxy.setCurrent(sys);
  game.time = data.time || 0;
  if (sys !== game.system?.info) game.loadSystem(sys);
  if (!(data.inventory && game.inventory.restore(data.inventory))) {
    game.inventory.items = { ...(data.items || {}) };
    game.inventory.units = data.units ?? game.inventory.units;
    game.inventory.warpCells = data.warpCells ?? game.inventory.warpCells;
  }
  for (const id of data.bought || []) {
    game.menus.bought.add(id);
    if (id === 'beam') game.multitool.upgrade();
    if (id === 'jet') game.player.jetEfficiency = 2;
    if (id === 'thrust') game.ship.speedMul = 1.25;
    applyUpgrade(game, id);
  }
  for (const n of data.discovered || []) game.discoveredNames.add(n);
  for (const n of data.species || []) game.fauna.scannedNames.add(n);
  for (const n of data.sites || []) game.structures.visited.add(n);
  for (const n of data.cities || []) game.cities.met.add(n);
  for (const n of data.greeted || []) game.cities.citizens.greeted.add(n);
  game.hints = { ...(data.hints || {}) };
  game.objectives.restore(data.objective);
  game.objectives.flags.docked = !!data.docked;
  game.ship.shield = data.shield ?? 100;
  game.ship.hull = data.hull ?? 100;
  game.ship.pulseFuel = data.pulseFuel ?? 100;
  game.pendingDeep = data.deep || null;
}
