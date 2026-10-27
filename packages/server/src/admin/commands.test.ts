// The CLI's argument parser and the command schemas the admin channel validates with.
import { describe, expect, it } from 'vitest';
import { AdminCommand, parseCommand } from './commands.ts';

const ok = (args: string[]) => {
  const r = parseCommand(args);
  if (!r.ok) throw new Error(r.error);
  return r.command;
};
const error = (args: string[]) => {
  const r = parseCommand(args);
  if (r.ok) throw new Error(`parsed: ${JSON.stringify(r.command)}`);
  return r.error;
};

describe('admin command parsing', () => {
  it('parses every command into what the channel accepts', () => {
    const commands = [
      ok(['who']),
      ok(['zones']),
      ok(['metrics']),
      ok(['teleport', 'Ves Ka', '12', 'station', 'docked']),
      ok(['teleport', 'ves', '0', '3', 'surface:10,20', 'mode=landed']),
      ok(['teleport', 'ves', '0', 'inertial', '1e9,0,-5']),
      ok(['grant', 'ves', 'ferrite', '120']),
      ok(['grant', 'ves', 'units', '-500']),
      ok(['spawn', '0', 'herd', 'species=1', 'near=Ves', 'count=3', 'level=4']),
      ok(['spawn', '0', 'herd', 'species=0', 'body=2', 'at=100,0,0']),
      ok(['spawn', '4', 'entity', 'kind=npc', 'frame=station', 'at=1,2,3', 'name=Trader']),
      ok(['despawn', '4', '17']),
      ok(['set-quest-step', 'ves', 'first_light', '2']),
      ok(['set-skill-points', 'ves', '12']),
      ok(['mute', 'someone']),
      ok(['mute', 'someone', '90']),
      ok(['unmute', 'someone']),
    ];
    for (const c of commands) expect(AdminCommand.parse(c)).toEqual(c);
    expect(commands[3]).toEqual({ cmd: 'teleport', character: 'Ves Ka', system: 12, frame: 'station', pose: 'docked' });
    expect(commands[4]).toMatchObject({ pose: 'surface:10,20', mode: 'landed' });
    expect(commands[7]).toEqual({ cmd: 'grant', character: 'ves', what: 'units', count: -500 });
    expect(commands[8]).toEqual({ cmd: 'spawn', system: 0, spec: { kind: 'herd', species: 1, near: 'Ves', count: 3, level: 4 } });
    expect(commands[9]).toMatchObject({ spec: { body: 2, at: [100, 0, 0] } });
    expect(commands[10]).toEqual({ cmd: 'spawn', system: 4, spec: { kind: 'entity', entity: 'npc', frame: 'station', at: [1, 2, 3], name: 'Trader' } });
    expect(commands[14]).toEqual({ cmd: 'mute', account: 'someone' });
    expect(commands[15]).toEqual({ cmd: 'mute', account: 'someone', seconds: 90 });
  });

  it('says what is wrong with bad arguments', () => {
    expect(error([])).toBe('no command given');
    expect(error(['fly'])).toBe('unknown command fly');
    expect(error(['who', 'extra'])).toMatch(/too many arguments/);
    expect(error(['teleport', 'ves', '0', 'station'])).toBe('missing <pose>');
    expect(error(['teleport', 'ves', 'zero', 'station', 'docked'])).toMatch(/^system: /);
    expect(error(['teleport', 'ves', '0', 'station', 'docked', 'mode=warp'])).toMatch(/^mode: /);
    expect(error(['teleport', 'ves', '0', 'station', 'docked', 'speed=3'])).toBe('unknown option speed=');
    expect(error(['grant', 'ves', 'ferrite', '0'])).toMatch(/count must not be 0/);
    expect(error(['grant', 'ves', 'ferrite', '1.5'])).toMatch(/^count: /);
    expect(error(['spawn', '0', 'herd', 'species=1'])).toMatch(/needs near=/);
    expect(error(['spawn', '0', 'dragon'])).toMatch(/herd. or .entity/);
    expect(error(['spawn', '0', 'entity', 'kind=mob', 'frame=station', 'at=0,0,0'])).toMatch(/^spec.entity: /);
    expect(error(['spawn', '0', 'entity', 'kind=npc', 'frame=station', 'at=0,0'])).toMatch(/^spec.at/);
    expect(error(['set-skill-points', 'ves', '-1'])).toMatch(/^points: /);
    expect(error(['mute', 'x', '0'])).toMatch(/^seconds: /);
    expect(error(['mute', 'x', String(8 * 86400)])).toMatch(/^seconds: /);
  });

  it('refuses commands the channel is sent that the CLI would never make', () => {
    expect(AdminCommand.safeParse({ cmd: 'who', extra: 1 }).success).toBe(false);
    expect(AdminCommand.safeParse({ cmd: 'drop-table' }).success).toBe(false);
    expect(AdminCommand.safeParse({ cmd: 'grant', character: 'x', what: 'ferrite', count: 2e9 }).success).toBe(false);
    expect(AdminCommand.safeParse({ cmd: 'teleport', character: 'x'.repeat(65), system: 0, frame: 'station', pose: 'docked' }).success).toBe(false);
  });
});
