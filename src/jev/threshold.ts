export const DEFAULT_THRESHOLD = 0.8;
export const FILTER_PRESETS = { high: 0.65, medium: DEFAULT_THRESHOLD, low: 0.9 } as const;
export function validThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
export function parseThresholdInput(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return validThreshold(number) ? number : undefined;
}
