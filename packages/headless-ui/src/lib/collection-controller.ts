import {
  moveCollectionIndex,
  navigationIntentFromKey,
  type CollectionOrientation,
  type NavigationItem,
  type TextDirection,
} from './keyboard-navigation.js';
import { findTypeaheadMatch, nextTypeaheadState, type TypeaheadState } from './typeahead.js';

/** Item shape normalized before primitive-specific collection movement. */
export interface CollectionControllerItem<Value extends string = string> extends NavigationItem {
  textValue?: string | undefined;
  value: Value;
}

/** Options shared by roving-focus and active-descendant collection movement. */
export interface CollectionMoveOptions<Value extends string = string> {
  currentValue?: Value | undefined;
  dir?: TextDirection | undefined;
  disabled?: boolean | undefined;
  items: readonly CollectionControllerItem<Value>[];
  key: string;
  loop?: boolean | undefined;
  orientation?: CollectionOrientation | undefined;
}

/** Normalized movement result for primitive wrappers. */
export interface CollectionMoveResult<Value extends string = string> {
  highlightedIndex: number;
  highlightedValue: Value | undefined;
}

/** Options shared by collection typeahead handlers. */
export interface CollectionTypeaheadOptions<Value extends string = string> {
  currentValue?: Value | undefined;
  disabled?: boolean | undefined;
  items: readonly CollectionControllerItem<Value>[];
  loop?: boolean | undefined;
  now: number;
  state?: TypeaheadState | undefined;
  timeoutMs?: number | undefined;
}

/** Normalized typeahead result for primitive wrappers. */
export interface CollectionTypeaheadResult<Value extends string = string> {
  matchIndex: number;
  state: TypeaheadState;
  value: Value | undefined;
}

/** Project arbitrary primitive items into the shared collection controller shape. */
export function projectCollectionItems<Item, Value extends string = string>(
  items: readonly Item[] | undefined,
  projector: (item: Item) => CollectionControllerItem<Value>,
): readonly CollectionControllerItem<Value>[] {
  return Object.freeze((items ?? []).map((item) => Object.freeze(projector(item))));
}

/** Compute Home/End/arrow movement across projected items. */
export function moveCollection<Value extends string = string>(
  options: CollectionMoveOptions<Value>,
): CollectionMoveResult<Value> | undefined {
  if (options.disabled) return undefined;

  const intent = navigationIntentFromKey(options.key, {
    ...(options.dir === undefined ? {} : { dir: options.dir }),
    orientation: options.orientation ?? 'vertical',
  });
  if (intent === undefined) return undefined;

  const currentIndex = options.items.findIndex((item) => item.value === options.currentValue);
  const highlightedIndex = moveCollectionIndex(intent, {
    currentIndex,
    items: options.items,
    ...(options.loop === undefined ? {} : { loop: options.loop }),
  });

  return {
    highlightedIndex,
    highlightedValue: highlightedIndex < 0 ? undefined : options.items[highlightedIndex]?.value,
  };
}

/** Compute a buffered typeahead match across projected items. */
export function typeaheadCollection<Value extends string = string>(
  key: string,
  options: CollectionTypeaheadOptions<Value>,
): CollectionTypeaheadResult<Value> {
  const state = nextTypeaheadState(
    options.disabled ? undefined : options.state,
    key,
    options.now,
    options.timeoutMs,
  );
  if (options.disabled || state.buffer === '') {
    return { matchIndex: -1, state, value: options.currentValue };
  }

  const matchIndex = findTypeaheadMatch({
    currentIndex: options.items.findIndex((item) => item.value === options.currentValue),
    items: options.items.map((item) => ({
      ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
      textValue: item.textValue ?? item.value,
    })),
    ...(options.loop === undefined ? {} : { loop: options.loop }),
    search: state.buffer,
  });

  return {
    matchIndex,
    state,
    value: matchIndex < 0 ? options.currentValue : options.items[matchIndex]?.value,
  };
}
