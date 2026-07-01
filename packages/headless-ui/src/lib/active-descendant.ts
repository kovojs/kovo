export interface ActiveDescendantOptions<TValue> {
  fallbackId: (value: TValue) => string | undefined;
  highlightedValue: TValue | undefined;
  itemId: (value: TValue) => string | undefined;
}

export function activeDescendantId<TValue>(
  options: ActiveDescendantOptions<TValue>,
): string | undefined {
  if (options.highlightedValue === undefined) return undefined;
  return options.itemId(options.highlightedValue) ?? options.fallbackId(options.highlightedValue);
}

export function describedByIds(...ids: ReadonlyArray<string | undefined>): string {
  return ids.filter((id): id is string => id !== undefined && id.length > 0).join(' ');
}
