export type ComponentRenderResult =
  | boolean
  | null
  | number
  | readonly ComponentRenderResult[]
  | undefined
  | object;
export type ComponentChild = ComponentRenderResult | string;

export interface Component<Props extends object = Record<string, never>> {
  (props?: Props): ComponentRenderResult;
  name?: string;
}

export interface BrowserHarnessComponentDefinition {
  clocks?: Record<string, unknown> | undefined;
  css?: string | undefined;
  disableServerRefresh?: boolean | undefined;
  errorBoundary?: unknown;
  isomorphic?: boolean | undefined;
  mutations?: Record<string, unknown> | undefined;
  props?: Record<string, unknown> | undefined;
  queries?: Record<string, unknown> | undefined;
  render: (...args: never[]) => ComponentRenderResult;
  state?: (() => unknown) | undefined;
}

const COMPONENT_DEFINITION_KEYS = new Set([
  'clocks',
  'css',
  'disableServerRefresh',
  'errorBoundary',
  'isomorphic',
  'mutations',
  'props',
  'queries',
  'render',
  'state',
]);

const componentDefinitions = new WeakMap<object, BrowserHarnessComponentDefinition>();

export function component<Definition extends BrowserHarnessComponentDefinition>(
  definition: Definition,
): Component<Record<string, unknown>> {
  assertKnownComponentDefinitionKeys(definition as unknown as Record<PropertyKey, unknown>);
  const descriptor = (() => undefined) as Component<Record<string, unknown>>;
  Object.defineProperty(descriptor, 'name', {
    configurable: true,
    enumerable: true,
    value: undefined,
    writable: true,
  });
  componentDefinitions.set(descriptor, Object.freeze({ ...definition }));
  return descriptor;
}

export function browserHarnessComponentDefinition(
  component: object,
): BrowserHarnessComponentDefinition {
  const definition = componentDefinitions.get(component);
  if (definition === undefined) {
    throw new TypeError(
      'Gallery browser harness refused a component outside its private registry.',
    );
  }
  return definition;
}

export function isBrowserHarnessComponent(
  value: unknown,
): value is Component<Record<string, unknown>> {
  return typeof value === 'function' && componentDefinitions.has(value);
}

function assertKnownComponentDefinitionKeys(definition: Record<PropertyKey, unknown>): void {
  for (const key of Reflect.ownKeys(definition)) {
    if (typeof key !== 'string') continue;
    if (COMPONENT_DEFINITION_KEYS.has(key)) continue;
    throw new TypeError(
      `Unknown component() definition field "${key}". Supported fields are ${[
        ...COMPONENT_DEFINITION_KEYS,
      ].join(', ')}.`,
    );
  }
}
