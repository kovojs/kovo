export interface DomAttributeLike {
  name: string;
  value: string;
}

export type DomAttributeListLike = ArrayLike<DomAttributeLike> | Iterable<DomAttributeLike>;

export interface AttributeReaderLike {
  getAttribute(name: string): string | null;
}

export interface AttributeWriterLike {
  removeAttribute?: (name: string) => void;
  setAttribute?: (name: string, value: string) => void;
}

export interface AttributeMutatorLike extends AttributeReaderLike {
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
}

export interface AttributeElementLike extends AttributeReaderLike, AttributeWriterLike {
  attributes?: DomAttributeListLike;
}

export interface ClosestElementLike<Element> {
  closest?: (selector: string) => Element | null;
}

export interface QuerySelectorAllRootLike<Element> {
  querySelectorAll(selector: string): Iterable<Element>;
}

export interface OptionalQuerySelectorAllRootLike<Element> {
  querySelectorAll?: (selector: string) => Iterable<Element>;
}

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

export interface VisibilityStateLike {
  visibilityState?: 'hidden' | 'visible';
}

export interface TextContentElementLike extends AttributeReaderLike {
  textContent: string | null;
}

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
