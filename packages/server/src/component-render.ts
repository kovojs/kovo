import type {
  Component,
  ComponentDefinitionInput,
  ComponentRenderSlots,
  JsonValue,
} from '@kovojs/core';

export interface ComponentRenderOptions<State extends JsonValue = JsonValue> {
  slots?: ComponentRenderSlots;
  state?: State;
}

/**
 * Render a component descriptor with the SPEC §4.5 composition argument.
 *
 * Fragment-target children are compiler-hoisted into named slot functions; mutation fragment
 * renderers call back through the same component render function with fresh query values and the
 * stamped, serializable slot output.
 */
export function renderComponent<
  const Definition extends ComponentDefinitionInput,
  Queries,
  State extends JsonValue = JsonValue,
>(
  component: Component<Definition>,
  queries: Queries,
  options: ComponentRenderOptions<State> = {},
): string {
  const state = options.state ?? (component.definition.state?.() as State | undefined);
  const slots = options.slots ?? {};
  const render = component.definition.render as (
    queries: Queries,
    state: State | undefined,
    slots: ComponentRenderSlots,
  ) => unknown;

  return String(render(queries, state, slots));
}
