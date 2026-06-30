import type { ComponentDefinitionInput, ComponentRenderResult } from '@kovojs/core';

export type { Component, ComponentDefinitionInput, ComponentRenderResult } from '@kovojs/core';

type ComponentDefinition = ComponentDefinitionInput & {
  render: (...args: never[]) => ComponentRenderResult;
};

const COMPONENT_DEFINITION_KEYS = new Set([
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

export function component<Definition extends ComponentDefinition>(definition: Definition) {
  assertKnownComponentDefinitionKeys(definition as unknown as Record<PropertyKey, unknown>);
  const descriptor = (() => undefined) as {
    definition: Definition;
    name?: string;
  };
  Object.defineProperty(descriptor, 'name', {
    configurable: true,
    enumerable: true,
    value: undefined,
    writable: true,
  });
  descriptor.definition = definition;
  return descriptor;
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
