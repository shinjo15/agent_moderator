import { categories, validThresholds, type Values } from './policy';
import { FILTER_PRESETS, validThreshold } from './threshold';

export type Preset = keyof typeof FILTER_PRESETS;
export type CustomFilter = { mode: 'bulk' | 'individual'; bulk: number; individual: Values };
export type FilterConfig = { active: Preset | 'custom'; custom: CustomFilter | null };
export type EffectiveThreshold = number | Values;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function uniformThresholds(value: number): Values {
  return Object.fromEntries(categories.map(key => [key, value])) as Values;
}
export function validFilterConfig(value: unknown): value is FilterConfig {
  if (!object(value) || Object.keys(value).length !== 2 || typeof value.active !== 'string' || !['high', 'medium', 'low', 'custom'].includes(value.active)) return false;
  const custom = value.custom;
  if (custom === null) return value.active !== 'custom';
  return object(custom) && Object.keys(custom).length === 3 && (custom.mode === 'bulk' || custom.mode === 'individual')
    && validThreshold(custom.bulk) && validThresholds(custom.individual);
}
export function configFromScalar(threshold: number): FilterConfig {
  const preset = (Object.keys(FILTER_PRESETS) as Preset[]).find(key => FILTER_PRESETS[key] === threshold);
  return preset ? { active: preset, custom: null }
    : { active: 'custom', custom: { mode: 'bulk', bulk: threshold, individual: uniformThresholds(threshold) } };
}
export function effectiveThreshold(config: FilterConfig): EffectiveThreshold {
  if (config.active !== 'custom') return FILTER_PRESETS[config.active];
  const custom = config.custom!;
  return custom.mode === 'bulk' ? custom.bulk : { ...custom.individual };
}
export function mergeFilterConfig(existing: FilterConfig, request: FilterConfig): FilterConfig {
  if (request.active !== 'custom') return { active: request.active, custom: existing.custom };
  if (existing.custom === null) return structuredClone(request);
  const custom = request.custom!;
  return { active: 'custom', custom: custom.mode === 'bulk'
    ? { ...existing.custom, mode: 'bulk', bulk: custom.bulk }
    : { ...existing.custom, mode: 'individual', individual: { ...custom.individual } } };
}
export function sameFilterConfig(a: FilterConfig, b: FilterConfig): boolean {
  return a.active === b.active && (a.custom === null ? b.custom === null : b.custom !== null
    && a.custom.mode === b.custom.mode && a.custom.bulk === b.custom.bulk
    && categories.every(key => a.custom!.individual[key] === b.custom!.individual[key]));
}
export function sameActiveFilter(a: FilterConfig, b: FilterConfig): boolean {
  if (a.active !== b.active) return false;
  if (a.active !== 'custom') return true;
  const left = a.custom!; const right = b.custom!;
  return left.mode === right.mode && (left.mode === 'bulk' ? left.bulk === right.bulk
    : categories.every(key => left.individual[key] === right.individual[key]));
}
