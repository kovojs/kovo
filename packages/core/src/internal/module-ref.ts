/**
 * @internal Structured `url#export` module references for handler and derive
 * wire attributes. SPEC.md §4.3/§4.4 make this syntax load-bearing for lazy
 * imports, so parsing and formatting live in one core contract.
 */

/** @internal Kovo module reference families carried on the wire. */
export type KovoModuleRefKind = 'derive' | 'handler';

/** @internal Structured facts decoded from or formatted into `url#export`. */
export interface KovoModuleRef<Kind extends KovoModuleRefKind = KovoModuleRefKind> {
  readonly exportName: string;
  readonly kind: Kind;
  readonly url: string;
}

/** @internal Construct a typed module ref fact before final wire formatting. */
export function kovoModuleRef<Kind extends KovoModuleRefKind>(
  url: string,
  exportName: string,
  kind: Kind,
): KovoModuleRef<Kind> {
  return { exportName, kind, url };
}

/** @internal Parse one `url#export` module ref into structured facts. */
export function parseKovoModuleRef<Kind extends KovoModuleRefKind>(
  value: string,
  kind: Kind,
): KovoModuleRef<Kind> | undefined {
  const hashIndex = value.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === value.length - 1) return undefined;

  const url = value.slice(0, hashIndex);
  const exportName = value.slice(hashIndex + 1);
  if (!url || !exportName) return undefined;

  return { exportName, kind, url };
}

/** @internal Parse a whitespace-separated module-ref attribute value. */
export function parseKovoModuleRefList<Kind extends KovoModuleRefKind>(
  value: string | null | undefined,
  kind: Kind,
): KovoModuleRef<Kind>[] {
  return (
    value
      ?.split(/\s+/)
      .filter(Boolean)
      .map((item) => assertKovoModuleRef(item, kind)) ?? []
  );
}

/** @internal Parse or throw with a stable malformed-reference message. */
export function assertKovoModuleRef<Kind extends KovoModuleRefKind>(
  value: string,
  kind: Kind,
): KovoModuleRef<Kind> {
  const ref = parseKovoModuleRef(value, kind);
  if (!ref) throw new Error(`Invalid ${kind} reference: ${value}`);
  return ref;
}

/** @internal Format a structured module ref at the final wire edge. */
export function formatKovoModuleRef(ref: KovoModuleRef): string {
  if (!ref.url || ref.url.includes('#')) {
    throw new Error(`Kovo module ref URL must be non-empty and contain no hash: ${ref.url}`);
  }
  if (!ref.exportName) {
    throw new Error(`Kovo module ref export name must be non-empty for ${ref.url}`);
  }
  return `${ref.url}#${ref.exportName}`;
}
