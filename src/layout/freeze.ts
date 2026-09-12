const isFreezable = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

export const deepFreeze = <T>(value: T): T => {
  if (!isFreezable(value) || Object.isFrozen(value)) return value;
  if (value instanceof Map) {
    for (const entry of value.values()) deepFreeze(entry);
    return value;
  }
  if (value instanceof Set) {
    for (const entry of value.values()) deepFreeze(entry);
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
};
