export interface TypeaheadState {
  readonly buffer: string;
  readonly updatedAt: number;
}

export interface TypeaheadItem {
  disabled?: boolean;
  textValue: string;
}

export interface TypeaheadMatchOptions {
  currentIndex?: number;
  items: readonly TypeaheadItem[];
  loop?: boolean;
  search: string;
}

export const defaultTypeaheadTimeoutMs = 700;

export function nextTypeaheadState(
  state: TypeaheadState | undefined,
  key: string,
  now: number,
  timeoutMs = defaultTypeaheadTimeoutMs,
): TypeaheadState {
  if (!isTypeaheadKey(key)) return state ?? { buffer: '', updatedAt: now };

  const normalizedKey = key.toLocaleLowerCase();
  const previousBuffer = state && now - state.updatedAt <= timeoutMs ? state.buffer : '';
  const buffer = isRepeatedTypeaheadKey(previousBuffer, normalizedKey)
    ? normalizedKey
    : `${previousBuffer}${normalizedKey}`;

  return {
    buffer,
    updatedAt: now,
  };
}

export function findTypeaheadMatch(options: TypeaheadMatchOptions): number {
  const { currentIndex = -1, items, loop = true, search } = options;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  if (!normalizedSearch || items.length === 0) return -1;

  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const orderedIndexes = loop
    ? [...range(startIndex, items.length), ...range(0, startIndex)]
    : [...range(startIndex, items.length)];

  for (const index of orderedIndexes) {
    const item = items[index];
    if (!item || item.disabled) continue;
    if (item.textValue.trim().toLocaleLowerCase().startsWith(normalizedSearch)) {
      return index;
    }
  }

  return -1;
}

function isTypeaheadKey(key: string): boolean {
  return key.length === 1 && key.trim() !== '';
}

function isRepeatedTypeaheadKey(buffer: string, key: string): boolean {
  return buffer.length > 0 && buffer.split('').every((char) => char === key);
}

function range(start: number, end: number): number[] {
  const values: number[] = [];
  for (let index = start; index < end; index += 1) values.push(index);
  return values;
}
