export interface Domain<Key extends string = string> {
  key: Key;
}

export function domain<const Key extends string>(key: Key): Domain<Key> {
  return { key };
}

export type Tag<Key extends string = string> = Domain<Key>;

export function tag<const Key extends string>(key: Key): Tag<Key> {
  return domain(key);
}
