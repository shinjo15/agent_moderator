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
