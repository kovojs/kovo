/** Orientation model used by roving-focus and keyboard navigation helpers. */
export type CollectionOrientation = 'both' | 'horizontal' | 'vertical';
/** Text direction used to interpret horizontal arrow-key navigation. */
export type TextDirection = 'ltr' | 'rtl';

/** Logical navigation intent derived from keyboard input. */
export type NavigationIntent = 'first' | 'last' | 'next' | 'previous';

/** Options for deriving a logical navigation intent from a keyboard event key. */
export interface NavigationKeyOptions {
  dir?: TextDirection;
  orientation?: CollectionOrientation;
}

/** Collection item metadata used by roving-focus movement helpers. */
export interface NavigationItem {
  disabled?: boolean;
}

/** Options for moving within a roving-focus collection. */
export interface MoveOptions {
  currentIndex: number;
  items: readonly NavigationItem[];
  loop?: boolean;
}

const verticalKeys = new Map<string, NavigationIntent>([
  ['ArrowDown', 'next'],
  ['ArrowUp', 'previous'],
]);

export function navigationIntentFromKey(
  key: string,
  options: NavigationKeyOptions = {},
): NavigationIntent | undefined {
  const orientation = options.orientation ?? 'both';

  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (orientation !== 'horizontal') {
    const verticalIntent = verticalKeys.get(key);
    if (verticalIntent) return verticalIntent;
  }
  if (orientation !== 'vertical') {
    return horizontalIntentFromKey(key, options.dir ?? 'ltr');
  }

  return undefined;
}

export function moveCollectionIndex(intent: NavigationIntent, options: MoveOptions): number {
  const { currentIndex, items, loop = true } = options;
  if (items.length === 0) return -1;

  if (intent === 'first') return firstEnabledIndex(items);
  if (intent === 'last') return lastEnabledIndex(items);

  const step = intent === 'next' ? 1 : -1;
  let index = currentIndex;

  for (let count = 0; count < items.length; count += 1) {
    const nextIndex = index + step;
    if (nextIndex < 0 || nextIndex >= items.length) {
      if (!loop) return currentIndex;
      index = step > 0 ? 0 : items.length - 1;
    } else {
      index = nextIndex;
    }

    if (!items[index]?.disabled) return index;
  }

  return currentIndex;
}

function horizontalIntentFromKey(key: string, dir: TextDirection): NavigationIntent | undefined {
  if (key === 'ArrowRight') return dir === 'rtl' ? 'previous' : 'next';
  if (key === 'ArrowLeft') return dir === 'rtl' ? 'next' : 'previous';
  return undefined;
}

function firstEnabledIndex(items: readonly NavigationItem[]): number {
  return items.findIndex((item) => !item.disabled);
}

function lastEnabledIndex(items: readonly NavigationItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!items[index]?.disabled) return index;
  }
  return -1;
}
