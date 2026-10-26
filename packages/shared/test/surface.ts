// A rocky world's surface planned as the client's Planet plans it: cities first, then sites clear of them, then the ground
// levelled under both.
import { TerrainSampler, cityPads, planCities, planSites, sitePads, type PlanetParams } from '../src/world/index.ts';

export function withoutPads(p: PlanetParams): PlanetParams {
  const rest = { ...p };
  delete rest.pads;
  return rest;
}

/** Plans on a copy of `generated` (createPlanetParams' output), which is left as it was. */
export function planSurface(generated: PlanetParams) {
  const params = { ...generated };
  const bare = withoutPads(params);
  const sampler = new TerrainSampler(params);
  const cities = planCities(params, sampler);
  const sites = planSites(params, sampler, cities);
  params.pads = [...cityPads(cities), ...sitePads(sites)];
  sampler.setPads(params.pads);
  return { params, bare, sampler, cities, sites };
}
