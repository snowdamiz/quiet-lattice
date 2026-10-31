// How the CLI prints a command's result for a person (the `--json` option prints it as the server sent it).
import type { AdminCommand } from '../admin/commands.ts';
import type { AdminResult } from '../admin/service.ts';

type Row = Record<string, unknown>;

export function format(cmd: AdminCommand, r: AdminResult): string {
  switch (cmd.cmd) {
    case 'who': {
      const online = (r.online as Row[]) ?? [];
      const head = `${online.length} in play, ${String(r.sessions)} socket${r.sessions === 1 ? '' : 's'}`;
      if (online.length === 0) return head;
      return `${head}\n${table(
        ['NAME', 'CHARACTER', 'ACCOUNT', 'ZONE', 'ENTITY', 'MODE', 'FRAME', 'POS'],
        online.map((o) => [o.name, o.character, o.account, o.zone, o.entity, o.mode, o.frame, vec(o.pos)]),
      )}`;
    }
    case 'zones':
      return zoneTable((r.zones as Row[]) ?? []);
    case 'metrics': {
      const loop = r.loop as Row;
      const p = r.persistence as Row;
      const g = r.gateway as Row;
      const pr = r.process as Row;
      return [
        `loop: ${String(loop.tickHz)} Hz, ${String(loop.ticks)} ticks, ${String(loop.skipped)} skipped${loop.running ? '' : ' (stopped)'}`,
        zoneTable((r.zones as Row[]) ?? []),
        `persistence: ${String(p.inPlay)} in play, ${String(p.held)} held, ${String(p.pending)} pending, ${String(p.saved)} saved, ${String(p.stale)} stale, ${String(p.failures)} failed writes, ${String(p.edited)} offline edits`,
        `gateway: ${String(g.sessions)} sockets, ${String(g.invalidMessages)} invalid and ${String(g.rateLimitedMessages)} rate-limited messages`,
        `process: up ${String(pr.uptimeS)} s, rss ${String(pr.rssMb)} MB, heap ${String(pr.heapMb)} MB`,
      ].join('\n');
    }
    case 'teleport': {
      const pose = r.pose as Row;
      const where = `system ${String(r.system)}, frame ${String(pose.frame ?? 'inertial')}, at ${vec(pose.pos)}, mode ${String(r.mode)}`;
      const how =
        r.moved === 'reconnect'
          ? ` (online: saved there at revision ${String(r.revision)} and disconnected; its client reconnects into the new system)`
          : r.online
            ? ' (online)'
            : offline(r);
      return `${String(r.name)} teleported to ${where}${how}`;
    }
    case 'grant': {
      const n = r.count as number;
      const did =
        r.what === 'units'
          ? `${n > 0 ? 'gave' : 'took'} ${Math.abs(n)} units`
          : n > 0
            ? `added ${String(r.added)} ${String(r.what)}${(r.remainder as number) > 0 ? ` (${String(r.remainder)} did not fit)` : ''}`
            : `took ${String(r.taken)} ${String(r.what)}`;
      return `${String(r.name)}: ${did}; ${String(r.units)} units now${r.online ? ' (online)' : offline(r)}`;
    }
    case 'set-skill-points':
      return `${String(r.name)}: ${String(r.available)} skill points available${r.available !== r.asked ? ` (asked ${String(r.asked)}: never below what levels give less what is spent)` : ''}${r.online ? ' (online)' : offline(r)}`;
    case 'set-rep': {
      const rank = r.rank === null ? 'no rank' : `rank ${String(r.rank)}`;
      const titles = (r.titles as string[]).length ? `, earned ${(r.titles as string[]).join(', ')}` : '';
      return `${String(r.name)}: ${String(r.faction)} standing ${String(r.from)} -> ${String(r.rep)} (${rank}${titles})${r.online ? ' (online)' : offline(r)}`;
    }
    case 'set-quest-step':
      return `${String(r.name)}: quest ${String(r.quest)} at step ${String(r.step)}${r.online ? ' (online)' : offline(r)}`;
    case 'spawn':
      return r.herd !== undefined
        ? `herd ${String(r.herd)} of ${String(r.name ?? `species ${String(r.species)}`)} on body ${String(r.body)} in ${String(r.zone)}: entities ${(r.creatures as number[]).join(', ')}`
        : `${String(r.kind)} entity ${String(r.entity)} in ${String(r.zone)} at ${vec(r.pos)} (frame ${String(r.frame ?? 'inertial')})`;
    case 'despawn':
      return `entity ${String(r.entity)} removed from ${String(r.zone)}`;
    case 'mute':
      return `${String(r.username)} muted for ${String(r.seconds)} s`;
    case 'unmute':
      return r.wasMuted ? `${String(r.username)} unmuted` : `${String(r.username)} was not muted`;
    case 'rename':
      return r.name === undefined
        ? `${String(r.kind)} ${String(r.key)} (found by ${String(r.finder)}) keeps its procedural name${r.procedural ? `, ${String(r.procedural)}` : ''}, for good`
        : `${String(r.kind)} ${String(r.key)} (found by ${String(r.finder)}) is now named ${String(r.name)}`;
  }
}

function offline(r: AdminResult): string {
  const changed = (r.changed as string[] | undefined) ?? [];
  return changed.length === 0 ? ' (offline: nothing to change)' : ` (offline: saved ${changed.join(', ')} at revision ${String(r.revision)})`;
}

function zoneTable(zones: Row[]): string {
  if (zones.length === 0) return 'no zones loaded';
  return table(
    ['ZONE', 'SYSTEM', 'TIER', 'STATE', 'ENTITIES', 'SESSIONS', 'P50 MS', 'P95 MS', 'MAX MS', 'OVERRUNS', 'CREATURES', 'CELLS A/S/L'],
    zones.map((z) => {
      const f = z.fauna as { creatures: number; cells: Record<string, number> } | null;
      return [
        z.id,
        z.system,
        z.tier,
        z.asleep ? 'asleep' : 'awake',
        z.entities,
        z.sessions,
        ms(z.p50),
        ms(z.p95),
        ms(z.max),
        z.overruns,
        f ? f.creatures : '-',
        f ? `${f.cells.active}/${f.cells.asleep}/${f.cells.loading}` : '-',
      ];
    }),
  );
}

function table(head: string[], rows: unknown[][]): string {
  const cells = [head, ...rows.map((r) => r.map((c) => (c === null || c === undefined ? '-' : String(c))))];
  const widths = head.map((_, i) => Math.max(...cells.map((r) => r[i]!.length)));
  return cells
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i]!))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function vec(v: unknown): string {
  return Array.isArray(v) ? v.map((x: number) => (Math.abs(x) >= 1000 ? Math.round(x) : Math.round(x * 10) / 10)).join(',') : '-';
}

function ms(v: unknown): string {
  return typeof v === 'number' ? v.toFixed(2) : '-';
}
