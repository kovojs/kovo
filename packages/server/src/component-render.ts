import type {
  Component,
  ComponentDefinitionInput,
  ComponentRenderSlots,
  JsonValue,
} from '@kovojs/core';

/**
 * Runtime inputs for rendering a component outside the full document pipeline.
 *
 * This mirrors the SPEC §4.5 composition call shape: callers may provide
 * compiler-hoisted slots and a serializable component state value, while query
 * data stays the explicit second argument to `renderComponent(...)`.
 */
export interface ComponentRenderOptions<State extends JsonValue = JsonValue> {
  /** Named slot renderers hoisted from fragment-target children. */
  slots?: ComponentRenderSlots;
  /** Serializable component state for stateful server component renders. */
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
