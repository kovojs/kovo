/** Minimal `{ name, value }` shape of a DOM attribute the runtime reads (SPEC §9.1). */
export interface DomAttributeLike {
  name: string;
  value: string;
}

/** An array-like or iterable collection of {@link DomAttributeLike} attributes. */
export type DomAttributeListLike = ArrayLike<DomAttributeLike> | Iterable<DomAttributeLike>;

/** The `getAttribute` slice of an element the runtime reads from (SPEC §9.1). */
export interface AttributeReaderLike {
  getAttribute(name: string): string | null;
}

/** The optional attribute-writing slice of an element the runtime may update. */
export interface AttributeWriterLike {
  removeAttribute?: (name: string) => void;
  setAttribute?: (name: string, value: string) => void;
}

/** An element the runtime both reads and writes attributes on. */
export interface AttributeMutatorLike extends AttributeReaderLike {
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
}

/** An element exposing attribute read/write plus an `attributes` list (SPEC §9.1). */
export interface AttributeElementLike extends AttributeReaderLike, AttributeWriterLike {
  attributes?: DomAttributeListLike;
}

/** An element with the `closest(selector)` ancestor lookup the loader uses for delegation (SPEC §4.4). */
export interface ClosestElementLike<Element> {
  closest?: (selector: string) => Element | null;
}

/** A root exposing `querySelectorAll` over the runtime's element shape (SPEC §9.1). */
export interface QuerySelectorAllRootLike<Element> {
  querySelectorAll(selector: string): Iterable<Element>;
}

/** A root that may expose `querySelectorAll` over the runtime's element shape. */
export interface OptionalQuerySelectorAllRootLike<Element> {
  querySelectorAll?: (selector: string) => Iterable<Element>;
}

/** A capture-phase listener target the loader delegates events on (SPEC §4.4). */
export interface ListenerTargetLike<Event> {
  addEventListener(
    type: string,
    listener: (event: Event) => void | Promise<void>,
    options?: { capture?: boolean },
  ): void;
  removeEventListener?: (
    type: string,
    listener: (event: Event) => void | Promise<void>,
    options?: { capture?: boolean },
  ) => void;
}

/** A root exposing `document.visibilityState` for visible-return refetch (SPEC §4.4). */
export interface VisibilityStateLike {
  visibilityState?: 'hidden' | 'visible';
}

/** An element exposing `textContent` plus attribute reads the runtime hydrates from. */
export interface TextContentElementLike extends AttributeReaderLike {
  textContent: string | null;
}

/** A fragment-target candidate element the runtime collects for `Kovo-Targets` (SPEC §9.1). */
export interface TargetElementLike extends AttributeReaderLike {
  id?: string;
}

export function domAttributes(
  attributes: DomAttributeListLike | null | undefined,
): DomAttributeLike[] {
  if (!attributes) return [];
  if (isIterable(attributes)) return [...attributes];

  return Array.from({ length: attributes.length }, (_, index) => attributes[index]).filter(
    (attribute): attribute is DomAttributeLike => Boolean(attribute),
  );
}

function isIterable(value: DomAttributeListLike): value is Iterable<DomAttributeLike> {
  return typeof (value as Iterable<DomAttributeLike>)[Symbol.iterator] === 'function';
}
