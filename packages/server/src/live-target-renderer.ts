import type {
  Component,
  ComponentDefinitionInput,
  ComponentRenderSlots,
  JsonValue,
} from '@kovojs/core';
import { renderComponent, type ComponentRenderOptions } from './component-render.js';
import { runQuery, type QueryDefinition } from './query.js';
import type { LiveTargetRenderContext, LiveTargetRenderer } from './mutation-wire.js';

/** @internal Generated component query binding used by live-target renderers (SPEC §9.1). */
export interface ComponentLiveTargetQueryBinding<Request = unknown> {
  args?: (props: Record<string, unknown>) => unknown;
  name: string;
  query: QueryDefinition<string, unknown, unknown, Request>;
}

/** @internal Options for compiler-emitted component live-target renderers (SPEC §9.1). */
export interface ComponentLiveTargetRendererOptions<
  Definition extends ComponentDefinitionInput = ComponentDefinitionInput,
  Request = unknown,
  State extends JsonValue = JsonValue,
> {
  component: Component<Definition>;
  componentId: string;
  queries: readonly ComponentLiveTargetQueryBinding<Request>[];
  renderOptions?: (
    context: LiveTargetRenderContext<Request>,
  ) => ComponentRenderOptions<State> | Promise<ComponentRenderOptions<State>>;
  slots?: (
    context: LiveTargetRenderContext<Request>,
  ) => ComponentRenderSlots | Promise<ComponentRenderSlots>;
}

/**
 * @internal Build the generated live-target renderer for one query-backed component.
 *
 * Compiler-emitted modules use this helper so app authors do not write data-loading or
 * fragment-routing code. It reloads every declared query from serializable component props
 * and renders the component through the same `renderComponent()` path as full-page rendering
 * (SPEC §9.1).
 */
export function componentLiveTargetRenderer<
  const Definition extends ComponentDefinitionInput,
  Request = unknown,
  State extends JsonValue = JsonValue,
>(
  options: ComponentLiveTargetRendererOptions<Definition, Request, State>,
): LiveTargetRenderer<Request> {
  return {
    component: options.componentId,
    async render(context) {
      const queries = await loadLiveTargetQueries(options.queries, context);
      const renderOptions = await componentLiveTargetRenderOptions(options, context);
      return renderComponent(options.component, queries, renderOptions);
    },
  };
}

async function loadLiveTargetQueries<Request>(
  bindings: readonly ComponentLiveTargetQueryBinding<Request>[],
  context: LiveTargetRenderContext<Request>,
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {};

  for (const binding of bindings) {
    const input = binding.args ? binding.args(context.props) : undefined;
    const result = await runQuery(binding.query, input, context.request);
    if (!result.ok) {
      throw new Error(`Live target query failed: ${binding.query.key}`);
    }
    values[binding.name] = result.value;
  }

  return values;
}

async function componentLiveTargetRenderOptions<
  const Definition extends ComponentDefinitionInput,
  Request,
  State extends JsonValue,
>(
  options: ComponentLiveTargetRendererOptions<Definition, Request, State>,
  context: LiveTargetRenderContext<Request>,
): Promise<ComponentRenderOptions<State>> {
  const renderOptions = (await options.renderOptions?.(context)) ?? {};
  const slots = await options.slots?.(context);

  return slots === undefined
    ? renderOptions
    : {
        ...renderOptions,
        slots: {
          ...(renderOptions.slots ?? {}),
          ...slots,
        },
      };
}
