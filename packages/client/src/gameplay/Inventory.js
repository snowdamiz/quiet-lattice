// Resources, prices and the player's inventory.
export const RESOURCES = {
  carbon: { name: 'Carbon', color: '#e2463f', price: 12 },
  ferrite: { name: 'Ferrite Dust', color: '#b9b4ad', price: 14 },
  sodium: { name: 'Sodium', color: '#ffcc3a', price: 41 },
  oxygen: { name: 'Oxygen', color: '#ff6a55', price: 34 },
  dihydrogen: { name: 'Di-hydrogen', color: '#4fb2ff', price: 34 },
  copper: { name: 'Copper', color: '#ff9a3a', price: 110 },
  cobalt: { name: 'Cobalt', color: '#4f7dff', price: 198 },
  tritium: { name: 'Tritium', color: '#9be8ff', price: 6 },
  gold: { name: 'Gold', color: '#ffd84a', price: 202 },
};

export class Inventory {
  constructor() {
    this.items = {};
    this.units = 2500;
    this.warpCells = 1;
    this.capacity = 9999;
  }

  add(id, n) {
    this.items[id] = Math.min(this.capacity, (this.items[id] || 0) + n);
  }

  has(id, n) {
    return (this.items[id] || 0) >= n;
  }

  take(id, n) {
    if (!this.has(id, n)) return false;
    this.items[id] -= n;
    return true;
  }

  sellAll(id) {
    const n = this.items[id] || 0;
    const price = RESOURCES[id].price;
    this.items[id] = 0;
    this.units += n * price;
    return n * price;
  }

  key() {
    return JSON.stringify(this.items) + this.units + '|' + this.warpCells;
  }
}
