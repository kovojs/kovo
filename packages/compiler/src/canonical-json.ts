/**
 * @internal Deterministic JSON serialization: object keys are sorted and `undefined`
 * values dropped, recursively. FN2 (plans/compiler-refactoring.md): the single shared
 * serializer behind `factHash` (fnv1a), `compilerBuildId` (sha256), and the in-memory /
 * persistent compile caches (sha256), so the four byte-identical copies cannot drift.
 * Only the serializer is shared — each caller keeps its own intentional hash function.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
