const refuse = (operation: string): never => {
  throw new TypeError(`this map is immutable and cannot be ${operation}`);
};

export class FrozenMap<K, V> extends Map<K, V> {
  constructor(entries: Iterable<readonly [K, V]>) {
    super();
    for (const [key, value] of entries) super.set(key, value);
  }

  override set(_key: K, _value: V): this {
    return refuse('modified');
  }

  override delete(_key: K): boolean {
    return refuse('modified');
  }

  override clear(): void {
    refuse('cleared');
  }
}

export const frozenMapOf = <K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> =>
  new FrozenMap<K, V>(entries);
