import { validThreshold } from './threshold';
// Fixed diagnostic vocabulary only. Never derive codes/messages from an exception or payload.
export const filterFailureReasons = ['authorization', 'initialize', 'read', 'write', 'readback', 'invalidStored', 'invalidInput', 'unavailable'] as const;
export type FilterSettingsReason = typeof filterFailureReasons[number];
export type FilterDiagnosticReason = FilterSettingsReason | 'transport' | 'noResponse' | 'inconsistentResponse'
  | 'responseDeniedLegacy' | 'unknownFailureCode' | 'invalidShape' | 'valueMismatch';
export type FilterResponseShape = { object: boolean; okTrue: boolean; okFalse: boolean; valueObject: boolean; thresholdNumber: boolean; thresholdValid: boolean };
export type FilterStage = 'initialGet' | 'save' | 'readback';
export function validFilterFailureReason(value: unknown): value is FilterSettingsReason {
  return typeof value === 'string' && (filterFailureReasons as readonly string[]).includes(value);
}
export class FilterSettingsFailure extends Error {
  constructor(readonly code: FilterDiagnosticReason, readonly shape?: FilterResponseShape) { super('Filter settings operation failed'); }
}

export function publicThreshold(response: unknown): number {
  if (response === undefined || response === null) throw new FilterSettingsFailure('noResponse');
  const object = typeof response === 'object' && !Array.isArray(response) ? response as Record<string, unknown> : undefined;
  const value = object && typeof object.value === 'object' && object.value !== null && !Array.isArray(object.value)
    ? object.value as Record<string, unknown> : undefined;
  const threshold = value?.threshold;
  const shape = { object: object !== undefined, okTrue: object?.ok === true, okFalse: object?.ok === false,
    valueObject: value !== undefined, thresholdNumber: typeof threshold === 'number', thresholdValid: validThreshold(threshold) };
  if (object?.ok === false) {
    if (validFilterFailureReason(object.code)) throw new FilterSettingsFailure(object.code);
    // Compare only our known historical denial; never render arbitrary response.error/code.
    const legacy = object.code === undefined && object.error === 'この要求は許可されていません。';
    throw new FilterSettingsFailure(legacy ? 'responseDeniedLegacy' : 'unknownFailureCode', shape);
  }
  if (!object || object.ok !== true || !value || !validThreshold(threshold)) throw new FilterSettingsFailure('invalidShape', shape);
  return threshold;
}
