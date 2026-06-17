/** @internal Metadata for one compiler-lowered component invocation in a route page. */
export interface CompiledRoutePageComponent {
  keyExpression?: string;
  localName: string;
  props: readonly CompiledRoutePageComponentProp[];
  propsExpression: string;
  serializedPropsExpression: string;
}

/** @internal Metadata for one compiler-lowered route component prop. */
export interface CompiledRoutePageComponentProp {
  expression: string;
  name: string;
  propertyAccesses?: readonly string[];
  staticValue?: unknown;
}

/** @internal Metadata attached to compiler-lowered route page handlers. */
export interface CompiledRoutePageMetadata {
  components: readonly CompiledRoutePageComponent[];
  fileName: string;
  route: string;
}

/** @internal Route page handler shape after compiler metadata is attached. */
export type CompiledRoutePageFunction = ((...args: never[]) => unknown) & {
  readonly kovoRoutePage?: CompiledRoutePageMetadata;
};

/** @internal Attach compiler-derived route metadata to a generated route page handler. */
export function defineCompiledRoutePage<Page extends (...args: never[]) => unknown>(
  metadata: CompiledRoutePageMetadata,
  page: Page,
): Page & { readonly kovoRoutePage: CompiledRoutePageMetadata } {
  Object.defineProperty(page, 'kovoRoutePage', {
    configurable: false,
    enumerable: false,
    value: metadata,
    writable: false,
  });

  return page as Page & { readonly kovoRoutePage: CompiledRoutePageMetadata };
}
