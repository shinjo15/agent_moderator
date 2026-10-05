// Nanoseconds preserve exact inclusive boundaries; only strings cross IPC.
export function publicationTime(value: unknown): bigint | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, local, fraction = '', zone] = match;
  const localTime = Date.parse(`${local}Z`);
  if (!Number.isFinite(localTime) || new Date(localTime).toISOString().slice(0, 19) !== local) return undefined;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return undefined;
  const time = Date.parse(`${local}${zone}`);
  if (!Number.isFinite(time)) return undefined;
  return BigInt(time) * 1000000n + BigInt(fraction.padEnd(9, '0'));
}
