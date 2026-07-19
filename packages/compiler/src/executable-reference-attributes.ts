import {
  compilerArrayLength,
  compilerOwnDataValue,
  compilerStringStartsWith,
  compilerStringToLowerCase,
} from './compiler-security-intrinsics.js';

export type KovoExecutableReferenceAttributeKind =
  | 'derive'
  | 'handler'
  | 'module-allowlist'
  | 'stream-renderer';

export interface KovoExecutableReferenceAttributeInventoryEntry {
  readonly kind: KovoExecutableReferenceAttributeKind;
  readonly match: 'exact' | 'prefix';
  readonly selector: string;
}

/**
 * SPEC §4.3/§4.8/§5.2: the finite HTML attribute families whose values can select executable
 * module/export authority at runtime. Both the authored-provenance gate and the runtime-selected
 * value gate consume this exact inventory so case folding, prefixes, and value policy cannot drift.
 */
export const kovoExecutableReferenceAttributeInventory: readonly KovoExecutableReferenceAttributeInventoryEntry[] =
  [
    { kind: 'handler', match: 'prefix', selector: 'on:' },
    { kind: 'derive', match: 'exact', selector: 'data-bind' },
    { kind: 'derive', match: 'prefix', selector: 'data-bind:' },
    {
      kind: 'derive',
      match: 'prefix',
      selector: 'data-bind-prop:',
    },
    {
      kind: 'stream-renderer',
      match: 'exact',
      selector: 'data-stream-renderer',
    },
    {
      kind: 'module-allowlist',
      match: 'exact',
      selector: 'data-kovo-module-allowlist',
    },
  ];

/** Return the runtime executable-reference family for one ASCII-case-insensitive HTML name. */
export function kovoExecutableReferenceAttributeKind(
  name: string,
): KovoExecutableReferenceAttributeKind | undefined {
  return executableReferenceAttributeEntry(name)?.kind;
}

function executableReferenceAttributeEntry(
  name: string,
): KovoExecutableReferenceAttributeInventoryEntry | undefined {
  const lower = compilerStringToLowerCase(name);
  const length = compilerArrayLength(
    kovoExecutableReferenceAttributeInventory,
    'Executable-reference attribute inventory',
  );
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(
      kovoExecutableReferenceAttributeInventory,
      index,
      'Executable-reference attribute inventory',
    ) as KovoExecutableReferenceAttributeInventoryEntry | undefined;
    if (!entry) {
      throw new TypeError(`Executable-reference attribute inventory[${index}] must be dense.`);
    }
    if (
      (entry.match === 'exact' && lower === entry.selector) ||
      (entry.match === 'prefix' && compilerStringStartsWith(lower, entry.selector))
    ) {
      return entry;
    }
  }
  return undefined;
}
