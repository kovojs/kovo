import {
  compilerArrayIsArray,
  compilerArrayLength,
  compilerJsonStringify,
  compilerObjectKeys,
  compilerOwnDataValue,
} from './compiler-security-intrinsics.js';

/**
 * @internal Deterministic JSON serialization: object keys are sorted and `undefined`
 * values dropped, recursively. FN2 (plans/compiler-refactoring.md): the single shared
 * serializer behind compact compile-fact, render-plan, and HMR fingerprints. Hashes serve as
 * diagnostic/provenance identities rather than replacing authored input bytes.
 */
export function canonicalJson(value: unknown): string {
  if (compilerArrayIsArray(value)) {
    const length = compilerArrayLength(value, 'Canonical JSON array');
    let result = '[';
    for (let index = 0; index < length; index += 1) {
      if (index > 0) result += ',';
      const entry = compilerOwnDataValue(value, index, 'Canonical JSON array');
      // Match JSON's array semantics: an own `undefined` slot (and a sparse hole, which the
      // compiler treats equivalently here) is `null`, never an omitted byte sequence. Omitting the
      // value aliased `[]` with `[undefined]` and made mixed arrays produce non-JSON holes, so the
      // canonical identity was not injective over the accepted input domain (SPEC §5.2.1).
      result += entry === undefined ? 'null' : canonicalJson(entry);
    }
    return `${result}]`;
  }
  if (value && typeof value === 'object') {
    const keys = compilerObjectKeys(value);
    for (let index = 1; index < keys.length; index += 1) {
      const key = keys[index]!;
      let insertAt = index;
      while (insertAt > 0 && key < keys[insertAt - 1]!) {
        keys[insertAt] = keys[insertAt - 1]!;
        insertAt -= 1;
      }
      keys[insertAt] = key;
    }
    let result = '{';
    let included = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const entry = compilerOwnDataValue(value, key, 'Canonical JSON object');
      if (entry === undefined) continue;
      if (included > 0) result += ',';
      const encodedKey = compilerJsonStringify(key);
      if (encodedKey === undefined) throw new TypeError('Canonical JSON key could not be encoded.');
      result += `${encodedKey}:${canonicalJson(entry)}`;
      included += 1;
    }
    return `${result}}`;
  }

  const encoded = compilerJsonStringify(value);
  return encoded as string;
}
